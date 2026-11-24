/**
 * Persisted outbox of local subscription edits (Issue #1987).
 *
 * The whole outbox is one JSON document under a single storage key. Every
 * change is computed on a copy, written, and only then committed in memory, so
 * a failed write leaves both storage and memory unchanged. Writes are
 * serialised, so the last write always holds the latest state.
 */

import { assertVersion } from './conflictPolicy';
import type {
  HeldUpdate,
  PendingUpdate,
  RemoteSubscriptionRecord,
  SyncedSubscriptionPatch,
  SyncStorage,
} from './types';

export const OUTBOX_STORAGE_KEY = 'subtrackr.sync.outbox.v1';

const SCHEMA_VERSION = 1;

interface OutboxState {
  schema: number;
  pending: PendingUpdate[];
  held: HeldUpdate[];
}

/** Thrown by `load` when stored data is unreadable. Storage is left untouched. */
export class OutboxCorruptError extends Error {
  constructor(reason: string) {
    super(`sync outbox is corrupt: ${reason}`);
    this.name = 'OutboxCorruptError';
  }
}

/** Thrown when an edit targets a record that has an unresolved version conflict. */
export class RecordConflictedError extends Error {
  constructor(readonly id: string) {
    super(`subscription ${id} has an unresolved conflict; resolve it before editing`);
    this.name = 'RecordConflictedError';
  }
}

export interface SyncOutboxOptions {
  key?: string;
  now?: () => number;
  createId?: () => string;
}

function defaultCreateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVersionNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPendingUpdate(value: unknown): value is PendingUpdate {
  return (
    isRecord(value) &&
    typeof value.mutationId === 'string' &&
    typeof value.id === 'string' &&
    isVersionNumber(value.baseVersion) &&
    isRecord(value.patch) &&
    typeof value.enqueuedAt === 'number' &&
    isVersionNumber(value.attempts)
  );
}

function isHeldUpdate(value: unknown): value is HeldUpdate {
  return (
    isRecord(value) &&
    typeof value.heldId === 'string' &&
    (value.reason === 'version_conflict' || value.reason === 'rejected') &&
    typeof value.id === 'string' &&
    isVersionNumber(value.baseVersion) &&
    isRecord(value.patch) &&
    typeof value.heldAt === 'number'
  );
}

function parseState(raw: string): OutboxState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OutboxCorruptError('not valid JSON');
  }
  if (!isRecord(parsed) || parsed.schema !== SCHEMA_VERSION) {
    throw new OutboxCorruptError('unknown schema');
  }
  if (!Array.isArray(parsed.pending) || !parsed.pending.every(isPendingUpdate)) {
    throw new OutboxCorruptError('invalid pending entries');
  }
  if (!Array.isArray(parsed.held) || !parsed.held.every(isHeldUpdate)) {
    throw new OutboxCorruptError('invalid held entries');
  }
  return {
    schema: SCHEMA_VERSION,
    pending: parsed.pending as PendingUpdate[],
    held: parsed.held as HeldUpdate[],
  };
}

function assertPatch(patch: SyncedSubscriptionPatch): void {
  if (Object.keys(patch).length === 0) {
    throw new TypeError('patch must contain at least one field');
  }
}

/**
 * Queue an edit into a draft. A new edit merges into the last pending entry for
 * the same record, unless that entry is in flight. Merged entries keep the
 * earliest `baseVersion`, which is the conservative choice.
 */
function enqueueInto(
  draft: OutboxState,
  options: {
    id: string;
    baseVersion: number;
    patch: SyncedSubscriptionPatch;
    mutationId: string;
    now: number;
    inFlight: string | null;
  },
): PendingUpdate {
  const { id, baseVersion, patch, mutationId, now, inFlight } = options;
  if (draft.held.some((held) => held.id === id && held.reason === 'version_conflict')) {
    throw new RecordConflictedError(id);
  }
  for (let index = draft.pending.length - 1; index >= 0; index -= 1) {
    const candidate = draft.pending[index];
    if (candidate.id === id && candidate.mutationId !== inFlight) {
      candidate.patch = { ...candidate.patch, ...patch };
      return clone(candidate);
    }
  }
  const entry: PendingUpdate = {
    mutationId,
    id,
    baseVersion,
    patch: { ...patch },
    enqueuedAt: now,
    attempts: 0,
  };
  draft.pending.push(entry);
  return clone(entry);
}

export class SyncOutbox {
  private state: OutboxState;
  private inFlight: string | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();
  private readonly storage: SyncStorage;
  private readonly key: string;
  private readonly now: () => number;
  private readonly createId: () => string;

  private constructor(storage: SyncStorage, state: OutboxState, options: SyncOutboxOptions) {
    this.storage = storage;
    this.state = state;
    this.key = options.key ?? OUTBOX_STORAGE_KEY;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? defaultCreateId;
  }

  /** Read the outbox. Throws `OutboxCorruptError` on unreadable data and never writes. */
  static async load(storage: SyncStorage, options: SyncOutboxOptions = {}): Promise<SyncOutbox> {
    const key = options.key ?? OUTBOX_STORAGE_KEY;
    const raw = await storage.getItem(key);
    const state: OutboxState =
      raw === null ? { schema: SCHEMA_VERSION, pending: [], held: [] } : parseState(raw);
    return new SyncOutbox(storage, state, options);
  }

  /** Copies of pending entries, oldest first. */
  pending(): PendingUpdate[] {
    return clone(this.state.pending);
  }

  /** Copies of held entries (version conflicts and rejections). */
  held(): HeldUpdate[] {
    return clone(this.state.held);
  }

  /** The next entry to push, or undefined when the queue is empty. */
  nextPending(): PendingUpdate | undefined {
    return clone(this.state.pending[0]);
  }

  /** True while the record has an unresolved version conflict. */
  hasVersionConflict(id: string): boolean {
    return this.state.held.some((held) => held.id === id && held.reason === 'version_conflict');
  }

  /** Track the entry being pushed. In-memory only: a restart re-pushes it. */
  markInFlight(mutationId: string | null): void {
    this.inFlight = mutationId;
  }

  async enqueue(
    id: string,
    baseVersion: number,
    patch: SyncedSubscriptionPatch,
  ): Promise<PendingUpdate> {
    assertVersion('baseVersion', baseVersion);
    assertPatch(patch);
    return this.update((draft) =>
      enqueueInto(draft, {
        id,
        baseVersion,
        patch,
        mutationId: this.createId(),
        now: this.now(),
        inFlight: this.inFlight,
      }),
    );
  }

  /**
   * Remove an applied entry. Remaining entries for the same record that were
   * based on the old version are rebased to `appliedVersion`. They were made on
   * top of the same server state, and the server accepted this write against it.
   */
  ack(mutationId: string, appliedVersion: number): Promise<void> {
    return this.update((draft) => {
      const index = draft.pending.findIndex((entry) => entry.mutationId === mutationId);
      if (index < 0) throw new Error(`unknown pending mutation ${mutationId}`);
      const [acked] = draft.pending.splice(index, 1);
      for (const entry of draft.pending) {
        if (entry.id === acked.id && entry.baseVersion === acked.baseVersion) {
          entry.baseVersion = appliedVersion;
        }
      }
    });
  }

  /** Count one transient failure for the entry and return the new total. */
  recordAttempt(mutationId: string): Promise<number> {
    return this.update((draft) => {
      const entry = draft.pending.find((candidate) => candidate.mutationId === mutationId);
      if (!entry) throw new Error(`unknown pending mutation ${mutationId}`);
      entry.attempts += 1;
      return entry.attempts;
    });
  }

  /**
   * Hold every pending edit for the record as one version conflict. Holding all
   * of them keeps a stale queue from being pushed over the server state.
   */
  recordVersionConflict(mutationId: string, remote: RemoteSubscriptionRecord): Promise<HeldUpdate> {
    return this.update((draft) => {
      const target = draft.pending.find((entry) => entry.mutationId === mutationId);
      if (!target) throw new Error(`unknown pending mutation ${mutationId}`);
      const moved = draft.pending.filter((entry) => entry.id === target.id);
      draft.pending = draft.pending.filter((entry) => entry.id !== target.id);
      const patch: SyncedSubscriptionPatch = {};
      for (const entry of moved) Object.assign(patch, entry.patch);
      const held: HeldUpdate = {
        heldId: this.createId(),
        reason: 'version_conflict',
        id: target.id,
        baseVersion: moved[0].baseVersion,
        patch,
        remote,
        heldAt: this.now(),
      };
      draft.held.push(held);
      return clone(held);
    });
  }

  /** Remove an entry that the server refused for a non-retryable reason. */
  recordRejected(mutationId: string, message: string): Promise<HeldUpdate> {
    return this.update((draft) => {
      const index = draft.pending.findIndex((entry) => entry.mutationId === mutationId);
      if (index < 0) throw new Error(`unknown pending mutation ${mutationId}`);
      const [entry] = draft.pending.splice(index, 1);
      const held: HeldUpdate = {
        heldId: this.createId(),
        reason: 'rejected',
        id: entry.id,
        baseVersion: entry.baseVersion,
        patch: entry.patch,
        message,
        heldAt: this.now(),
      };
      draft.held.push(held);
      return clone(held);
    });
  }

  /** User keeps the server state and drops the held local edit. */
  discardHeld(heldId: string): Promise<void> {
    return this.update((draft) => {
      const index = draft.held.findIndex((held) => held.heldId === heldId);
      if (index < 0) throw new Error(`unknown held update ${heldId}`);
      draft.held.splice(index, 1);
    });
  }

  /** User re-applies a held version-conflict edit on top of the server state. */
  reapplyHeld(heldId: string): Promise<PendingUpdate> {
    return this.update((draft) => {
      const index = draft.held.findIndex((held) => held.heldId === heldId);
      if (index < 0) throw new Error(`unknown held update ${heldId}`);
      const held = draft.held[index];
      if (held.reason !== 'version_conflict' || !held.remote) {
        throw new TypeError('only version conflicts can be re-applied');
      }
      draft.held.splice(index, 1);
      return enqueueInto(draft, {
        id: held.id,
        baseVersion: held.remote.version,
        patch: held.patch,
        mutationId: this.createId(),
        now: this.now(),
        inFlight: this.inFlight,
      });
    });
  }

  /**
   * Serialise a change: compute it on a copy, persist the copy, then commit.
   * A throw from `mutate` or from storage leaves the committed state unchanged.
   */
  private update<R>(mutate: (draft: OutboxState) => R): Promise<R> {
    const run = this.writeChain.then(async () => {
      const draft = clone(this.state);
      const result = mutate(draft);
      await this.storage.setItem(this.key, JSON.stringify(draft));
      this.state = draft;
      return clone(result);
    });
    this.writeChain = run.catch(() => undefined);
    return run;
  }
}
