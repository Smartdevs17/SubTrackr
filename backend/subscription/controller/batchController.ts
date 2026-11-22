/**
 * Batch operations controller (Issue #1113).
 *
 *   POST /subscriptions/batch        – execute many operations in one tx
 *   GET  /subscriptions/batch/stats  – aggregate statistics across runs
 *   GET  /subscriptions/batch/:runId – a single historical run
 */

import { fail, ok, type ApiResponse } from '../../services/shared/apiResponse';
import {
  aggregateRuns,
  estimateBatchGas,
  estimateSingleGas,
  MAX_BATCH_ITEMS,
  type BatchOperationInput,
  type BatchOperationResult,
} from '../../domain/batchAggregation';
import { batchRunStore, type BatchExecutor } from '../../domain/batchRunStore';
import type { BatchRun } from '../../domain/batchAggregation';

export interface ExecuteBatchBody {
  atomic?: boolean;
  operations?: BatchOperationInput[];
}

/** Aggregated statistics across every retained batch run. */
export interface BatchStatsView {
  runs: number;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  successRate: number;
  gasSaved: number;
  rolledBackRuns: number;
  gasModel: {
    batchBaseGas: number;
    gasPerItem: number;
    singleTransactionGas: number;
  };
  recentRuns: Array<{
    id: string;
    startedAt: string;
    rolledBack: boolean;
    totalOperations: number;
    successRate: number;
    gasSaved: number;
  }>;
}

export type BatchOutcome<T> =
  | { ok: true; status: number; response: ApiResponse<T> }
  | { ok: false; status: number; response: ApiResponse<never> };

const OPERATION_TYPES = ['create', 'update', 'charge', 'cancel', 'pause', 'resume'] as const;

/**
 * Default executor: validates each operation and reports the gas that the
 * batched transaction will consume instead of N separate transactions.
 */
export const defaultExecutor: BatchExecutor = (input): BatchOperationResult => {
  const valid =
    typeof input?.subscriptionId === 'string' &&
    input.subscriptionId.trim().length > 0 &&
    OPERATION_TYPES.includes(input.operation as (typeof OPERATION_TYPES)[number]);

  return {
    subscriptionId: input?.subscriptionId ?? '',
    operation: input?.operation ?? 'charge',
    success: valid,
    code: valid ? 200 : 422,
    reason: valid ? undefined : 'Unknown operation or missing subscriptionId',
    singleGas: estimateSingleGas(1),
  };
};

function success<T>(data: T, status: number, requestId?: string): BatchOutcome<T> {
  return { ok: true, status, response: ok(data, requestId) };
}

function error(
  code: Parameters<typeof fail>[0],
  message: string,
  status: number,
  requestId?: string
): BatchOutcome<never> {
  return { ok: false, status, response: fail(code, message, requestId) };
}

function normaliseOperations(raw: unknown): BatchOperationInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ops: BatchOperationInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const candidate = item as BatchOperationInput;
    if (typeof candidate.subscriptionId !== 'string') return null;
    if (typeof candidate.operation !== 'string') return null;
    ops.push({
      operation: candidate.operation as BatchOperationInput['operation'],
      subscriptionId: candidate.subscriptionId,
      ...(candidate.payload ? { payload: candidate.payload } : {}),
    });
  }
  return ops;
}

/** POST /subscriptions/batch */
export async function executeBatch(
  body: ExecuteBatchBody,
  requestId?: string,
  executor: BatchExecutor = defaultExecutor
): Promise<BatchOutcome<BatchRun>> {
  const operations = normaliseOperations(body?.operations);
  if (!operations) {
    return error(
      'USAGE_INVALID_EVENT',
      'Body must include a non-empty "operations" array',
      422,
      requestId
    );
  }
  if (operations.length > MAX_BATCH_ITEMS) {
    return error(
      'USAGE_BATCH_TOO_LARGE',
      `Batch exceeds the maximum of ${MAX_BATCH_ITEMS} operations`,
      413,
      requestId
    );
  }

  try {
    const run = await batchRunStore.execute(operations, executor, {
      atomic: body?.atomic ?? true,
    });
    return success(run, 201, requestId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Batch execution failed';
    return error('VALIDATION_ERROR', message, 422, requestId);
  }
}

/** GET /subscriptions/batch/stats */
export function getBatchStats(requestId?: string): BatchOutcome<BatchStatsView> {
  const runs = batchRunStore.list();
  return success(
    {
      ...aggregateRuns(runs),
      gasModel: {
        batchBaseGas: estimateBatchGas(0),
        gasPerItem: estimateBatchGas(1) - estimateBatchGas(0),
        singleTransactionGas: estimateSingleGas(1),
      },
      recentRuns: runs.map((run) => ({
        id: run.id,
        startedAt: run.startedAt,
        rolledBack: run.rolledBack,
        totalOperations: run.summary.totalOperations,
        successRate: run.summary.successRate,
        gasSaved: run.summary.gasSaved,
      })),
    },
    200,
    requestId
  );
}

/** GET /subscriptions/batch/:runId */
export function getBatchRun(runId: string, requestId?: string): BatchOutcome<BatchRun> {
  const run = batchRunStore.get(runId);
  if (!run) {
    return error('NOT_FOUND', `Batch run "${runId}" not found`, 404, requestId);
  }
  return success(run, 200, requestId);
}
