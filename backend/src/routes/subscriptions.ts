/**
 * backend/src/routes/subscriptions.ts
 *
 * Issue #2266: idempotent, coalesced server writes for subscription edits.
 *
 * The mobile autosave controller emits bounded batches of last-write-wins
 * edits; this route-level module applies them in one pass. Each edit is keyed
 * by `(id, version)` so a retried batch is a no-op rather than a duplicate
 * write, and optimistic version checks prevent a stale coalesced edit from
 * clobbering a newer record. The module is framework-agnostic and depends on
 * nothing: the store, clock and observability hooks are all injected.
 */

/** Stable, machine-readable error codes. Frozen. */
export const SubscriptionEditsErrorCode = Object.freeze({
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_VERSION: 'INVALID_VERSION',
  BATCH_TOO_LARGE: 'BATCH_TOO_LARGE',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  STORE_ERROR: 'STORE_ERROR',
} as const);

/** Union of {@link SubscriptionEditsErrorCode} values. */
export type SubscriptionEditsErrorCode =
  (typeof SubscriptionEditsErrorCode)[keyof typeof SubscriptionEditsErrorCode];

/**
 * Error thrown for a rejected batch or invalid configuration.
 *
 * The `code` is stable and safe to expose to callers; `details` carries
 * non-sensitive context for logging and tests.
 */
export class SubscriptionEditsError extends Error {
  /** Stable machine-readable code. */
  readonly code: SubscriptionEditsErrorCode;
  /** Additional non-sensitive context about the rejection. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: SubscriptionEditsErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'SubscriptionEditsError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/** A single coalesced subscription edit sent by the client. */
export interface SubscriptionEdit {
  /** Stable subscription identifier. */
  readonly id: string;
  /** Fields to update. */
  readonly patch: Readonly<Record<string, unknown>>;
  /** Expected current version; defaults to {@link SubscriptionEditsConfig.initialVersion}. */
  readonly version?: number;
}

/** Minimum record shape the store must return. */
export interface SubscriptionEditRecord {
  /** Current persisted version. */
  readonly version: number;
}

/** Persistence surface. `commit` must enforce the expected version atomically. */
export interface SubscriptionEditsStore {
  /** Load the current record for `id`, or `undefined` when it does not exist. */
  load(id: string): Promise<SubscriptionEditRecord | undefined>;
  /** Apply `patch` only when the stored version equals `expectedVersion`. */
  commit(
    id: string,
    patch: Readonly<Record<string, unknown>>,
    expectedVersion: number,
  ): Promise<SubscriptionEditRecord>;
}

/** Tunable policy for a batch applier. */
export interface SubscriptionEditsConfig {
  /** Maximum number of edits accepted in one batch. */
  readonly maxBatchSize: number;
  /** Version assigned to a subscription that has never been written. */
  readonly initialVersion: number;
}

/** Default policy: at most 50 edits per batch, starting at version 0. Frozen. */
export const DEFAULT_SUBSCRIPTION_EDITS_CONFIG: Readonly<SubscriptionEditsConfig> = Object.freeze({
  maxBatchSize: 50,
  initialVersion: 0,
});

/** Per-item application outcome. */
export type SubscriptionEditOutcome = 'applied' | 'duplicate' | 'conflict' | 'error';

/** Result of applying one edit. */
export interface SubscriptionEditResult {
  /** Subscription id from the request. */
  readonly id: string;
  /** What happened to this edit. */
  readonly outcome: SubscriptionEditOutcome;
  /** Version of the record after the operation. */
  readonly version: number;
  /** Typed code when the edit was skipped or failed. */
  readonly code?: SubscriptionEditsErrorCode;
  /** Human-readable reason when the edit was skipped or failed. */
  readonly message?: string;
}

/** Result of applying a whole batch. */
export interface SubscriptionEditsBatchResult {
  /** One frozen result per input edit, in request order. */
  readonly results: readonly SubscriptionEditResult[];
  /** Number of edits that produced a new commit. */
  readonly applied: number;
  /** Number of edits skipped as duplicates. */
  readonly skipped: number;
  /** Number of edits that conflicted or failed. */
  readonly failed: number;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
}

/** Observability hooks for batch application. */
export interface SubscriptionEditsMetrics {
  /** Called once per completed batch, including partially failed ones. */
  batchCompleted(applied: number, skipped: number, failed: number, durationMs: number): void;
  /** Called after a successful commit. */
  itemApplied(id: string, version: number): void;
  /** Called after an idempotent skip or version conflict. */
  itemSkipped(id: string, code: SubscriptionEditsErrorCode): void;
  /** Called after a store failure. */
  itemFailed(id: string, code: SubscriptionEditsErrorCode): void;
}

/** No-op metrics, safe to use in pure contexts. Frozen. */
export const noopSubscriptionEditsMetrics: SubscriptionEditsMetrics = Object.freeze({
  batchCompleted() {},
  itemApplied() {},
  itemSkipped() {},
  itemFailed() {},
});

/** Minimal structured logger interface. Receives no secrets. */
export interface SubscriptionEditsLogger {
  /** Emit a debug-level event with optional non-sensitive context. */
  debug(message: string, details?: Readonly<Record<string, unknown>>): void;
  /** Emit a warn-level event with optional non-sensitive context. */
  warn(message: string, details?: Readonly<Record<string, unknown>>): void;
  /** Emit an error-level event with optional non-sensitive context. */
  error(message: string, details?: Readonly<Record<string, unknown>>): void;
}

/** No-op logger. Frozen. */
export const noopSubscriptionEditsLogger: SubscriptionEditsLogger = Object.freeze({
  debug() {},
  warn() {},
  error() {},
});

/** Dependencies of a batch applier. All optional. */
export interface SubscriptionEditsDeps {
  /** Partial overrides merged onto {@link DEFAULT_SUBSCRIPTION_EDITS_CONFIG}. */
  readonly config?: Partial<SubscriptionEditsConfig>;
  /** Called for batch and per-item telemetry. */
  readonly metrics?: SubscriptionEditsMetrics;
  /** Receives non-sensitive events. */
  readonly logger?: SubscriptionEditsLogger;
  /** Current time source; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Optional externally owned idempotency key set. */
  readonly seen?: Set<string>;
}

/** A bound, stateful applier that remembers applied `(id, version)` keys. */
export interface SubscriptionEditsApplier {
  /** Apply a batch of edits, returning a frozen per-item result. */
  apply(batch: readonly SubscriptionEdit[]): Promise<SubscriptionEditsBatchResult>;
  /** The validated, frozen configuration in use. */
  readonly config: Readonly<SubscriptionEditsConfig>;
  /** Snapshot of the idempotency keys recorded so far. */
  readonly seenKeys: readonly string[];
}

function fail(
  code: SubscriptionEditsErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>>,
  metrics: SubscriptionEditsMetrics,
  logger: SubscriptionEditsLogger,
): never {
  const error = new SubscriptionEditsError(code, message, details);
  metrics.itemFailed('(batch)', code);
  logger.warn('subscription edits batch rejected', { code, ...details });
  throw error;
}

function validateConfig(config: Readonly<SubscriptionEditsConfig>): void {
  if (
    !Number.isInteger(config.maxBatchSize) ||
    config.maxBatchSize < 1 ||
    !Number.isInteger(config.initialVersion) ||
    config.initialVersion < 0
  ) {
    throw new SubscriptionEditsError('INVALID_CONFIG', 'Invalid subscription edits configuration', {
      maxBatchSize: config.maxBatchSize,
      initialVersion: config.initialVersion,
    });
  }
}

function makeResult(
  id: string,
  outcome: SubscriptionEditOutcome,
  version: number,
  code?: SubscriptionEditsErrorCode,
  message?: string,
): SubscriptionEditResult {
  return Object.freeze({ id, outcome, version, code, message });
}

/**
 * Create a batch applier bound to a store.
 *
 * The applier owns an idempotency set so replaying a batch with the same
 * `(id, version)` keys produces `duplicate` results instead of extra writes.
 */
export function createSubscriptionEditsApplier(
  store: SubscriptionEditsStore,
  deps: SubscriptionEditsDeps = {},
): SubscriptionEditsApplier {
  const config: Readonly<SubscriptionEditsConfig> = Object.freeze({
    ...DEFAULT_SUBSCRIPTION_EDITS_CONFIG,
    ...deps.config,
  });
  validateConfig(config);

  const metrics = deps.metrics ?? noopSubscriptionEditsMetrics;
  const logger = deps.logger ?? noopSubscriptionEditsLogger;
  const clock = deps.now ?? Date.now;
  const seen = deps.seen ?? new Set<string>();

  const apply = async (batch: readonly SubscriptionEdit[]): Promise<SubscriptionEditsBatchResult> => {
    const began = clock();
    if (!Number.isFinite(began)) {
      fail('INVALID_INPUT', 'now must return a finite number', { began }, metrics, logger);
    }
    if (!Array.isArray(batch)) {
      fail('INVALID_INPUT', 'batch must be an array', {}, metrics, logger);
    }
    if (batch.length > config.maxBatchSize) {
      fail(
        'BATCH_TOO_LARGE',
        `Batch has ${batch.length} edits (limit ${config.maxBatchSize})`,
        { count: batch.length, limit: config.maxBatchSize },
        metrics,
        logger,
      );
    }

    const results: SubscriptionEditResult[] = [];
    let applied = 0;
    let skipped = 0;
    let failed = 0;

    for (const edit of batch) {
      const id = edit?.id;
      if (typeof id !== 'string' || id.trim().length === 0) {
        results.push(makeResult(String(id), 'error', config.initialVersion, 'INVALID_INPUT', 'id must be non-empty'));
        metrics.itemFailed(String(id), 'INVALID_INPUT');
        failed += 1;
        continue;
      }
      if (edit.patch === null || typeof edit.patch !== 'object' || Array.isArray(edit.patch)) {
        results.push(makeResult(id, 'error', config.initialVersion, 'INVALID_INPUT', 'patch must be an object'));
        metrics.itemFailed(id, 'INVALID_INPUT');
        failed += 1;
        continue;
      }
      const version = edit.version ?? config.initialVersion;
      if (!Number.isInteger(version) || version < 0) {
        results.push(makeResult(id, 'error', version, 'INVALID_VERSION', 'version must be a non-negative integer'));
        metrics.itemFailed(id, 'INVALID_VERSION');
        failed += 1;
        continue;
      }

      const key = `${id}@${version}`;
      if (seen.has(key)) {
        results.push(makeResult(id, 'duplicate', version + 1, 'VERSION_CONFLICT', 'edit already applied'));
        metrics.itemSkipped(id, 'VERSION_CONFLICT');
        skipped += 1;
        logger.debug('subscription edit skipped as duplicate', { id, version });
        continue;
      }

      try {
        const record = await store.load(id);
        const current = record?.version ?? config.initialVersion;
        if (current !== version) {
          const code = current > version ? 'VERSION_CONFLICT' : 'INVALID_VERSION';
          results.push(makeResult(id, 'conflict', current, code, `stored version ${current}, expected ${version}`));
          metrics.itemSkipped(id, code);
          skipped += 1;
          logger.warn('subscription edit skipped on version mismatch', { id, version, current });
          continue;
        }

        const committed = await store.commit(id, edit.patch, version);
        const nextVersion = Number.isFinite(committed?.version) ? committed.version : version + 1;
        seen.add(key);
        results.push(makeResult(id, 'applied', nextVersion));
        metrics.itemApplied(id, nextVersion);
        applied += 1;
        logger.debug('subscription edit applied', { id, version, nextVersion });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push(makeResult(id, 'error', version, 'STORE_ERROR', message));
        metrics.itemFailed(id, 'STORE_ERROR');
        failed += 1;
        logger.error('subscription edit store failure', { id, version, error: message });
      }
    }

    const durationMs = Math.max(0, clock() - began);
    const result: SubscriptionEditsBatchResult = Object.freeze({
      results: Object.freeze(results),
      applied,
      skipped,
      failed,
      durationMs,
    });
    metrics.batchCompleted(applied, skipped, failed, durationMs);
    logger.debug('subscription edits batch completed', { applied, skipped, failed, durationMs });
    return result;
  };

  const applier: SubscriptionEditsApplier = Object.freeze({
    apply,
    config,
    get seenKeys(): readonly string[] {
      return Object.freeze([...seen]);
    },
  });
  return applier;
}

/** Idempotency keys shared between convenience calls, keyed by store identity. */
const DEFAULT_SEEN = new WeakMap<SubscriptionEditsStore, Set<string>>();

/**
 * Apply a batch using the default applier for `store`.
 *
 * Repeated calls with the same store share idempotency state, so a retried
 * coalesced write is a no-op. Use {@link createSubscriptionEditsApplier} when
 * the caller wants to own that state or pass observability hooks.
 */
export function applySubscriptionEditsBatch(
  batch: readonly SubscriptionEdit[],
  store: SubscriptionEditsStore,
  deps: SubscriptionEditsDeps = {},
): Promise<SubscriptionEditsBatchResult> {
  let seen = deps.seen;
  if (seen === undefined) {
    seen = DEFAULT_SEEN.get(store);
    if (seen === undefined) {
      seen = new Set<string>();
      DEFAULT_SEEN.set(store, seen);
    }
  }
  return createSubscriptionEditsApplier(store, { ...deps, seen }).apply(batch);
}
