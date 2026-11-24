/**
 * backend/src/lib/__tests__/db.test.ts
 *
 * Integration tests for the budgeted query runner adapter (issue #2270).
 * The executor is injected, so these tests need no database and remain fully
 * deterministic via the budget's injected clock.
 */

import { createQueryBudget, QueryBudgetError } from '../queryBudget';
import { createBudgetedQueryRunner } from '../db';

describe('createBudgetedQueryRunner options', () => {
  it('rejects a missing budget controller', () => {
    expect(() => createBudgetedQueryRunner({} as any)).toThrow(QueryBudgetError);
  });

  it('rejects a missing executor', () => {
    const budget = createQueryBudget();
    expect(() => createBudgetedQueryRunner({ budget } as any)).toThrow(QueryBudgetError);
  });
});

describe('budgeted query execution', () => {
  let clock = 2000;
  let calls = 0;
  let receivedSql = '';
  let receivedParams: readonly unknown[] | undefined;
  const budget = createQueryBudget({
    maxQueriesPerWindow: 1,
    windowMs: 100,
    slowQueryThresholdMs: 20,
    criticalQueryThresholdMs: 100,
    nowMs: () => clock,
  });
  const executed: string[] = [];
  const failed: string[] = [];
  const runner = createBudgetedQueryRunner({
    budget,
    execute: async (sql, params) => {
      calls++;
      receivedSql = sql;
      receivedParams = params;
      return { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
    },
    metrics: {
      recordQueryExecuted: () => { executed.push('done'); },
      recordQueryFailed: () => { failed.push('failed'); },
    },
  });

  it('exposes the underlying budget controller', () => {
    expect(runner.budget).toBe(budget);
  });

  it('executes the query and returns the driver result', async () => {
    const result = await runner.run<{ rowCount: number }>('t1', 'SELECT * FROM t', [42]);
    expect(result.rowCount).toBe(2);
    expect(calls).toBe(1);
    expect(receivedSql).toBe('SELECT * FROM t');
    expect(receivedParams[0]).toBe(42);
  });

  it('emits execution metrics and records the classified query', () => {
    expect(executed).toContain('done');
    expect(budget.snapshot('t1').used).toBe(1);
    expect(budget.snapshot('t1').records[0].rowsScanned).toBe(2);
  });

  it('throws BUDGET_EXCEEDED before executing another query for the tenant', async () => {
    await expect(runner.run('t1', 'SELECT 2')).rejects.toThrow(QueryBudgetError);
    expect(calls).toBe(1);
  });

  it('rejects invalid tenants and SQL before executing', async () => {
    await expect(runner.run('', 'SELECT 1')).rejects.toThrow(QueryBudgetError);
    await expect(runner.run('t2', '  ')).rejects.toThrow(QueryBudgetError);
    expect(calls).toBe(1);
  });

  it('allows a fresh tenant after the window expires', async () => {
    clock = 2200;
    await runner.run('t3', 'SELECT 3');
    expect(calls).toBe(2);
  });

  it('reset returns void', async () => {
    await expect(runner.budget.reset('t3')).resolves.toBeUndefined();
  });
});

describe('adapter failure modes', () => {
  it('propagates executor errors without recording a query', async () => {
    let clock = 100;
    let calls = 0;
    const budget = createQueryBudget({ maxQueriesPerWindow: 5, nowMs: () => clock });
    const failures: string[] = [];
    const runner = createBudgetedQueryRunner({
      budget,
      execute: async () => {
        calls++;
        throw new Error('db down');
      },
      metrics: {
        recordQueryFailed: (_tenantId, _sql, code) => { failures.push(code); },
      },
    });

    await expect(runner.run('t4', 'SELECT 1')).rejects.toThrow(Error);
    expect(calls).toBe(1);
    expect(failures).toContain('EXECUTION_ERROR');
    expect(budget.snapshot('t4').used).toBe(0);
  });

  it('uses the injected clock for query duration and classification', async () => {
    let clock = 10;
    const budget = createQueryBudget({
      maxQueriesPerWindow: 5,
      slowQueryThresholdMs: 5,
      criticalQueryThresholdMs: 50,
      nowMs: () => clock,
    });
    const runner = createBudgetedQueryRunner({
      budget,
      execute: async () => {
        clock += 100;
        return [];
      },
    });
    await runner.run('t5', 'SELECT 1');
    const record = budget.snapshot('t5').records[0];
    expect(record.durationMs).toBe(100);
    expect(record.classification).toBe('CRITICAL');
  });

  it('honours a custom rows-scanned extractor', async () => {
    const budget = createQueryBudget({ maxQueriesPerWindow: 5, nowMs: () => 1 });
    const runner = createBudgetedQueryRunner({
      budget,
      execute: async () => ({ scanned: 77 }),
      extractRowsScanned: (result) => (result as { scanned: number }).scanned,
    });
    await runner.run('t6', 'SELECT 1');
    expect(budget.snapshot('t6').records[0].rowsScanned).toBe(77);
  });

  it('falls back to rowCount when no custom extractor is supplied', async () => {
    const budget = createQueryBudget({ maxQueriesPerWindow: 5, nowMs: () => 1 });
    const runner = createBudgetedQueryRunner({
      budget,
      execute: async () => ({ rowCount: 9 }),
    });
    await runner.run('t7', 'SELECT 1');
    expect(budget.snapshot('t7').records[0].rowsScanned).toBe(9);
  });
});
