/**
 * backend/src/lib/queryBudget.ts
 *
 * Per-tenant SQL query budget with slow-query auto-classification (issue #2270).
 *
 * This module is a zero-dependency, side-effect-free budget engine. It performs
 * no I/O, opens no connections and reads no ambient state other than an
 * injectable clock. Its purpose is to make the *policy* decision — "may this
 * tenant run another query right now, and how expensive was the last one?" —
 * fully deterministic and unit-testable without a database.
 *
 * Design rules:
 *  - Pure data in, pure data out. The controller keeps state in memory only.
 *  - Every rejection is a typed `QueryBudgetError` with a stable `code`.
 *  - A fixed-size sliding window is tracked per tenant; expired samples are
 *    pruned lazily on check/record/snapshot and can be pruned eagerly.
 *  - Queries are auto-classified as FAST / SLOW / CRITICAL from duration and
 *    rows-scanned thresholds.
 *  - Metrics and logger hooks are optional; no-op defaults are provided.
 *
 * Usage:
 *   const budget = createQueryBudget({ maxQueriesPerWindow: 10, windowMs: 60_000 });
 *   const decision = budget.check('tenant-a');
 *   if (!decision.allowed) throw new QueryBudgetError('BUDGET_EXCEEDED', '...');
 *   budget.record('tenant-a', { sql: 'SELECT 1', durationMs: 12, rowsScanned: 1 });
 */

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

/** Stable machine-readable codes emitted by this module. */
export const QueryBudgetErrorCode = {
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_TENANT: 'INVALID_TENANT',
  INVALID_QUERY: 'INVALID_QUERY',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
} as const;

/** Union of every stable error code emitted by this module. */
export type QueryBudgetErrorCode =
  (typeof QueryBudgetErrorCode)[keyof typeof QueryBudgetErrorCode];

/** Typed error thrown for invalid configuration, invalid input and budget denial. */
export class QueryBudgetError extends Error {
  readonly code: QueryBudgetErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: QueryBudgetErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'QueryBudgetError';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Query cost classes, ordered from cheapest to most expensive. */
export const QueryClassification = {
  FAST: 'FAST',
  SLOW: 'SLOW',
  CRITICAL: 'CRITICAL',
} as const;

/** Union of the supported query cost classes. */
export type QueryClassification =
  (typeof QueryClassification)[keyof typeof QueryClassification];

// ---------------------------------------------------------------------------
// Configuration and data types
// ---------------------------------------------------------------------------

/**
 * Fully resolved budget configuration. Callers normally supply a `Partial` of
 * this shape to {@link createQueryBudget}; defaults are filled in by
 * {@link validateQueryBudgetConfig}.
 */
export interface QueryBudgetConfig {
  /** Maximum number of recorded queries allowed per tenant inside one window. */
  maxQueriesPerWindow: number;
  /** Length of the sliding window in milliseconds. */
  windowMs: number;
  /** Duration at or above which a query is SLOW (ms). */
  slowQueryThresholdMs: number;
  /** Duration at or above which a query is CRITICAL (ms). */
  criticalQueryThresholdMs: number;
  /** Rows scanned at or above which a query is SLOW. */
  slowRowThreshold: number;
  /** Rows scanned at or above which a query is CRITICAL. */
  criticalRowThreshold: number;
  /** Injectable clock; defaults to `Date.now`. Enables deterministic tests. */
  nowMs: () => number;
}

/** Input sample describing a single executed query. */
export interface QuerySample {
  /** Optional SQL text, kept for observability only (never executed here). */
  readonly sql?: string;
  /** Wall-clock duration of the query in milliseconds. */
  readonly durationMs: number;
  /** Number of rows examined by the query. Defaults to 0. */
  readonly rowsScanned?: number;
}

/** Immutable record stored in a tenant's sliding window. */
export interface QueryRecord {
  readonly tenantId: string;
  readonly sql?: string;
  readonly timestampMs: number;
  readonly durationMs: number;
  readonly rowsScanned: number;
  readonly classification: QueryClassification;
}

/** Read-only view of a tenant's current budget state. */
export interface TenantBudgetState {
  readonly tenantId: string;
  readonly records: readonly QueryRecord[];
  readonly used: number;
  readonly limit: number;
  readonly fastCount: number;
  readonly slowCount: number;
  readonly criticalCount: number;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
}

/** Result of a pre-flight budget check for one tenant. */
export interface BudgetCheckResult {
  readonly allowed: boolean;
  readonly tenantId: string;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  /** Earliest timestamp at which a currently-recorded sample leaves the window. */
  readonly windowResetAtMs: number;
  /** Set to `BUDGET_EXCEEDED` when `allowed` is false. */
  readonly reason?: QueryBudgetErrorCode;
}

/** Optional observability hook for budget decisions and query classification. */
export interface QueryBudgetMetrics {
  recordQueryAccepted(tenantId: string, used: number, limit: number): void;
  recordQueryRejected(tenantId: string, used: number, limit: number, reason: QueryBudgetErrorCode): void;
  recordQueryRecorded(tenantId: string, classification: QueryClassification, durationMs: number, rowsScanned: number): void;
  recordSlowQuery(tenantId: string, durationMs: number, rowsScanned: number): void;
  recordCriticalQuery(tenantId: string, durationMs: number, rowsScanned: number): void;
  recordBudgetReset(tenantId: string): void;
  recordBudgetPruned(tenantCount: number, recordCount: number): void;
  /** Emitted by the database adapter layer (see `db.ts`). */
  recordQueryExecuted(tenantId: string, sql: string, durationMs: number, classification: QueryClassification, rowsScanned: number): void;
  /** Emitted by the database adapter layer when the underlying runner throws. */
  recordQueryFailed(tenantId: string, sql: string, errorCode: string): void;
}

/** Optional logging hook for user-visible budget and slow-query events. */
export interface QueryBudgetLogger {
  warn(message: string, details: Record<string, unknown>): void;
  info(message: string, details: Record<string, unknown>): void;
}

/** Default thresholds used when a caller omits configuration values. */
export const DEFAULT_QUERY_BUDGET_CONFIG: QueryBudgetConfig = Object.freeze({
  maxQueriesPerWindow: 100,
  windowMs: 60_000,
  slowQueryThresholdMs: 200,
  criticalQueryThresholdMs: 1_000,
  slowRowThreshold: 10_000,
  criticalRowThreshold: 100_000,
  nowMs: Date.now,
});

/** No-op metrics implementation, safe to use in tests and development. */
export const noopQueryBudgetMetrics: QueryBudgetMetrics = Object.freeze({
  recordQueryAccepted: () => {},
  recordQueryRejected: () => {},
  recordQueryRecorded: () => {},
  recordSlowQuery: () => {},
  recordCriticalQuery: () => {},
  recordBudgetReset: () => {},
  recordBudgetPruned: () => {},
  recordQueryExecuted: () => {},
  recordQueryFailed: () => {},
});

/** No-op logger implementation. */
export const noopQueryBudgetLogger: QueryBudgetLogger = Object.freeze({
  warn: () => {},
  info: () => {},
});

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new QueryBudgetError(
      QueryBudgetErrorCode.INVALID_CONFIG,
      `${field} must be a positive integer`,
      { field, value }
    );
  }
  return value;
}

function assertNonNegativeFinite(value: unknown, field: string, code: QueryBudgetErrorCode): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new QueryBudgetError(
      code,
      `${field} must be a finite non-negative number`,
      { field, value }
    );
  }
  return value;
}

function assertTenantId(tenantId: unknown): string {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new QueryBudgetError(
      QueryBudgetErrorCode.INVALID_TENANT,
      'tenantId must be a non-empty string',
      { tenantId }
    );
  }
  return tenantId;
}

/**
 * Validate and resolve a partial configuration into a complete, frozen
 * `QueryBudgetConfig`. Throws `QueryBudgetError(INVALID_CONFIG)` on bad values.
 */
export function validateQueryBudgetConfig(
  config: Partial<QueryBudgetConfig> = {}
): QueryBudgetConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new QueryBudgetError(
      QueryBudgetErrorCode.INVALID_CONFIG,
      'config must be an object',
      { config }
    );
  }

  const resolved: QueryBudgetConfig = {
    maxQueriesPerWindow: assertPositiveInteger(
      config.maxQueriesPerWindow ?? DEFAULT_QUERY_BUDGET_CONFIG.maxQueriesPerWindow,
      'maxQueriesPerWindow'
    ),
    windowMs: assertPositiveInteger(
      config.windowMs ?? DEFAULT_QUERY_BUDGET_CONFIG.windowMs,
      'windowMs'
    ),
    slowQueryThresholdMs: assertNonNegativeFinite(
      config.slowQueryThresholdMs ?? DEFAULT_QUERY_BUDGET_CONFIG.slowQueryThresholdMs,
      'slowQueryThresholdMs',
      QueryBudgetErrorCode.INVALID_CONFIG
    ),
    criticalQueryThresholdMs: assertNonNegativeFinite(
      config.criticalQueryThresholdMs ?? DEFAULT_QUERY_BUDGET_CONFIG.criticalQueryThresholdMs,
      'criticalQueryThresholdMs',
      QueryBudgetErrorCode.INVALID_CONFIG
    ),
    slowRowThreshold: assertNonNegativeFinite(
      config.slowRowThreshold ?? DEFAULT_QUERY_BUDGET_CONFIG.slowRowThreshold,
      'slowRowThreshold',
      QueryBudgetErrorCode.INVALID_CONFIG
    ),
    criticalRowThreshold: assertNonNegativeFinite(
      config.criticalRowThreshold ?? DEFAULT_QUERY_BUDGET_CONFIG.criticalRowThreshold,
      'criticalRowThreshold',
      QueryBudgetErrorCode.INVALID_CONFIG
    ),
    nowMs:
      typeof config.nowMs === 'function'
        ? config.nowMs
        : DEFAULT_QUERY_BUDGET_CONFIG.nowMs,
  };

  if (resolved.criticalQueryThresholdMs <= resolved.slowQueryThresholdMs) {
    throw new QueryBudgetError(
      QueryBudgetErrorCode.INVALID_CONFIG,
      'criticalQueryThresholdMs must be greater than slowQueryThresholdMs',
      {
        slowQueryThresholdMs: resolved.slowQueryThresholdMs,
        criticalQueryThresholdMs: resolved.criticalQueryThresholdMs,
      }
    );
  }
  if (resolved.criticalRowThreshold <= resolved.slowRowThreshold) {
    throw new QueryBudgetError(
      QueryBudgetErrorCode.INVALID_CONFIG,
      'criticalRowThreshold must be greater than slowRowThreshold',
      {
        slowRowThreshold: resolved.slowRowThreshold,
        criticalRowThreshold: resolved.criticalRowThreshold,
      }
    );
  }

  return Object.freeze(resolved);
}

function severityFor(value: number, slow: number, critical: number): number {
  if (value >= critical) return 2;
  if (value >= slow) return 1;
  return 0;
}

/**
 * Classify a query from its duration and rows-scanned count. The more severe
 * of the two signals wins. Throws `QueryBudgetError(INVALID_QUERY)` for
 * non-finite or negative inputs.
 */
export function classifyQuery(
  durationMs: number,
  rowsScanned: number = 0,
  config: Partial<QueryBudgetConfig> = {}
): QueryClassification {
  const duration = assertNonNegativeFinite(
    durationMs,
    'durationMs',
    QueryBudgetErrorCode.INVALID_QUERY
  );
  const rows = assertNonNegativeFinite(
    rowsScanned,
    'rowsScanned',
    QueryBudgetErrorCode.INVALID_QUERY
  );
  const cfg = validateQueryBudgetConfig(config);

  const severity = Math.max(
    severityFor(duration, cfg.slowQueryThresholdMs, cfg.criticalQueryThresholdMs),
    severityFor(rows, cfg.slowRowThreshold, cfg.criticalRowThreshold)
  );

  if (severity === 2) return QueryClassification.CRITICAL;
  if (severity === 1) return QueryClassification.SLOW;
  return QueryClassification.FAST;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/** In-memory controller returned by {@link createQueryBudget}. */
export interface QueryBudgetController {
  /** Pre-flight check; does not mutate the window beyond lazy pruning. */
  check(tenantId: string): BudgetCheckResult;
  /** Record an executed query and classify it. Returns the stored record. */
  record(tenantId: string, sample: QuerySample): QueryRecord;
  /** Discard all recorded samples for a tenant. */
  reset(tenantId: string): void;
  /** Read-only snapshot of a tenant's current state (prunes expired samples). */
  snapshot(tenantId: string): TenantBudgetState;
  /** Eagerly prune expired samples across all tenants; returns records removed. */
  prune(nowMs?: number): number;
  /** Read the injected clock. Used by the DB adapter for timing. */
  now(): number;
  /** The fully resolved, frozen configuration. */
  readonly config: QueryBudgetConfig;
}

interface MutableTenantState {
  records: QueryRecord[];
}

function validateSample(sample: QuerySample): { sql?: string; durationMs: number; rowsScanned: number } {
  if (sample === null || typeof sample !== 'object' || Array.isArray(sample)) {
    throw new QueryBudgetError(
      QueryBudgetErrorCode.INVALID_QUERY,
      'query sample must be an object',
      { sample }
    );
  }
  if (sample.sql !== undefined && typeof sample.sql !== 'string') {
    throw new QueryBudgetError(
      QueryBudgetErrorCode.INVALID_QUERY,
      'sql must be a string when provided',
      { sql: sample.sql }
    );
  }
  return {
    sql: sample.sql,
    durationMs: assertNonNegativeFinite(
      sample.durationMs,
      'durationMs',
      QueryBudgetErrorCode.INVALID_QUERY
    ),
    rowsScanned: assertNonNegativeFinite(
      sample.rowsScanned ?? 0,
      'rowsScanned',
      QueryBudgetErrorCode.INVALID_QUERY
    ),
  };
}

/**
 * Create a per-tenant query budget controller.
 *
 * @param config Partial configuration; see {@link DEFAULT_QUERY_BUDGET_CONFIG}.
 * @param metrics Optional observability sink (partial implementations allowed).
 * @param logger Optional logging sink (partial implementations allowed).
 */
export function createQueryBudget(
  config: Partial<QueryBudgetConfig> = {},
  metrics: Partial<QueryBudgetMetrics> = {},
  logger: Partial<QueryBudgetLogger> = {}
): QueryBudgetController {
  const cfg = validateQueryBudgetConfig(config);
  const m: QueryBudgetMetrics = { ...noopQueryBudgetMetrics, ...metrics };
  const l: QueryBudgetLogger = { ...noopQueryBudgetLogger, ...logger };
  const states = new Map<string, MutableTenantState>();
  const clock = cfg.nowMs;

  function now(): number {
    return clock();
  }

  function getState(tenantId: string): MutableTenantState {
    let state = states.get(tenantId);
    if (!state) {
      state = { records: [] };
      states.set(tenantId, state);
    }
    return state;
  }

  function prune(atMs?: number): number {
    const t = typeof atMs === 'number' ? atMs : now();
    if (!Number.isFinite(t)) return 0;
    const cutoff = t - cfg.windowMs;
    let removed = 0;
    let affected = 0;
    for (const [tenantId, state] of states) {
      const kept = state.records.filter((record) => record.timestampMs >= cutoff);
      const diff = state.records.length - kept.length;
      if (diff > 0) {
        state.records = kept;
        removed += diff;
        affected += 1;
      }
      if (state.records.length === 0) {
        states.delete(tenantId);
      }
    }
    if (removed > 0) {
      m.recordBudgetPruned(affected, removed);
    }
    return removed;
  }

  function check(tenantId: string): BudgetCheckResult {
    const id = assertTenantId(tenantId);
    prune();
    const state = getState(id);
    const used = state.records.length;
    const limit = cfg.maxQueriesPerWindow;
    const allowed = used < limit;
    const oldest = state.records[0];
    const result: BudgetCheckResult = {
      allowed,
      tenantId: id,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      windowResetAtMs: oldest
        ? oldest.timestampMs + cfg.windowMs
        : now() + cfg.windowMs,
    };
    if (allowed) {
      m.recordQueryAccepted(id, used, limit);
    } else {
      const reason = QueryBudgetErrorCode.BUDGET_EXCEEDED;
      m.recordQueryRejected(id, used, limit, reason);
      l.warn('SQL query budget exceeded', {
        tenantId: id,
        used,
        limit,
        windowResetAtMs: result.windowResetAtMs,
      });
      return { ...result, reason };
    }
    return result;
  }

  function record(tenantId: string, sample: QuerySample): QueryRecord {
    const id = assertTenantId(tenantId);
    const normalized = validateSample(sample);
    prune();
    const classification = classifyQuery(
      normalized.durationMs,
      normalized.rowsScanned,
      cfg
    );
    const entry: QueryRecord = Object.freeze({
      tenantId: id,
      sql: normalized.sql,
      timestampMs: now(),
      durationMs: normalized.durationMs,
      rowsScanned: normalized.rowsScanned,
      classification,
    });
    getState(id).records.push(entry);

    m.recordQueryRecorded(
      id,
      classification,
      normalized.durationMs,
      normalized.rowsScanned
    );
    if (classification === QueryClassification.SLOW) {
      m.recordSlowQuery(id, normalized.durationMs, normalized.rowsScanned);
      l.warn('slow SQL query classified', {
        tenantId: id,
        durationMs: normalized.durationMs,
        rowsScanned: normalized.rowsScanned,
      });
    } else if (classification === QueryClassification.CRITICAL) {
      m.recordCriticalQuery(id, normalized.durationMs, normalized.rowsScanned);
      l.warn('critical SQL query classified', {
        tenantId: id,
        durationMs: normalized.durationMs,
        rowsScanned: normalized.rowsScanned,
      });
    }
    return entry;
  }

  function reset(tenantId: string): void {
    const id = assertTenantId(tenantId);
    states.delete(id);
    m.recordBudgetReset(id);
  }

  function snapshot(tenantId: string): TenantBudgetState {
    const id = assertTenantId(tenantId);
    prune();
    const state = getState(id);
    const records = state.records.slice();
    const current = now();
    return Object.freeze({
      tenantId: id,
      records: Object.freeze(records),
      used: records.length,
      limit: cfg.maxQueriesPerWindow,
      fastCount: records.filter((r) => r.classification === QueryClassification.FAST).length,
      slowCount: records.filter((r) => r.classification === QueryClassification.SLOW).length,
      criticalCount: records.filter((r) => r.classification === QueryClassification.CRITICAL).length,
      windowStartMs: current - cfg.windowMs,
      windowEndMs: current,
    });
  }

  return Object.freeze({
    check,
    record,
    reset,
    snapshot,
    prune,
    now,
    config: cfg,
  });
}
