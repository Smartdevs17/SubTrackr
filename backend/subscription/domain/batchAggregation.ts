/**
 * Subscription transaction batching and aggregation (Issue #1113).
 *
 * Batches many subscription operations into a single transaction so the
 * caller pays one base cost instead of N, then aggregates per-item outcomes
 * into a run summary (success rate, gas saved, failure breakdown).
 *
 * Pure calculation helpers live here so they can be unit tested without I/O.
 */

export type BatchOperation = 'create' | 'update' | 'charge' | 'cancel' | 'pause' | 'resume';

export interface BatchOperationInput {
  operation: BatchOperation;
  subscriptionId: string;
  payload?: Record<string, unknown>;
}

export interface BatchOperationResult {
  subscriptionId: string;
  operation: BatchOperation;
  success: boolean;
  code: number;
  reason?: string;
  /** Gas the operation would have consumed on its own. */
  singleGas: number;
}

export interface BatchRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  atomic: boolean;
  rolledBack: boolean;
  results: BatchOperationResult[];
  summary: BatchAggregation;
}

export interface BatchAggregation {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  successRate: number;
  gasSingle: number;
  gasBatch: number;
  gasSaved: number;
  /** Failure counts keyed by error code. */
  failuresByCode: Record<string, number>;
  /** Operation counts keyed by operation name. */
  operationsByType: Record<string, number>;
}

export const BATCH_BASE_GAS = 50_000;
export const GAS_PER_ITEM = 100_000;
const SINGLE_TX_GAS = 150_000;
export const MAX_BATCH_ITEMS = 100;

/** Gas required to execute `count` operations as one batch transaction. */
export function estimateBatchGas(count: number): number {
  if (count <= 0) return 0;
  return BATCH_BASE_GAS + count * GAS_PER_ITEM;
}

/** Gas required if every operation were submitted as its own transaction. */
export function estimateSingleGas(count: number): number {
  return Math.max(0, count) * SINGLE_TX_GAS;
}

/**
 * Aggregate per-item results into run statistics.
 * `gasBatch` is always the single-transaction cost, so `gasSaved` is the
 * difference between N separate transactions and one batched transaction.
 */
export function aggregateBatchResults(results: BatchOperationResult[]): BatchAggregation {
  const totalOperations = results.length;
  const successfulOperations = results.filter((r) => r.success).length;
  const failedOperations = totalOperations - successfulOperations;

  const failuresByCode: Record<string, number> = {};
  const operationsByType: Record<string, number> = {};

  for (const result of results) {
    operationsByType[result.operation] = (operationsByType[result.operation] ?? 0) + 1;
    if (!result.success) {
      const key = String(result.code);
      failuresByCode[key] = (failuresByCode[key] ?? 0) + 1;
    }
  }

  const gasSingle = estimateSingleGas(totalOperations);
  const gasBatch = estimateBatchGas(totalOperations);

  return {
    totalOperations,
    successfulOperations,
    failedOperations,
    successRate: totalOperations === 0 ? 1 : round4(successfulOperations / totalOperations),
    gasSingle,
    gasBatch,
    gasSaved: Math.max(0, gasSingle - gasBatch),
    failuresByCode,
    operationsByType,
  };
}

/**
 * When `atomic` is set the whole batch rolls back if any item failed, so a
 * partial-success run reports zero executed operations.
 */
export function isRolledBack(results: BatchOperationResult[], atomic: boolean): boolean {
  return atomic && results.some((r) => !r.success);
}

/** Reject batches that exceed the on-chain item limit. */
export function validateBatchSize(count: number): { valid: boolean; reason?: string } {
  if (!Number.isInteger(count) || count <= 0) {
    return { valid: false, reason: 'Batch must contain at least one operation.' };
  }
  if (count > MAX_BATCH_ITEMS) {
    return { valid: false, reason: `Batch exceeds the maximum of ${MAX_BATCH_ITEMS} operations.` };
  }
  return { valid: true };
}

/** Combine several historical runs into a portfolio-level rollup. */
export function aggregateRuns(runs: BatchRun[]): {
  runs: number;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  successRate: number;
  gasSaved: number;
  rolledBackRuns: number;
} {
  const totalOperations = runs.reduce((sum, run) => sum + run.summary.totalOperations, 0);
  const successfulOperations = runs.reduce(
    (sum, run) => sum + run.summary.successfulOperations,
    0
  );
  const gasSaved = runs.reduce((sum, run) => sum + run.summary.gasSaved, 0);
  const rolledBackRuns = runs.filter((run) => run.rolledBack).length;

  return {
    runs: runs.length,
    totalOperations,
    successfulOperations,
    failedOperations: totalOperations - successfulOperations,
    successRate: totalOperations === 0 ? 1 : round4(successfulOperations / totalOperations),
    gasSaved,
    rolledBackRuns,
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
