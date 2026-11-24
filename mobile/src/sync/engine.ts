/**
 * Offline-first push engine for subscription edits (Issue #1987).
 *
 * Pushes the outbox head first, one entry at a time, so a record's edits reach
 * the server in order. A transient failure stops the pass and is retried by the
 * next `flush()`. A version conflict holds the record and does not block other
 * records. Scheduling (network regain, app foreground) belongs to the caller.
 */

import { isRetryableQueryError, queryErrorMessage } from '../queries/queryClient';
import { isVersionConflict } from './conflictPolicy';
import type { SyncOutbox } from './outbox';
import type {
  PendingUpdate,
  PushResult,
  SyncEvent,
  SyncEventType,
  SyncLogger,
  SyncedSubscriptionPatch,
  SyncState,
  SyncStatus,
  SyncTelemetry,
  SyncTransport,
} from './types';

export const DEFAULT_PUSH_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_ATTEMPTS = 5;

export interface SyncEngineOptions {
  outbox: SyncOutbox;
  transport: SyncTransport;
  telemetry?: SyncTelemetry;
  logger?: SyncLogger;
  now?: () => number;
  /** Per-push deadline. Default 10 s. */
  pushTimeoutMs?: number;
  /** Transient failures before an edit is held as rejected. Default 5. */
  maxAttempts?: number;
}

export interface FlushSummary {
  applied: number;
  conflicted: number;
  rejected: number;
  /** True when the pass stopped on a transient failure and should be retried. */
  deferred: boolean;
}

type Outcome = 'applied' | 'conflicted' | 'rejected' | 'deferred';

export class SyncEngine {
  private readonly outbox: SyncOutbox;
  private readonly transport: SyncTransport;
  private readonly telemetry?: SyncTelemetry;
  private readonly logger?: SyncLogger;
  private readonly now: () => number;
  private readonly pushTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly listeners = new Set<() => void>();
  private flushing: Promise<FlushSummary> | null = null;
  private syncing = false;
  private lastError: string | undefined;

  constructor(options: SyncEngineOptions) {
    this.outbox = options.outbox;
    this.transport = options.transport;
    this.telemetry = options.telemetry;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.pushTimeoutMs = Math.max(1, options.pushTimeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  }

  /** Queue a local edit. Throws `RecordConflictedError` while the record is held. */
  async enqueueUpdate(
    id: string,
    baseVersion: number,
    patch: SyncedSubscriptionPatch,
  ): Promise<PendingUpdate> {
    const entry = await this.outbox.enqueue(id, baseVersion, patch);
    this.emit('enqueued', { id, mutationId: entry.mutationId, version: baseVersion });
    this.notify();
    return entry;
  }

  /** Push the queue. Concurrent callers share one pass. */
  flush(): Promise<FlushSummary> {
    if (!this.flushing) {
      this.flushing = this.runFlush().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  /** Keep the server state for a held record and drop the local edit. */
  async discardHeld(heldId: string): Promise<void> {
    await this.outbox.discardHeld(heldId);
    this.emit('held_resolved', { heldId, reason: 'discarded' });
    this.notify();
  }

  /** Re-apply a held version conflict on top of the server state, then push it. */
  async reapplyHeld(heldId: string): Promise<PendingUpdate> {
    const entry = await this.outbox.reapplyHeld(heldId);
    this.emit('held_resolved', { heldId, id: entry.id, reason: 'reapplied' });
    this.notify();
    return entry;
  }

  status(): SyncStatus {
    const held = this.outbox.held();
    const pending = this.outbox.pending().length;
    const hasConflict = held.some((item) => item.reason === 'version_conflict');
    const hasRejected = held.some((item) => item.reason === 'rejected');
    let state: SyncState = 'idle';
    if (hasConflict) state = 'conflict';
    else if (this.syncing) state = 'syncing';
    else if (this.lastError !== undefined || hasRejected) state = 'error';
    else if (pending > 0) state = 'pending';
    return { state, pending, held: held.length, lastError: this.lastError };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async runFlush(): Promise<FlushSummary> {
    const summary: FlushSummary = { applied: 0, conflicted: 0, rejected: 0, deferred: false };
    this.syncing = true;
    this.notify();
    try {
      for (let next = this.outbox.nextPending(); next; next = this.outbox.nextPending()) {
        let outcome: Outcome;
        try {
          outcome = await this.pushOne(next);
        } catch (error) {
          // Storage itself failed. Keep the entry queued and stop the pass.
          this.lastError = queryErrorMessage(error);
          this.logger?.warn('sync outbox write failed, pass deferred', { error: this.lastError });
          outcome = 'deferred';
        }
        if (outcome === 'deferred') {
          summary.deferred = true;
          break;
        }
        if (outcome === 'applied') summary.applied += 1;
        if (outcome === 'conflicted') summary.conflicted += 1;
        if (outcome === 'rejected') summary.rejected += 1;
      }
    } finally {
      this.syncing = false;
      this.notify();
    }
    return summary;
  }

  private async pushOne(update: PendingUpdate): Promise<Outcome> {
    const started = this.now();
    this.emit('push_start', {
      id: update.id,
      mutationId: update.mutationId,
      attempts: update.attempts,
    });
    let result: PushResult;
    try {
      result = await this.send(update);
    } catch (error) {
      return this.handleFailure(update, error, started);
    }
    try {
      return await this.handleResult(update, result, started);
    } catch (error) {
      // A storage failure after the server answered: the entry stays queued and
      // is re-pushed later. The server may then report a conflict with our own write.
      return this.handleFailure(update, error, started);
    }
  }

  private async send(update: PendingUpdate): Promise<PushResult> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('sync push timeout')),
      this.pushTimeoutMs,
    );
    this.outbox.markInFlight(update.mutationId);
    try {
      return await this.transport.pushUpdate(update, controller.signal);
    } finally {
      clearTimeout(timer);
      this.outbox.markInFlight(null);
    }
  }

  private async handleResult(
    update: PendingUpdate,
    result: PushResult,
    started: number,
  ): Promise<Outcome> {
    if (result.status === 'applied') {
      if (!Number.isInteger(result.version) || result.version <= update.baseVersion) {
        throw new Error('protocol violation: applied version must exceed baseVersion');
      }
      await this.outbox.ack(update.mutationId, result.version);
      this.lastError = undefined;
      this.emit('push_success', {
        id: update.id,
        mutationId: update.mutationId,
        version: result.version,
        durationMs: this.now() - started,
      });
      return 'applied';
    }

    if (result.status === 'conflict') {
      const { remote } = result;
      if (remote.id !== update.id || !isVersionConflict(update.baseVersion, remote.version)) {
        throw new Error('protocol violation: conflict response does not differ from baseVersion');
      }
      await this.outbox.recordVersionConflict(update.mutationId, remote);
      this.emit('push_conflict', {
        id: update.id,
        mutationId: update.mutationId,
        version: remote.version,
      });
      this.emit('held', { id: update.id, reason: 'version_conflict', version: remote.version });
      this.logger?.warn('subscription version conflict held for user resolution', {
        id: update.id,
        baseVersion: update.baseVersion,
        remoteVersion: remote.version,
      });
      this.notify();
      return 'conflicted';
    }

    throw new Error('protocol violation: unknown push result');
  }

  private async handleFailure(
    update: PendingUpdate,
    error: unknown,
    started: number,
  ): Promise<Outcome> {
    const message = queryErrorMessage(error);
    this.lastError = message;
    const retryable = isRetryableQueryError(error);
    let attempts = update.attempts;
    if (retryable) {
      attempts = await this.outbox.recordAttempt(update.mutationId);
      if (attempts < this.maxAttempts) {
        this.emit('push_error', {
          id: update.id,
          mutationId: update.mutationId,
          attempts,
          retryable: true,
          durationMs: this.now() - started,
          reason: message,
        });
        this.logger?.warn('subscription push failed, will retry', { id: update.id, attempts });
        this.notify();
        return 'deferred';
      }
    }

    const reason = retryable ? `gave up after ${attempts} attempts: ${message}` : message;
    await this.outbox.recordRejected(update.mutationId, reason);
    this.emit('push_error', {
      id: update.id,
      mutationId: update.mutationId,
      retryable: false,
      durationMs: this.now() - started,
      reason,
    });
    this.emit('held', { id: update.id, reason: 'rejected' });
    this.logger?.warn('subscription edit rejected and held', { id: update.id, reason });
    this.notify();
    return 'rejected';
  }

  private emit(type: SyncEventType, extra: Omit<SyncEvent, 'type' | 'at'> = {}): void {
    this.telemetry?.emit({ type, at: this.now(), ...extra });
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (error) {
        this.logger?.warn('sync subscriber failed', { error: queryErrorMessage(error) });
      }
    }
  }
}

/** JSON-line telemetry sink, the same shape as the query layer's console sink. */
export function createConsoleSyncTelemetry(
  logger: { info(message: string): void } = console,
): SyncTelemetry {
  return {
    emit(event: SyncEvent): void {
      logger.info(JSON.stringify({ kind: 'sync', ...event }));
    },
  };
}
