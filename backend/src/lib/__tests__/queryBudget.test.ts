/**
 * backend/src/lib/__tests__/queryBudget.test.ts
 *
 * Unit tests for the per-tenant SQL query budget engine (issue #2270).
 * Every documented behaviour — defaults, validation, classification, sliding
 * window, per-tenant isolation, failure modes and observability — is pinned.
 */

import {
  QueryBudgetErrorCode,
  QueryClassification,
  QueryBudgetError,
  DEFAULT_QUERY_BUDGET_CONFIG,
  validateQueryBudgetConfig,
  classifyQuery,
  createQueryBudget,
} from '../queryBudget';

/** Assert that `fn` throws a QueryBudgetError carrying the expected stable code. */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected function to throw');
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

describe('error surface and constants', () => {
  it('exposes stable error codes', () => {
    expect(QueryBudgetErrorCode.INVALID_CONFIG).toBe('INVALID_CONFIG');
    expect(QueryBudgetErrorCode.INVALID_TENANT).toBe('INVALID_TENANT');
    expect(QueryBudgetErrorCode.INVALID_QUERY).toBe('INVALID_QUERY');
    expect(QueryBudgetErrorCode.BUDGET_EXCEEDED).toBe('BUDGET_EXCEEDED');
  });

  it('exposes stable classification values', () => {
    expect(QueryClassification.FAST).toBe('FAST');
    expect(QueryClassification.SLOW).toBe('SLOW');
    expect(QueryClassification.CRITICAL).toBe('CRITICAL');
  });

  it('builds a typed QueryBudgetError with code and details', () => {
    const error = new QueryBudgetError(
      QueryBudgetErrorCode.BUDGET_EXCEEDED,
      'over budget',
      { tenantId: 'acme' }
    );
    expect(error instanceof Error).toBe(true);
    expect(error.name).toBe('QueryBudgetError');
    expect(error.code).toBe('BUDGET_EXCEEDED');
    expect(error.message).toBe('over budget');
    expect(error.details).toEqual({ tenantId: 'acme' });
  });
});

describe('validateQueryBudgetConfig', () => {
  it('fills in documented defaults', () => {
    const config = validateQueryBudgetConfig({});
    expect(config.maxQueriesPerWindow).toBe(100);
    expect(config.windowMs).toBe(60000);
    expect(config.slowQueryThresholdMs).toBe(200);
    expect(config.criticalQueryThresholdMs).toBe(1000);
    expect(config.slowRowThreshold).toBe(10000);
    expect(config.criticalRowThreshold).toBe(100000);
    expect(typeof config.nowMs).toBe('function');
    expect(DEFAULT_QUERY_BUDGET_CONFIG.maxQueriesPerWindow).toBe(100);
  });

  it('preserves valid overrides and a custom clock', () => {
    const clock = () => 42;
    const config = validateQueryBudgetConfig({
      maxQueriesPerWindow: 3,
      windowMs: 500,
      nowMs: clock,
    });
    expect(config.maxQueriesPerWindow).toBe(3);
    expect(config.windowMs).toBe(500);
    expect(config.nowMs()).toBe(42);
  });

  it('rejects a non-positive or fractional max', () => {
    expectCode(() => validateQueryBudgetConfig({ maxQueriesPerWindow: 0 }), 'INVALID_CONFIG');
    expectCode(() => validateQueryBudgetConfig({ maxQueriesPerWindow: 1.5 }), 'INVALID_CONFIG');
  });

  it('rejects an invalid window', () => {
    expectCode(() => validateQueryBudgetConfig({ windowMs: -5 }), 'INVALID_CONFIG');
  });

  it('requires critical thresholds to exceed slow thresholds', () => {
    expectCode(
      () => validateQueryBudgetConfig({ slowQueryThresholdMs: 500, criticalQueryThresholdMs: 300 }),
      'INVALID_CONFIG'
    );
    expectCode(
      () => validateQueryBudgetConfig({ slowRowThreshold: 10, criticalRowThreshold: 10 }),
      'INVALID_CONFIG'
    );
  });

  it('rejects non-finite thresholds and non-object configs', () => {
    expectCode(() => validateQueryBudgetConfig({ slowQueryThresholdMs: NaN }), 'INVALID_CONFIG');
    expectCode(() => validateQueryBudgetConfig(null), 'INVALID_CONFIG');
  });
});

describe('classifyQuery', () => {
  const config = {
    slowQueryThresholdMs: 100,
    criticalQueryThresholdMs: 500,
    slowRowThreshold: 1000,
    criticalRowThreshold: 5000,
  };

  it('classifies cheap queries as FAST', () => {
    expect(classifyQuery(10, 10, config)).toBe('FAST');
    expect(classifyQuery(99, 999, config)).toBe('FAST');
  });

  it('classifies at the duration boundaries', () => {
    expect(classifyQuery(100, 0, config)).toBe('SLOW');
    expect(classifyQuery(500, 0, config)).toBe('CRITICAL');
  });

  it('classifies at the rows-scanned boundaries', () => {
    expect(classifyQuery(0, 1000, config)).toBe('SLOW');
    expect(classifyQuery(0, 5000, config)).toBe('CRITICAL');
  });

  it('lets the most severe signal win', () => {
    expect(classifyQuery(200, 6000, config)).toBe('CRITICAL');
  });

  it('defaults rowsScanned to zero', () => {
    expect(classifyQuery(5)).toBe('FAST');
  });

  it('rejects invalid measurements', () => {
    expectCode(() => classifyQuery(-1, 0, config), 'INVALID_QUERY');
    expectCode(() => classifyQuery(NaN, 0, config), 'INVALID_QUERY');
    expectCode(() => classifyQuery(1, -5, config), 'INVALID_QUERY');
  });
});

describe('createQueryBudget', () => {
  let clock = 1000;
  const config = {
    maxQueriesPerWindow: 2,
    windowMs: 100,
    slowQueryThresholdMs: 50,
    criticalQueryThresholdMs: 200,
    nowMs: () => clock,
  };
  const budget = createQueryBudget(config);

  it('reports the initial window state', () => {
    const result = budget.check('tenant-a');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(0);
    expect(result.limit).toBe(2);
    expect(result.remaining).toBe(2);
    expect(result.windowResetAtMs).toBe(1100);
    expect(budget.now()).toBe(1000);
  });

  it('records and classifies a query sample', () => {
    clock = 1010;
    const record = budget.record('tenant-a', {
      sql: 'SELECT 1',
      durationMs: 60,
      rowsScanned: 5,
    });
    expect(record.tenantId).toBe('tenant-a');
    expect(record.timestampMs).toBe(1010);
    expect(record.classification).toBe('SLOW');
    expect(record.rowsScanned).toBe(5);
  });

  it('exposes classified counts via snapshot', () => {
    clock = 1020;
    budget.record('tenant-a', { durationMs: 300, rowsScanned: 2000 });
    const state = budget.snapshot('tenant-a');
    expect(state.used).toBe(2);
    expect(state.slowCount).toBe(1);
    expect(state.criticalCount).toBe(1);
    expect(state.fastCount).toBe(0);
    expect(state.records).toContain(state.records[0]);
  });

  it('isolates tenants from each other', () => {
    expect(budget.check('tenant-b').used).toBe(0);
    expect(budget.snapshot('tenant-a').used).toBe(2);
  });

  it('denies a check once the window is full', () => {
    const denied = budget.check('tenant-a');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('BUDGET_EXCEEDED');
    expect(denied.remaining).toBe(0);
  });

  it('leaves enforcement to the caller (record does not self-enforce)', () => {
    budget.record('tenant-a', { durationMs: 1 });
    expect(budget.snapshot('tenant-a').used).toBe(3);
  });

  it('prunes expired samples and re-allows the tenant', () => {
    expect(budget.prune()).toBe(0);
    clock = 1200;
    expect(budget.prune()).toBe(3);
    expect(budget.check('tenant-a').allowed).toBe(true);
    expect(budget.prune(5000)).toBe(0);
  });

  it('resets one tenant without touching others', () => {
    budget.record('tenant-a', { durationMs: 1 });
    budget.record('tenant-b', { durationMs: 1 });
    budget.reset('tenant-a');
    expect(budget.snapshot('tenant-a').used).toBe(0);
    expect(budget.snapshot('tenant-b').used).toBe(1);
  });

  it('rejects invalid tenants and samples', () => {
    expectCode(() => budget.check(''), 'INVALID_TENANT');
    expectCode(() => budget.check('   '), 'INVALID_TENANT');
    expectCode(() => budget.record('tenant-a', {}), 'INVALID_QUERY');
    expectCode(() => budget.record('tenant-a', { durationMs: 1, rowsScanned: -1 }), 'INVALID_QUERY');
    expectCode(() => budget.record('tenant-a', { durationMs: 1, sql: 123 }), 'INVALID_QUERY');
    expectCode(() => createQueryBudget({ maxQueriesPerWindow: 0 }), 'INVALID_CONFIG');
  });
});

describe('observability hooks', () => {
  it('emits metrics and warnings for budget decisions and classifications', () => {
    const counts = {
      accepted: 0, rejected: 0, recorded: 0, slow: 0,
      critical: 0, reset: 0, pruned: 0,
    };
    const warnings: string[] = [];
    let clock = 500;
    const budget = createQueryBudget(
      {
        maxQueriesPerWindow: 1,
        windowMs: 10,
        slowQueryThresholdMs: 10,
        criticalQueryThresholdMs: 100,
        nowMs: () => clock,
      },
      {
        recordQueryAccepted: () => { counts.accepted++; },
        recordQueryRejected: () => { counts.rejected++; },
        recordQueryRecorded: () => { counts.recorded++; },
        recordSlowQuery: () => { counts.slow++; },
        recordCriticalQuery: () => { counts.critical++; },
        recordBudgetReset: () => { counts.reset++; },
        recordBudgetPruned: () => { counts.pruned++; },
      },
      { warn: (message) => { warnings.push(message); } }
    );

    budget.check('obs');
    expect(counts.accepted).toBe(1);
    budget.record('obs', { durationMs: 20 });
    budget.record('obs', { durationMs: 200 });
    expect(counts.recorded).toBe(2);
    expect(counts.slow).toBe(1);
    expect(counts.critical).toBe(1);
    expect(warnings.length).toBe(2);
    expect(warnings[1]).toContain('critical');
    budget.check('obs');
    expect(counts.rejected).toBe(1);
    expect(warnings.length).toBe(3);
    clock = 600;
    budget.prune();
    expect(counts.pruned).toBe(1);
    budget.reset('obs');
    expect(counts.reset).toBe(1);
  });
});
