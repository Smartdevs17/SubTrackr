/**
 * Checkpointed, batched Soroban event scanner (Issue #2086).
 *
 * The scanner walks an event stream one bounded page at a time and only moves
 * its durable checkpoint after the caller has successfully persisted the
 * events in that page. A crash or RPC failure therefore replays at most one
 * batch instead of forcing a full re-index. Retries use exponential backoff
 * and every batch is reflected in the exported metrics / log hooks.
 */

import { compareCursors, cursorLedger, encodeCursor } from './cursor';
import type {
  BatchResult,
  EventScannerConfig,
  EventScannerErrorCode,
  IndexerCheckpoint,
  IndexerMetrics,
  SorobanEvent,
} from './types';

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_DEDUPE_WINDOW = 2000;
const DEFAULT_MAX_BATCHES_PER_TICK = 10;

/** Error thrown after a batch exhausts its retry budget. */
export class EventScannerError extends Error {
  readonly code: EventScannerErrorCode;

  constructor(code: EventScannerErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'EventScannerError';
    this.code = code;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SorobanEventScanner {
  private readonly scanEvents: EventScannerConfig['scanEvents'];
  private readonly onEvents: EventScannerConfig['onEvents'];
  private readonly checkpointStore: EventScannerConfig['checkpointStore'];
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly dedupeWindow: number;
  private readonly logger: NonNullable<EventScannerConfig['logger']>;
  private readonly onMetrics: EventScannerConfig['onMetrics'];

  private cursor: string | null;
  private checkpoint: IndexerCheckpoint | null = null;
  private initialised = false;
  private running = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Bounded FIFO of already delivered event ids across overlapping pages. */
  private readonly seenOrder: string[] = [];
  private readonly seen = new Set<string>();

  private metrics: IndexerMetrics = {
    batchesTotal: 0,
    batchesFailed: 0,
    eventsTotal: 0,
    retriesTotal: 0,
    deduplicatedEvents: 0,
    lastBatchAt: null,
    lagLedgers: 0,
    isRunning: false,
  };

  constructor(config: EventScannerConfig) {
    if (typeof config.scanEvents !== 'function' || typeof config.onEvents !== 'function') {
      throw new TypeError('EventScannerConfig requires scanEvents and onEvents');
    }

    this.scanEvents = config.scanEvents;
    this.onEvents = config.onEvents;
    this.checkpointStore = config.checkpointStore;
    this.batchSize = Math.max(1, config.batchSize ?? DEFAULT_BATCH_SIZE);
    this.maxRetries = Math.max(1, config.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryDelayMs = Math.max(0, config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    this.dedupeWindow = Math.max(1, config.dedupeWindow ?? DEFAULT_DEDUPE_WINDOW);
    this.cursor = config.startCursor ?? null;
    this.onMetrics = config.onMetrics;
    this.logger = config.logger ?? {
      debug: () => undefined,
      info: () => undefined,
      warn: (message, meta) => console.warn(message, meta ?? ''),
      error: (message, meta) => console.error(message, meta ?? ''),
    };
  }

  /** Cursor the next batch will scan from. */
  getCursor(): string | null {
    return this.cursor;
  }

  /** Last checkpoint that was durably persisted, if any. */
  getCheckpoint(): IndexerCheckpoint | null {
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  /** Snapshot of the current counters (safe to expose to a metrics endpoint). */
  getMetrics(): IndexerMetrics {
    return { ...this.metrics };
  }

  /** Load the stored checkpoint once. Safe to call repeatedly. */
  async initialise(): Promise<IndexerCheckpoint | null> {
    if (this.initialised) return this.getCheckpoint();

    if (this.checkpointStore) {
      const stored = await this.checkpointStore.load();
      if (stored && typeof stored.cursor === 'string') {
        this.checkpoint = { ...stored };
        this.cursor = stored.cursor;
        this.logger.info('[SorobanEventScanner] Restored checkpoint', {
          cursor: stored.cursor,
          ledger: stored.ledger,
        });
      }
    }

    this.initialised = true;
    return this.getCheckpoint();
  }

  /** Scan and persist a single page. Retries are handled internally. */
  async runBatch(): Promise<BatchResult> {
    this.assertOpen();
    await this.initialise();

    this.metrics.batchesTotal += 1;
    let stage: 'scan' | 'persist' | 'checkpoint' = 'scan';
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        // A retry may be sleeping while close() is called; never persist after it.
        this.assertOpen();
        stage = 'scan';
        const page = await this.scanEvents(this.cursor, this.batchSize);
        if (!page || !Array.isArray(page.events)) {
          throw new TypeError('scanEvents must return a page with an events array');
        }

        const fresh = page.events.filter((event) => !this.seen.has(event.id));
        const duplicates = page.events.length - fresh.length;

        // At the tip the RPC omits nextCursor; use the highest event cursor so
        // the checkpoint still advances and the next poll does not re-scan.
        const lastEventCursor = page.events.reduce<string | null>(
          (max, event) => (compareCursors(max, event.cursor) < 0 ? event.cursor : max),
          null,
        );
        const resumeCursor =
          page.nextCursor ?? lastEventCursor ?? this.cursor ?? encodeCursor(0, 0);
        const checkpoint: IndexerCheckpoint = {
          cursor: resumeCursor,
          ledger: this.resolveLedger(page.events, resumeCursor),
          savedAt: new Date().toISOString(),
        };

        stage = 'persist';
        if (fresh.length > 0) {
          await this.onEvents(fresh, checkpoint);
        }

        stage = 'checkpoint';
        await this.persistCheckpoint(checkpoint);
        this.commitSeen(fresh);

        this.metrics.deduplicatedEvents += duplicates;
        this.metrics.eventsTotal += fresh.length;
        this.metrics.lastBatchAt = checkpoint.savedAt;
        this.updateLag(page.latestLedger, checkpoint.ledger);

        const result: BatchResult = {
          processed: fresh.length,
          cursor: resumeCursor,
          checkpoint: this.getCheckpoint(),
          latestLedger: page.latestLedger ?? 0,
          reachedTip: page.nextCursor === null,
        };

        this.logger.debug('[SorobanEventScanner] Batch complete', {
          processed: result.processed,
          cursor: result.cursor,
          reachedTip: result.reachedTip,
        });
        this.emitMetrics();
        return result;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          this.metrics.retriesTotal += 1;
          this.logger.warn('[SorobanEventScanner] Batch attempt failed, retrying', {
            attempt,
            maxRetries: this.maxRetries,
            stage,
            error: errorMessage(error),
          });
          await delay(this.retryDelayMs * 2 ** (attempt - 1));
        }
      }
    }

    this.metrics.batchesFailed += 1;
    this.emitMetrics();

    const code: EventScannerErrorCode =
      stage === 'persist'
        ? 'PERSIST_FAILED'
        : stage === 'checkpoint'
          ? 'CHECKPOINT_FAILED'
          : 'SCAN_FAILED';
    this.logger.error('[SorobanEventScanner] Batch exhausted retries', {
      stage,
      cursor: this.cursor,
      error: errorMessage(lastError),
    });
    throw new EventScannerError(code, `Soroban event batch failed at ${stage}`, lastError);
  }

  /**
   * Drain batches until the tip is reached or `maxBatches` is exhausted.
   * Useful for catch-up jobs that run once rather than as a daemon.
   */
  async runToTip(getTip: () => Promise<number>, maxBatches = DEFAULT_MAX_BATCHES_PER_TICK): Promise<number> {
    await this.initialise();
    let processed = 0;

    for (let i = 0; i < maxBatches; i += 1) {
      const before = this.cursor;
      const result = await this.runBatch();
      processed += result.processed;

      const tip = await getTip();
      this.updateLag(Math.max(tip, result.latestLedger), result.checkpoint?.ledger ?? 0);

      if (result.reachedTip || result.cursor === before) break;
    }

    return processed;
  }

  /** Start polling. `getTip` supplies the current ledger height. */
  async start(getTip: () => Promise<number>, pollIntervalMs = 2000): Promise<void> {
    this.assertOpen();
    if (this.running) return;

    await this.initialise();
    this.running = true;
    this.metrics.isRunning = true;
    this.logger.info('[SorobanEventScanner] Started', { cursor: this.cursor });

    const tick = async (): Promise<void> => {
      if (!this.running) return;
      try {
        await this.runToTip(getTip);
      } catch (error) {
        this.logger.error('[SorobanEventScanner] Poll cycle failed', {
          error: errorMessage(error),
        });
      }
      if (this.running) {
        this.timer = setTimeout(() => void tick(), Math.max(0, pollIntervalMs));
      }
    };

    await tick();
  }

  /** Stop polling without closing the scanner (it can be restarted). */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) {
      this.running = false;
      this.metrics.isRunning = false;
      this.logger.info('[SorobanEventScanner] Stopped', { cursor: this.cursor });
    }
    this.emitMetrics();
  }

  /** Stop polling and reject further batches. */
  close(): void {
    this.stop();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new EventScannerError('CLOSED', 'SorobanEventScanner is closed');
    }
  }

  private async persistCheckpoint(checkpoint: IndexerCheckpoint): Promise<void> {
    if (this.checkpointStore) {
      await this.checkpointStore.save(checkpoint);
    }
    this.checkpoint = checkpoint;
    this.cursor = checkpoint.cursor;
  }

  private commitSeen(events: SorobanEvent[]): void {
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      this.seenOrder.push(event.id);
      while (this.seenOrder.length > this.dedupeWindow) {
        const evicted = this.seenOrder.shift();
        if (evicted !== undefined) this.seen.delete(evicted);
      }
    }
  }

  private resolveLedger(events: SorobanEvent[], resumeCursor: string): number {
    if (events.length > 0) {
      return events.reduce((max, event) => Math.max(max, event.ledger || 0), 0);
    }
    return cursorLedger(resumeCursor) ?? this.checkpoint?.ledger ?? 0;
  }

  private updateLag(tip: number, checkpointLedger: number): void {
    const safeTip = Number.isFinite(tip) ? Math.max(0, Math.trunc(tip)) : 0;
    this.metrics.lagLedgers = Math.max(0, safeTip - Math.max(0, checkpointLedger));
  }

  private emitMetrics(): void {
    if (this.onMetrics) this.onMetrics(this.getMetrics());
  }
}

/** Convenience factory matching the style of the other backend services. */
export function createSorobanEventScanner(config: EventScannerConfig): SorobanEventScanner {
  return new SorobanEventScanner(config);
}
