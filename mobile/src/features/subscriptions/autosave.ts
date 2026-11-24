/**
 * mobile/src/features/subscriptions/autosave.ts
 *
 * Issue #2266: debounced, coalesced autosaves for mobile subscription edits.
 *
 * Rapid edits to the same subscription used to issue one server write per
 * keystroke. This controller keeps a single pending edit per subscription id
 * (last write wins), resets a quiet-period timer on every new edit, and caps
 * how long any edit may wait via `maxWaitMs`. When a flush happens the pending
 * edits are sliced into `maxBatchSize` batches so the network layer can send
 * a bounded number of coalesced writes.
 *
 * The controller performs no I/O: time and timers are injected, observability
 * goes through injected hooks, and flushed batches are handed to listeners.
 * That makes it deterministic under tests and safe to use from React Native.
 */

/** Stable, machine-readable error codes. Frozen. */
export const AutosaveErrorCode = Object.freeze({
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_VERSION: 'INVALID_VERSION',
  DISPOSED: 'DISPOSED',
} as const);

/** Union of {@link AutosaveErrorCode} values. */
export type AutosaveErrorCode = (typeof AutosaveErrorCode)[keyof typeof AutosaveErrorCode];

/**
 * Error thrown for every rejected autosave operation.
 *
 * The `code` is stable and safe to expose to callers; `details` carries
 * non-sensitive context (ids, timestamps, limits) for logging and tests.
 */
export class AutosaveError extends Error {
  /** Stable machine-readable code. */
  readonly code: AutosaveErrorCode;
  /** Additional non-sensitive context about the rejection. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: AutosaveErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'AutosaveError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/** Tunable policy for an autosave controller. */
export interface AutosaveConfig {
  /** Quiet period after the latest edit before a flush, in milliseconds. */
  readonly delayMs: number;
  /** Hard cap from the first pending edit to a forced flush, in milliseconds. */
  readonly maxWaitMs: number;
  /** Maximum number of edits included in one coalesced batch. */
  readonly maxBatchSize: number;
}

/** Default policy: 400ms debounce, 2.5s hard cap, 20 edits per batch. Frozen. */
export const DEFAULT_AUTOSAVE_CONFIG: Readonly<AutosaveConfig> = Object.freeze({
  delayMs: 400,
  maxWaitMs: 2500,
  maxBatchSize: 20,
});

/** A single pending, coalesced subscription edit. All fields are read-only. */
export interface PendingEdit {
  /** Stable subscription identifier. */
  readonly id: string;
  /** Shallow-merged patch; latest value per field wins. */
  readonly patch: Readonly<Record<string, unknown>>;
  /** Expected record version supplied by the caller, when known. */
  readonly version?: number;
  /** Timestamp (ms) of the most recent edit for this id. */
  readonly queuedAt: number;
}

/** Why a flush was triggered. */
export type AutosaveFlushReason = 'quiescence' | 'maxWait' | 'manual' | 'shutdown';

/** A frozen, bounded group of edits ready for one server write. */
export interface AutosaveBatch {
  /** Coalesced edits in first-queued order. */
  readonly edits: readonly PendingEdit[];
  /** Trigger that caused this batch to be flushed. */
  readonly reason: AutosaveFlushReason;
  /** Monotonically increasing batch number, starting at 1. */
  readonly sequence: number;
  /** Timestamp (ms) at which the batch was produced. */
  readonly flushedAt: number;
}

/** Observability hooks called for queue/flush/cancel/reject events. */
export interface AutosaveMetrics {
  /** Called for every accepted edit; `coalesced` is true for a same-id update. */
  queued(id: string, coalesced: boolean): void;
  /** Called when a debounce or max-wait timer is (re)scheduled. */
  scheduled(reason: 'debounce' | 'maxWait', delayMs: number): void;
  /** Called after a flush, including empty and forced flushes. */
  flushed(reason: AutosaveFlushReason, batches: number, edits: number): void;
  /** Called after a cancel, with the id when one was targeted. */
  cancelled(id: string | undefined, edits: number): void;
  /** Called for every rejected operation, before the error is thrown. */
  rejected(code: AutosaveErrorCode, id?: string): void;
  /** Called when a flush listener throws. */
  listenerFailed(error: unknown): void;
}

/** No-op metrics, safe to use in pure/browser contexts. Frozen. */
export const noopAutosaveMetrics: AutosaveMetrics = Object.freeze({
  queued() {},
  scheduled() {},
  flushed() {},
  cancelled() {},
  rejected() {},
  listenerFailed() {},
});

/** Minimal structured logger interface. Receives no secrets. */
export interface AutosaveLogger {
  /** Emit a debug-level event with optional non-sensitive context. */
  debug(message: string, details?: Readonly<Record<string, unknown>>): void;
  /** Emit a warn-level event with optional non-sensitive context. */
  warn(message: string, details?: Readonly<Record<string, unknown>>): void;
  /** Emit an error-level event with optional non-sensitive context. */
  error(message: string, details?: Readonly<Record<string, unknown>>): void;
}

/** No-op logger. Frozen. */
export const noopAutosaveLogger: AutosaveLogger = Object.freeze({
  debug() {},
  warn() {},
  error() {},
});

/** Injectable timer surface. Defaults to the host `setTimeout`/`clearTimeout`. */
export interface AutosaveTimers {
  /** Schedule a callback after `delayMs` and return an opaque handle. */
  readonly setTimeout: (fn: () => void, delayMs: number) => unknown;
  /** Cancel a handle previously returned by {@link AutosaveTimers.setTimeout}. */
  readonly clearTimeout: (handle: unknown) => void;
}

/** Host timers. Frozen. */
export const systemAutosaveTimers: AutosaveTimers = Object.freeze({
  setTimeout: (fn, delayMs) => setTimeout(fn, delayMs),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
});

/** Injectable clock returning the current time in milliseconds. */
export type AutosaveClock = () => number;

/** Receives each flushed batch so the caller can perform the server write. */
export type AutosaveFlushListener = (batch: AutosaveBatch) => void;

/** A bound autosave controller. */
export interface AutosaveController {
  /** Queue (or coalesce) an edit and reschedule the debounce timer. */
  queue(id: string, patch: Readonly<Record<string, unknown>>, version?: number): readonly PendingEdit[];
  /** Drain all pending edits into frozen batches. Defaults to `manual`. */
  flush(reason?: AutosaveFlushReason): readonly AutosaveBatch[];
  /** Drop one edit by id, or all edits when no id is given. Returns the count removed. */
  cancel(id?: string): number;
  /** Frozen snapshot of the currently pending edits. */
  pending(): readonly PendingEdit[];
  /** Number of distinct subscription ids currently pending. */
  size(): number;
  /** Register a flush listener; returns an unsubscribe function. */
  subscribe(listener: AutosaveFlushListener): () => void;
  /** Cancel all timers and listeners; the controller becomes unusable. */
  dispose(): void;
  /** The validated, frozen configuration in use. */
  readonly config: Readonly<AutosaveConfig>;
}

/** Internal entry carrying ordering and max-wait bookkeeping. */
interface PendingEntry extends PendingEdit {
  /** Time of the first edit in this coalescing window. */
  readonly firstQueuedAt: number;
  /** Monotonic insertion order. */
  readonly sequence: number;
}

function reject(
  code: AutosaveErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>>,
  metrics: AutosaveMetrics,
  logger: AutosaveLogger,
  id?: string,
): never {
  const error = new AutosaveError(code, message, details);
  metrics.rejected(code, id);
  logger.warn('autosave rejected', { code, ...details });
  throw error;
}

function validateConfig(config: Readonly<AutosaveConfig>): void {
  if (
    !Number.isFinite(config.delayMs) ||
    config.delayMs < 0 ||
    !Number.isFinite(config.maxWaitMs) ||
    config.maxWaitMs <= 0 ||
    !Number.isInteger(config.maxBatchSize) ||
    config.maxBatchSize < 1
  ) {
    throw new AutosaveError(AutosaveErrorCode.INVALID_CONFIG, 'Invalid autosave configuration', {
      delayMs: config.delayMs,
      maxWaitMs: config.maxWaitMs,
      maxBatchSize: config.maxBatchSize,
    });
  }
}

/**
 * Create a bound autosave controller.
 *
 * @param config Partial overrides merged onto {@link DEFAULT_AUTOSAVE_CONFIG}.
 * @param metrics Called on queue/flush/cancel/reject events.
 * @param logger Receives non-sensitive debug events.
 * @param clock Current time source; defaults to `Date.now`.
 * @param timers Timer surface; defaults to host timers.
 */
export function createAutosaveController(
  config: Partial<AutosaveConfig> = {},
  metrics: AutosaveMetrics = noopAutosaveMetrics,
  logger: AutosaveLogger = noopAutosaveLogger,
  clock: AutosaveClock = Date.now,
  timers: AutosaveTimers = systemAutosaveTimers,
): AutosaveController {
  const merged: Readonly<AutosaveConfig> = Object.freeze({ ...DEFAULT_AUTOSAVE_CONFIG, ...config });
  validateConfig(merged);

  const entries = new Map<string, PendingEntry>();
  const listeners = new Set<AutosaveFlushListener>();
  let debounceHandle: unknown;
  let maxWaitHandle: unknown;
  let hasDebounce = false;
  let hasMaxWait = false;
  let editSequence = 0;
  let batchSequence = 0;
  let disposed = false;

  const now = (): number => {
    const value = clock();
    if (!Number.isFinite(value)) {
      reject(AutosaveErrorCode.INVALID_CONFIG, 'autosave clock must return a finite number', { value }, metrics, logger);
    }
    return value;
  };

  const clearDebounce = (): void => {
    if (hasDebounce) {
      timers.clearTimeout(debounceHandle);
      debounceHandle = undefined;
      hasDebounce = false;
    }
  };

  const clearMaxWait = (): void => {
    if (hasMaxWait) {
      timers.clearTimeout(maxWaitHandle);
      maxWaitHandle = undefined;
      hasMaxWait = false;
    }
  };

  const schedule = (reason: 'debounce' | 'maxWait', fn: () => void, delayMs: number): void => {
    const delay = Math.max(0, delayMs);
    const handle = timers.setTimeout(fn, delay);
    if (reason === 'debounce') {
      debounceHandle = handle;
      hasDebounce = true;
    } else {
      maxWaitHandle = handle;
      hasMaxWait = true;
    }
    metrics.scheduled(reason, delay);
    logger.debug('autosave timer scheduled', { reason, delayMs: delay });
  };

  const snapshot = (): readonly PendingEdit[] =>
    Object.freeze(
      [...entries.values()]
        .sort((a, b) => a.sequence - b.sequence)
        .map((entry) => snapshotEntry(entry)),
    );

  const flushInternal = (reason: AutosaveFlushReason): readonly AutosaveBatch[] => {
    clearDebounce();
    clearMaxWait();

    if (entries.size === 0) {
      metrics.flushed(reason, 0, 0);
      return Object.freeze([]);
    }

    const items = [...entries.values()].sort((a, b) => a.sequence - b.sequence);
    entries.clear();
    const flushedAt = now();
    const batches: AutosaveBatch[] = [];

    for (let index = 0; index < items.length; index += merged.maxBatchSize) {
      batches.push(
        Object.freeze({
          edits: Object.freeze(items.slice(index, index + merged.maxBatchSize).map((entry) => snapshotEntry(entry))),
          reason,
          sequence: ++batchSequence,
          flushedAt,
        }),
      );
    }

    const frozen = Object.freeze(batches);
    metrics.flushed(reason, frozen.length, items.length);
    logger.debug('autosave flushed', { reason, batches: frozen.length, edits: items.length });

    for (const batch of frozen) {
      for (const listener of listeners) {
        try {
          listener(batch);
        } catch (error) {
          metrics.listenerFailed(error);
          logger.error('autosave listener failed', {
            sequence: batch.sequence,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return frozen;
  };

  const onDebounce = (): void => {
    debounceHandle = undefined;
    hasDebounce = false;
    flushInternal('quiescence');
  };

  const onMaxWait = (): void => {
    maxWaitHandle = undefined;
    hasMaxWait = false;
    flushInternal('maxWait');
  };

  const queue = (
    id: string,
    patch: Readonly<Record<string, unknown>>,
    version?: number,
  ): readonly PendingEdit[] => {
    if (disposed) {
      reject(AutosaveErrorCode.DISPOSED, 'autosave controller has been disposed', { id }, metrics, logger, id);
    }
    if (typeof id !== 'string' || id.trim().length === 0) {
      reject(AutosaveErrorCode.INVALID_INPUT, 'id must be a non-empty string', { id }, metrics, logger);
    }
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      reject(AutosaveErrorCode.INVALID_INPUT, 'patch must be a non-null object', { id, patch }, metrics, logger, id);
    }
    if (version !== undefined && (!Number.isFinite(version) || !Number.isInteger(version) || version < 0)) {
      reject(
        AutosaveErrorCode.INVALID_VERSION,
        'version must be a non-negative integer',
        { id, version },
        metrics,
        logger,
        id,
      );
    }

    const queuedAt = now();
    const existing = entries.get(id);

    if (existing !== undefined) {
      const coalesced: PendingEntry = {
        id,
        patch: Object.freeze({ ...existing.patch, ...patch }),
        version: version ?? existing.version,
        queuedAt,
        firstQueuedAt: existing.firstQueuedAt,
        sequence: existing.sequence,
      };
      entries.delete(id);
      entries.set(id, coalesced);
      metrics.queued(id, true);
      logger.debug('autosave edit coalesced', { id, queuedAt });
    } else {
      const wasEmpty = entries.size === 0;
      const entry: PendingEntry = {
        id,
        patch: Object.freeze({ ...patch }),
        version,
        queuedAt,
        firstQueuedAt: queuedAt,
        sequence: ++editSequence,
      };
      entries.set(id, entry);
      metrics.queued(id, false);
      logger.debug('autosave edit queued', { id, queuedAt, version });
      if (wasEmpty) {
        schedule('maxWait', onMaxWait, entry.firstQueuedAt + merged.maxWaitMs - queuedAt);
      }
    }

    clearDebounce();
    schedule('debounce', onDebounce, merged.delayMs);
    return snapshot();
  };

  const cancel = (id?: string): number => {
    let removed = 0;
    if (id === undefined) {
      removed = entries.size;
      entries.clear();
      clearDebounce();
      clearMaxWait();
    } else if (entries.delete(id)) {
      removed = 1;
      clearDebounce();
      if (entries.size === 0) {
        clearMaxWait();
      } else {
        const earliest = [...entries.values()].sort((a, b) => a.queuedAt - b.queuedAt)[0];
        schedule('debounce', onDebounce, earliest.queuedAt + merged.delayMs - now());
      }
    }
    metrics.cancelled(id, removed);
    logger.debug('autosave cancelled', { id: id ?? null, removed });
    return removed;
  };

  const subscribe = (listener: AutosaveFlushListener): (() => void) => {
    if (typeof listener !== 'function') {
      reject(AutosaveErrorCode.INVALID_INPUT, 'listener must be a function', {}, metrics, logger);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const controller: AutosaveController = Object.freeze({
    queue,
    flush: (reason: AutosaveFlushReason = 'manual') => flushInternal(reason),
    cancel,
    pending: snapshot,
    size: () => entries.size,
    subscribe,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearDebounce();
      clearMaxWait();
      const removed = entries.size;
      entries.clear();
      listeners.clear();
      metrics.cancelled(undefined, removed);
      logger.debug('autosave disposed', { removed });
    },
    config: merged,
  });

  return controller;
}

/** Convert an internal entry into a frozen public edit snapshot. */
function snapshotEntry(entry: PendingEntry): PendingEdit {
  return Object.freeze({
    id: entry.id,
    patch: entry.patch,
    version: entry.version,
    queuedAt: entry.queuedAt,
  });
}
