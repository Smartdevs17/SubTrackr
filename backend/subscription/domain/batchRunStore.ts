/**
 * In-memory batch run registry (Issue #1113).
 *
 * Persists recent batch executions so callers can fetch a run by id and query
 * aggregate statistics across runs.
 */

import type { BatchOperationInput, BatchOperationResult, BatchRun } from './batchAggregation';
import {
  aggregateBatchResults,
  isRolledBack,
  validateBatchSize,
} from './batchAggregation';

export type BatchExecutor = (
  input: BatchOperationInput
) => Promise<BatchOperationResult> | BatchOperationResult;

const MAX_RETAINED_RUNS = 50;

export class BatchRunStore {
  private runs = new Map<string, BatchRun>();
  private order: string[] = [];
  private seq = 0;

  reset(): void {
    this.runs.clear();
    this.order = [];
    this.seq = 0;
  }

  list(): BatchRun[] {
    return this.order.map((id) => this.runs.get(id)!).filter(Boolean);
  }

  get(id: string): BatchRun | undefined {
    return this.runs.get(id);
  }

  /**
   * Execute every operation through `executor`, collect per-item results and
   * persist the aggregated run.
   */
  async execute(
    inputs: BatchOperationInput[],
    executor: BatchExecutor,
    options: { atomic?: boolean } = {}
  ): Promise<BatchRun> {
    const atomic = options.atomic ?? true;
    const validation = validateBatchSize(inputs.length);
    if (!validation.valid) {
      throw new Error(validation.reason ?? 'Invalid batch.');
    }

    const startedAt = new Date().toISOString();
    const results: BatchOperationResult[] = [];
    for (const input of inputs) {
      results.push(await executor(input));
    }

    const rolledBack = isRolledBack(results, atomic);
    this.seq += 1;
    const run: BatchRun = {
      id: `batch_${this.seq}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      atomic,
      rolledBack,
      results,
      summary: aggregateBatchResults(results),
    };

    this.runs.set(run.id, run);
    this.order.push(run.id);
    while (this.order.length > MAX_RETAINED_RUNS) {
      const evicted = this.order.shift();
      if (evicted) this.runs.delete(evicted);
    }

    return run;
  }
}

export const batchRunStore = new BatchRunStore();
