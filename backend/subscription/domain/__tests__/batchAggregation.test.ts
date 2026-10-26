/**
 * Unit tests for subscription transaction batching and aggregation (Issue #1113).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  aggregateBatchResults,
  aggregateRuns,
  BATCH_BASE_GAS,
  estimateBatchGas,
  estimateSingleGas,
  isRolledBack,
  validateBatchSize,
  MAX_BATCH_ITEMS,
  type BatchOperationResult,
  type BatchRun,
} from '../batchAggregation';
import { BatchRunStore } from '../batchRunStore';

function result(
  overrides: Partial<BatchOperationResult> & { subscriptionId: string }
): BatchOperationResult {
  return {
    operation: 'charge',
    success: true,
    code: 200,
    singleGas: estimateSingleGas(1),
    ...overrides,
  };
}

describe('gas estimation', () => {
  it('prices a batch as one base cost plus per-item cost', () => {
    expect(estimateBatchGas(0)).toBe(0);
    expect(estimateBatchGas(1)).toBe(BATCH_BASE_GAS + 100_000);
    expect(estimateBatchGas(10)).toBe(BATCH_BASE_GAS + 1_000_000);
  });

  it('prices N separate transactions individually', () => {
    expect(estimateSingleGas(10)).toBe(1_500_000);
    expect(estimateSingleGas(0)).toBe(0);
  });

  it('batching 10 items is cheaper than 10 single transactions', () => {
    expect(estimateBatchGas(10)).toBeLessThan(estimateSingleGas(10));
  });
});

describe('aggregateBatchResults', () => {
  it('summarises an all-success batch', () => {
    const summary = aggregateBatchResults([
      result({ subscriptionId: 'a' }),
      result({ subscriptionId: 'b' }),
      result({ subscriptionId: 'c', operation: 'create' }),
    ]);

    expect(summary.totalOperations).toBe(3);
    expect(summary.successfulOperations).toBe(3);
    expect(summary.failedOperations).toBe(0);
    expect(summary.successRate).toBe(1);
    expect(summary.gasSaved).toBeGreaterThan(0);
    expect(summary.operationsByType).toEqual({ charge: 2, create: 1 });
    expect(summary.failuresByCode).toEqual({});
  });

  it('groups failures by error code', () => {
    const summary = aggregateBatchResults([
      result({ subscriptionId: 'a' }),
      result({ subscriptionId: 'b', success: false, code: 402 }),
      result({ subscriptionId: 'c', success: false, code: 402 }),
      result({ subscriptionId: 'd', success: false, code: 404 }),
    ]);

    expect(summary.successfulOperations).toBe(1);
    expect(summary.failedOperations).toBe(3);
    expect(summary.successRate).toBe(0.25);
    expect(summary.failuresByCode).toEqual({ '402': 2, '404': 1 });
  });

  it('reports a perfect score for an empty batch', () => {
    const summary = aggregateBatchResults([]);
    expect(summary.successRate).toBe(1);
    expect(summary.totalOperations).toBe(0);
    expect(summary.gasSaved).toBe(0);
  });
});

describe('isRolledBack', () => {
  const failed = result({ subscriptionId: 'a', success: false, code: 500 });

  it('rolls back an atomic batch with a failure', () => {
    expect(isRolledBack([failed], true)).toBe(true);
  });

  it('keeps a non-atomic partial batch', () => {
    expect(isRolledBack([failed], false)).toBe(false);
  });

  it('never rolls back a clean atomic batch', () => {
    expect(isRolledBack([result({ subscriptionId: 'a' })], true)).toBe(false);
  });
});

describe('validateBatchSize', () => {
  it('accepts a batch within the limit', () => {
    expect(validateBatchSize(MAX_BATCH_ITEMS).valid).toBe(true);
  });

  it('rejects an empty batch', () => {
    expect(validateBatchSize(0).valid).toBe(false);
  });

  it('rejects a batch over the limit', () => {
    const result = validateBatchSize(MAX_BATCH_ITEMS + 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(String(MAX_BATCH_ITEMS));
  });
});

describe('aggregateRuns', () => {
  const run = (overrides: Partial<BatchRun>): BatchRun => ({
    id: 'batch_1',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    atomic: true,
    rolledBack: false,
    results: [],
    summary: aggregateBatchResults([]),
    ...overrides,
  });

  it('rolls up several runs', () => {
    const runs = [
      run({
        id: 'batch_1',
        summary: aggregateBatchResults([
          result({ subscriptionId: 'a' }),
          result({ subscriptionId: 'b', success: false, code: 500 }),
        ]),
      }),
      run({
        id: 'batch_2',
        rolledBack: true,
        summary: aggregateBatchResults([result({ subscriptionId: 'c' })]),
      }),
    ];

    const totals = aggregateRuns(runs);
    expect(totals.runs).toBe(2);
    expect(totals.totalOperations).toBe(3);
    expect(totals.successfulOperations).toBe(2);
    expect(totals.rolledBackRuns).toBe(1);
    expect(totals.gasSaved).toBeGreaterThan(0);
  });

  it('handles no runs', () => {
    expect(aggregateRuns([]).successRate).toBe(1);
  });
});

describe('BatchRunStore', () => {
  let store: BatchRunStore;

  beforeEach(() => {
    store = new BatchRunStore();
  });

  it('executes and retains a run with per-item results', async () => {
    const run = await store.execute(
      [
        { operation: 'charge', subscriptionId: 'a' },
        { operation: 'charge', subscriptionId: 'b' },
      ],
      (input) => result({ subscriptionId: input.subscriptionId })
    );

    expect(run.id).toBe('batch_1');
    expect(run.results).toHaveLength(2);
    expect(run.summary.successRate).toBe(1);
    expect(store.get(run.id)).toBeDefined();
    expect(store.list()).toHaveLength(1);
  });

  it('marks an atomic run with a failure as rolled back', async () => {
    const run = await store.execute(
      [{ operation: 'charge', subscriptionId: 'a' }],
      () => result({ subscriptionId: 'a', success: false, code: 402 }),
      { atomic: true }
    );
    expect(run.rolledBack).toBe(true);
  });

  it('rejects oversized batches', async () => {
    const inputs = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => ({
      operation: 'charge' as const,
      subscriptionId: `s${i}`,
    }));
    await expect(store.execute(inputs, (input) => result({ subscriptionId: input.subscriptionId }))).rejects.toThrow();
  });

  it('evicts the oldest runs beyond the retention window', async () => {
    for (let i = 0; i < 55; i += 1) {
      await store.execute(
        [{ operation: 'charge', subscriptionId: `s${i}` }],
        (input) => result({ subscriptionId: input.subscriptionId })
      );
    }
    expect(store.list().length).toBeLessThanOrEqual(50);
    store.reset();
    expect(store.list()).toHaveLength(0);
  });
});
