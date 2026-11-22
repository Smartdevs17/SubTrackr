/**
 * Proration Service – backend domain layer for subscription
 * upgrade / downgrade with transparent proration calculations.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1117
 */

import type {
  ProrationCalculationRequest,
  ProrationAnalyticsSummary,
  ProrationRecord,
} from '../../../src/types/prorationCalculator';
import {
  ProrationValidationError,
  calculateExactProration,
  validateExactProrationRequest,
  type ExactProrationResult,
} from '../../services/billing/prorationEngine';

export { ProrationValidationError } from '../../services/billing/prorationEngine';

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

function toMs(date: number | string | Date, fieldName: string): number {
  const value = typeof date === 'number'
    ? date
    : typeof date === 'string'
      ? new Date(date).getTime()
      : date.getTime();
  if (!Number.isFinite(value)) {
    throw new ProrationValidationError(`${fieldName} must be a valid date`);
  }
  return value;
}

export function calculateCycleDays(
  startDate: number | string | Date,
  endDate: number | string | Date,
): number {
  const start = toMs(startDate, 'startDate');
  const end = toMs(endDate, 'endDate');
  if (end < start) {
    throw new ProrationValidationError('endDate must be on or after startDate');
  }
  const diffMs = end - start;
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export function validateProrationRequest(request: ProrationCalculationRequest): void {
  validateExactProrationRequest(request);
}

export class ProrationService {
  private records: ProrationRecord[] = [];

  /**
   * Calculate a proration for a plan change without persisting.
   * Returns a preview that can be shown to the subscriber before confirming.
   */
  preview(request: ProrationCalculationRequest): ExactProrationResult {
    return this.calculate(request);
  }

  /**
   * Calculate and persist a proration record.
   * The record starts in `preview` status; call `apply()` to finalize.
   */
  calculateAndStore(request: ProrationCalculationRequest): ProrationRecord {
    const result = this.calculate(request);
    const record: ProrationRecord = {
      id: generateId('pr'),
      subscriptionId: request.subscriptionId ?? 'unknown',
      result,
      status: 'preview',
      createdAt: Date.now(),
    };
    this.records.push(record);
    return record;
  }

  /**
   * Mark a stored proration record as applied (confirmed by the subscriber).
   */
  apply(recordId: string): ProrationRecord | null {
    const record = this.records.find((r) => r.id === recordId);
    if (!record) return null;
    record.status = 'applied';
    record.appliedAt = Date.now();
    return record;
  }

  /**
   * Cancel a stored proration record that was only a preview.
   */
  cancel(recordId: string): ProrationRecord | null {
    const record = this.records.find((r) => r.id === recordId);
    if (!record) return null;
    record.status = 'cancelled';
    return record;
  }

  /** Retrieve a single proration record. */
  getRecord(recordId: string): ProrationRecord | undefined {
    return this.records.find((r) => r.id === recordId);
  }

  /** List all proration records for a subscription. */
  listBySubscription(subscriptionId: string): ProrationRecord[] {
    return this.records.filter((r) => r.subscriptionId === subscriptionId);
  }

  /** Build analytics from all stored records. */
  getAnalytics(): ProrationAnalyticsSummary {
    return buildProrationAnalytics(this.records);
  }

  // ── internal ──────────────────────────────────────────────

  private calculate(request: ProrationCalculationRequest): ExactProrationResult {
    return calculateExactProration(request);
  }
}

function buildProrationAnalytics(records: ProrationRecord[]): ProrationAnalyticsSummary {
  const totalCalculations = records.length;
  let totalUpgrades = 0;
  let totalDowngrades = 0;
  let totalCancellations = 0;
  let totalRevenue = 0;
  let totalCredits = 0;
  let amountSum = 0;

  const upgradePaths = new Map<string, number>();
  const monthlyData = new Map<string, { upgrades: number; downgrades: number; netRevenue: number }>();

  for (const record of records) {
    const { result } = record;
    const mode = result.mode;

    if (mode === 'upgrade') totalUpgrades++;
    else if (mode === 'downgrade') totalDowngrades++;
    else if (mode === 'cancellation') totalCancellations++;

    if (result.isCredit) totalCredits += result.netProratedAmount;
    else totalRevenue += result.netProratedAmount;

    amountSum += result.netProratedAmount;

    const pathKey = `${result.currentPlan.name} -> ${result.newPlan.name}`;
    upgradePaths.set(pathKey, (upgradePaths.get(pathKey) ?? 0) + 1);

    const monthKey = new Date(record.createdAt).toISOString().slice(0, 7);
    const existing = monthlyData.get(monthKey) ?? { upgrades: 0, downgrades: 0, netRevenue: 0 };
    if (mode === 'upgrade') existing.upgrades++;
    if (mode === 'downgrade') existing.downgrades++;
    existing.netRevenue += result.isCredit ? -result.netProratedAmount : result.netProratedAmount;
    monthlyData.set(monthKey, existing);
  }

  let mostCommonUpgradePath: ProrationAnalyticsSummary['mostCommonUpgradePath'] = null;
  let maxCount = 0;
  for (const [path, count] of upgradePaths) {
    if (count > maxCount) {
      maxCount = count;
      const [fromPlan, toPlan] = path.split(' -> ');
      mostCommonUpgradePath = { fromPlan, toPlan, count };
    }
  }

  const prorationVolumeByMonth = Array.from(monthlyData.entries())
    .map(([month, data]) => ({ month, ...data }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    totalCalculations,
    totalUpgrades,
    totalDowngrades,
    totalCancellations,
    totalProratedRevenueCollected: Math.round(totalRevenue * 100) / 100,
    totalCreditsIssued: Math.round(totalCredits * 100) / 100,
    averageProratedAmount:
      totalCalculations > 0 ? Math.round((amountSum / totalCalculations) * 100) / 100 : 0,
    mostCommonUpgradePath,
    prorationVolumeByMonth,
  };
}

export const prorationService = new ProrationService();
