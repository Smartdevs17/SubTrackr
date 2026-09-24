/**
 * Proration Service – backend domain layer for subscription
 * upgrade / downgrade with transparent proration calculations.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1117
 */

import { BillingCycle } from '../../../src/types/subscription';
import type {
  ProrationConfig,
  ProrationCalculationRequest,
  ProrationCalculationResult,
  ProrationBreakdownItem,
  ProrationAnalyticsSummary,
  ProrationRecord,
  ProrationMode,
} from '../../../src/types/prorationCalculator';
import { DEFAULT_PRORATION_CONFIG } from '../../../src/types/prorationCalculator';

const DAYS_PER_CYCLE: Record<BillingCycle, number> = {
  [BillingCycle.WEEKLY]: 7,
  [BillingCycle.MONTHLY]: 30,
  [BillingCycle.YEARLY]: 365,
  [BillingCycle.CUSTOM]: 30,
};

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

function toMs(date: number | string | Date): number {
  if (typeof date === 'number') return date;
  if (typeof date === 'string') return new Date(date).getTime();
  return date.getTime();
}

export function calculateCycleDays(
  startDate: number | string | Date,
  endDate: number | string | Date,
): number {
  const start = toMs(startDate);
  const end = toMs(endDate);
  const diffMs = Math.max(0, end - start);
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export class ProrationService {
  private records: ProrationRecord[] = [];

  /**
   * Calculate a proration for a plan change without persisting.
   * Returns a preview that can be shown to the subscriber before confirming.
   */
  preview(request: ProrationCalculationRequest): ProrationCalculationResult {
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

  private calculate(request: ProrationCalculationRequest): ProrationCalculationResult {
    const config: ProrationConfig = { ...DEFAULT_PRORATION_CONFIG, ...request.config };
    const effectiveMs = request.effectiveDate ? toMs(request.effectiveDate) : Date.now();
    const startMs = toMs(request.cycleStartDate);
    const endMs = toMs(request.cycleEndDate);

    const cycleTotalDays = calculateCycleDays(startMs, endMs);
    const daysUsed = Math.max(
      0,
      Math.min(cycleTotalDays, calculateCycleDays(startMs, effectiveMs)),
    );
    const daysRemaining = Math.max(0, cycleTotalDays - daysUsed);

    const oldDailyRate = request.currentPrice / cycleTotalDays;
    const newCycleTotalDays = DAYS_PER_CYCLE[request.newCycle] ?? cycleTotalDays;
    const newDailyRate = request.newPrice / newCycleTotalDays;

    const unusedAmount = Math.round(oldDailyRate * daysRemaining * 100) / 100;
    const proratedNewAmount = Math.round(newDailyRate * daysRemaining * 100) / 100;

    const rawNet = proratedNewAmount - unusedAmount;
    const isCredit = rawNet < 0;
    const netProratedAmount = Math.round(Math.abs(rawNet) * 100) / 100;

    let mode: ProrationMode = request.mode ?? 'upgrade';
    if (!request.mode) {
      if (request.newPrice > request.currentPrice) mode = 'upgrade';
      else if (request.newPrice < request.currentPrice) mode = 'downgrade';
      else if (request.newCycle !== request.currentCycle) mode = 'billing_cycle_change';
    }

    let taxAmount = 0;
    if (config.includeTax && config.defaultTaxRate > 0) {
      taxAmount = Math.round(((rawNet * config.defaultTaxRate) / 100) * 100) / 100;
    }

    const totalAmountDue = Math.max(0, Math.round((rawNet + taxAmount) * 100) / 100);

    const breakdown: ProrationBreakdownItem[] = [
      {
        id: generateId('item'),
        label: `Unused time on ${request.currentPlanName}`,
        description: `Credit for ${daysRemaining} unused days of ${cycleTotalDays}-day billing cycle`,
        unitPrice: request.currentPrice,
        dailyRate: Math.round(oldDailyRate * 100) / 100,
        daysActive: daysUsed,
        daysRemaining,
        totalCycleDays: cycleTotalDays,
        amount: unusedAmount,
        isCredit: true,
        type: 'unused_portion',
      },
      {
        id: generateId('item'),
        label: `Prorated charge for ${request.newPlanName}`,
        description: `Charge for ${daysRemaining} remaining days on new plan`,
        unitPrice: request.newPrice,
        dailyRate: Math.round(newDailyRate * 100) / 100,
        daysActive: 0,
        daysRemaining,
        totalCycleDays: newCycleTotalDays,
        amount: proratedNewAmount,
        isCredit: false,
        type: 'new_portion',
      },
    ];

    if (taxAmount !== 0) {
      breakdown.push({
        id: generateId('item'),
        label: `Tax (${config.defaultTaxRate}%)`,
        description: 'Tax calculated on net prorated adjustment',
        unitPrice: taxAmount,
        dailyRate: 0,
        daysActive: 0,
        daysRemaining,
        totalCycleDays: cycleTotalDays,
        amount: Math.abs(taxAmount),
        isCredit: taxAmount < 0,
        type: 'tax',
      });
    }

    const explanationText = this.generateExplanation({
      mode,
      currentPlanName: request.currentPlanName,
      newPlanName: request.newPlanName,
      daysRemaining,
      cycleTotalDays,
      unusedAmount,
      proratedNewAmount,
      netProratedAmount,
      isCredit,
      currency: config.currency,
    });

    return {
      id: generateId('proration'),
      mode,
      currentPlan: {
        id: request.currentPlanId,
        name: request.currentPlanName,
        price: request.currentPrice,
        cycle: request.currentCycle,
        unusedDays: daysRemaining,
        unusedAmount,
        dailyRate: Math.round(oldDailyRate * 100) / 100,
      },
      newPlan: {
        id: request.newPlanId,
        name: request.newPlanName,
        price: request.newPrice,
        cycle: request.newCycle,
        remainingDays: daysRemaining,
        proratedAmount: proratedNewAmount,
        dailyRate: Math.round(newDailyRate * 100) / 100,
      },
      cycleTotalDays,
      daysUsed,
      daysRemaining,
      netProratedAmount,
      taxAmount,
      totalAmountDue,
      isCredit,
      effectiveDate: effectiveMs,
      breakdown,
      explanationText,
      transparencySummary: {
        unusedCreditFromOldPlan: unusedAmount,
        chargeForNewPlan: proratedNewAmount,
        netAdjustment: isCredit ? -netProratedAmount : netProratedAmount,
        taxApplied: taxAmount,
        finalAmountToBillOrCredit: isCredit ? -netProratedAmount : totalAmountDue,
      },
      createdAt: Date.now(),
    };
  }

  private generateExplanation(p: {
    mode: ProrationMode;
    currentPlanName: string;
    newPlanName: string;
    daysRemaining: number;
    cycleTotalDays: number;
    unusedAmount: number;
    proratedNewAmount: number;
    netProratedAmount: number;
    isCredit: boolean;
    currency: string;
  }): string {
    const sym = p.currency === 'USD' ? '$' : `${p.currency} `;
    if (p.isCredit) {
      return (
        `Switching from ${p.currentPlanName} to ${p.newPlanName} with ${p.daysRemaining} of ${p.cycleTotalDays} days remaining. ` +
        `You receive a credit of ${sym}${p.unusedAmount.toFixed(2)} for unused time and pay ${sym}${p.proratedNewAmount.toFixed(2)} for your new plan. ` +
        `Your account will be credited ${sym}${p.netProratedAmount.toFixed(2)} toward future invoices.`
      );
    }
    return (
      `Switching from ${p.currentPlanName} to ${p.newPlanName} with ${p.daysRemaining} of ${p.cycleTotalDays} days remaining. ` +
      `You are credited ${sym}${p.unusedAmount.toFixed(2)} for unused time on ${p.currentPlanName} and charged ${sym}${p.proratedNewAmount.toFixed(2)} for the remaining ${p.daysRemaining} days on ${p.newPlanName}. ` +
      `Your net due today is ${sym}${p.netProratedAmount.toFixed(2)}.`
    );
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
