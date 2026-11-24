/**
 * backend/src/lib/db.ts
 *
 * Thin database adapter that wires the pure per-tenant budget engine
 * (`queryBudget.ts`) into a query runner (issue #2270).
 *
 * This module deliberately imports no database driver. It accepts an injected
 * `execute` function, so the same policy works for Postgres, SQLite, a mock or
 * any future transport. Ordering is strict:
 *
 *   1. validate tenant + SQL
 *   2. `budget.check(tenantId)` — reject before touching the database
 *   3. time `execute(sql, params)`
 *   4. `budget.record(...)` — classify and store the completed sample
 *   5. emit adapter-level metrics/logs for the user-visible execution
 *
 * Usage:
 *   const runner = createBudgetedQueryRunner({ budget, execute: pool.query });
 *   const rows = await runner.run('tenant-a', 'SELECT * FROM subscriptions');
 */

import {
  QueryBudgetError,
  QueryBudgetErrorCode,
  noopQueryBudgetMetrics,
  noopQueryBudgetLogger,
  type QueryBudgetController,
  type QueryBudgetMetrics,
  type QueryBudgetLogger,
  type QueryClassification,
} from './queryBudget.ts';

/** Options for {@link createBudgetedQueryRunner}. */
export interface BudgetedQueryRunnerOptions {
  /** Budget controller used for pre-flight checks and post-execution recording. */
  budget: QueryBudgetController;
  /** Injected query executor. Receives SQL and optional bind parameters. */
  execute: (sql: string, params?: readonly unknown[]) => Promise<unknown>;
  /** Optional metrics sink; missing methods fall back to no-ops. */
  metrics?: Partial<QueryBudgetMetrics>;
  /** Optional logger sink; missing methods fall back to no-ops. */
  logger?: Partial<QueryBudgetLogger>;
  /**
   * Optional extractor for the rows-scanned signal. When omitted, common result
   * shapes (`rowsScanned`, `rowCount`, `rows[]`, plain arrays) are inspected.
   */
  extractRowsScanned?: (result: unknown) => number;
}

/** Budgeted query runner returned by {@link createBudgetedQueryRunner}. */
export interface BudgetedQueryRunner {
  /** Run one query for a tenant, enforcing the budget before execution. */
  run<T = unknown>(tenantId: string, sql: string, params?: readonly unknown[]): Promise<T>;
  /** The underlying budget controller (useful for snapshots / reset in tests). */
  readonly budget: QueryBudgetController;
}

/** Best-effort extraction of a rows-scanned count from a driver result. */
function defaultExtractRowsScanned(result: unknown): number {
  if (Array.isArray(result)) {
    return result.length;
  }
  if (result !== null && typeof result === 'object') {
    const candidate = result as {
      rowsScanned?: unknown;
      rowCount?: unknown;
      rows?: unknown;
    };
    if (typeof candidate.rowsScanned === 'number' && Number.isFinite(candidate.rowsScanned)) {
      return Math.max(0, candidate.rowsScanned);
    }
    if (typeof candidate.rowCount === 'number' && Number.isFinite(candidate.rowCount)) {
      return Math.max(0, candidate.rowCount);
    }
    if (Array.isArray(candidate.rows)) {
      return candidate.rows.length;
    }
  }
  return 0;
}

/**
 * Create a budgeted query runner around an injected executor.
 *
 * @throws `QueryBudgetError(INVALID_CONFIG)` if the runner options are invalid.
 */
export function createBudgetedQueryRunner(
  options: BudgetedQueryRunnerOptions
): BudgetedQueryRunner {
  if (
    options === null ||
    typeof options !== 'object' ||
    !options.budget ||
    typeof options.budget.check !== 'function' ||
    typeof options.budget.record !== 'function' ||
    typeof options.budget.now !== 'function'
  ) {
    throw new QueryBudgetError(
      QueryBudgetErrorCode.INVALID_CONFIG,
      'a valid budget controller is required',
      { option: 'budget' }
    );
  }
  if (typeof options.execute !== 'function') {
    throw new QueryBudgetError(
      QueryBudgetErrorCode.INVALID_CONFIG,
      'execute must be a function',
      { option: 'execute' }
    );
  }

  const budget = options.budget;
  const execute = options.execute;
  const extract = options.extractRowsScanned ?? defaultExtractRowsScanned;
  const metrics: QueryBudgetMetrics = {
    ...noopQueryBudgetMetrics,
    ...(options.metrics ?? {}),
  };
  const logger: QueryBudgetLogger = {
    ...noopQueryBudgetLogger,
    ...(options.logger ?? {}),
  };

  async function run<T>(
    tenantId: string,
    sql: string,
    params?: readonly unknown[]
  ): Promise<T> {
    if (typeof sql !== 'string' || sql.trim().length === 0) {
      throw new QueryBudgetError(
        QueryBudgetErrorCode.INVALID_QUERY,
        'sql must be a non-empty string',
        { tenantId, sql }
      );
    }

    // Budget gate — check validates the tenant id and emits its own hooks.
    const decision = budget.check(tenantId);
    if (!decision.allowed) {
      throw new QueryBudgetError(
        QueryBudgetErrorCode.BUDGET_EXCEEDED,
        `SQL query budget exceeded for tenant "${tenantId}"`,
        {
          tenantId,
          used: decision.used,
          limit: decision.limit,
          windowResetAtMs: decision.windowResetAtMs,
          reason: decision.reason,
        }
      );
    }

    const startedAt = budget.now();
    let result: unknown;
    try {
      result = await execute(sql, params);
    } catch (error) {
      const code =
        error instanceof QueryBudgetError ? error.code : 'EXECUTION_ERROR';
      metrics.recordQueryFailed(tenantId, sql, code);
      logger.warn('budgeted query execution failed', { tenantId, sql, code });
      throw error;
    }

    const durationMs = Math.max(0, budget.now() - startedAt);
    const rowsScanned = extract(result);
    const entry = budget.record(tenantId, { sql, durationMs, rowsScanned });
    const classification: QueryClassification = entry.classification;

    metrics.recordQueryExecuted(
      tenantId,
      sql,
      durationMs,
      classification,
      rowsScanned
    );
    logger.info('budgeted query executed', {
      tenantId,
      classification,
      durationMs,
      rowsScanned,
    });

    return result as T;
  }

  return Object.freeze({ run, budget });
}
