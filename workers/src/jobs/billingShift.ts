/**
 * workers/src/jobs/billingShift.ts
 *
 * Issue #2252 — worker entry point for the billing-day shifter. The pure
 * scheduling logic lives in backend/src/services/billingShift.ts; this job
 * turns a plan into an idempotent, batched charge schedule the billing runner
 * can execute. No I/O is performed here — callers own persistence.
 */

import {
  createBillingShifter,
  type BillingShiftConfig,
  type ShiftPlan,
  type ShiftInput,
  type BillingShiftMetrics,
  type BillingShiftLogger,
} from '../../../backend/src/services/billingShift.ts';

export type BatchStatus = 'pending' | 'ready' | 'skipped';

export interface ChargeBatch {
  readonly key: string;
  readonly scheduledFor: string;
  readonly items: readonly ShiftInput[];
  readonly status: BatchStatus;
}

export interface BillingShiftJobResult {
  readonly batches: readonly ChargeBatch[];
  readonly plan: ShiftPlan;
  readonly rejected: number;
}

export interface BillingShiftJob {
  run(items: readonly ShiftInput[]): BillingShiftJobResult;
  readonly config: Readonly<BillingShiftConfig>;
}

/** Deterministic batch key for a target date (idempotency across retries). */
export function batchKey(scheduledFor: string): string {
  const day = scheduledFor.slice(0, 10);
  return `billing-shift:${day}`;
}

/**
 * Group shifted items by their consolidated date into stable, sorted batches.
 * Items rejected by the planner are omitted from batches but counted in result.
 */
export function buildBatches(plan: ShiftPlan): readonly ChargeBatch[] {
  const byDate = new Map<string, ShiftInput[]>();
  for (const shift of plan.shifts) {
    const key = shift.shiftedDate.slice(0, 10);
    const list = byDate.get(key) ?? [];
    list.push({ id: shift.id, dueDate: shift.originalDate });
    byDate.set(key, list);
  }
  const batches: ChargeBatch[] = [];
  const dates = Array.from(byDate.keys()).sort();
  for (const date of dates) {
    const items = (byDate.get(date) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
    batches.push(
      Object.freeze({
        key: batchKey(date),
        scheduledFor: `${date}T00:00:00.000Z`,
        items: Object.freeze(items),
        status: 'ready' as BatchStatus,
      }),
    );
  }
  return Object.freeze(batches);
}

export function createBillingShiftJob(
  config: Partial<BillingShiftConfig> = {},
  metrics: Partial<BillingShiftMetrics> = {},
  logger: Partial<BillingShiftLogger> = {},
): BillingShiftJob {
  const shifter = createBillingShifter(config, metrics, logger);

  function run(items: readonly ShiftInput[]): BillingShiftJobResult {
    const plan = shifter.plan(items);
    const batches = buildBatches(plan);
    return Object.freeze({
      batches,
      plan,
      rejected: plan.rejected.length,
    });
  }

  return Object.freeze({ run, config: shifter.config });
}
