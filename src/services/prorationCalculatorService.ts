/**
 * Subscription Proration Calculator Service
 *
 * Provides transparent, exact-day proration calculations for plan upgrades,
 * downgrades, cancellations, and billing cycle changes.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/784
 */

import { BillingCycle } from '../types/subscription';
import type {
  ProrationConfig,
  ProrationCalculationRequest,
  ProrationCalculationResult,
  ProrationBreakdownItem,
  ProrationAnalyticsSummary,
  ProrationRecord,
  ProrationMode,
} from '../types/prorationCalculator';
import { DEFAULT_PRORATION_CONFIG } from '../types/prorationCalculator';

const DAYS_PER_CYCLE: Record<BillingCycle, number> = {
  [BillingCycle.WEEKLY]: 7,
  [BillingCycle.MONTHLY]: 30,
  [BillingCycle.YEARLY]: 365,
  [BillingCycle.CUSTOM]: 30,
};

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

function toMs(date: number | string | Date): number {
  if (typeof date === 'number') return date;
  if (typeof date === 'string') return new Date(date).getTime();
  return date.getTime();
}

/**
 * Calculate total days between two dates.
 */
export function calculateCycleDays(startDate: number | string | Date, endDate: number | string | Date): number {
  const start = toMs(startDate);
  const end = toMs(endDate);
  const diffMs = Math.max(0, end - start);
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Main transparent proration calculator function.
 */
export function calculateProration(request: ProrationCalculationRequest): ProrationCalculationResult {
  const config: ProrationConfig = { ...DEFAULT_PRORATION_CONFIG, ...request.config };
  const effectiveMs = request.effectiveDate ? toMs(request.effectiveDate) : Date.now();
  const startMs = toMs(request.cycleStartDate);
  const endMs = toMs(request.cycleEndDate);

  const cycleTotalDays = calculateCycleDays(startMs, endMs);
  const daysUsed = Math.max(0, Math.min(cycleTotalDays, calculateCycleDays(startMs, effectiveMs)));
  const daysRemaining = Math.max(0, cycleTotalDays - daysUsed);

  // Daily rates
  const oldDailyRate = request.currentPrice / cycleTotalDays;

  // New cycle days (handle cycle change if applicable)
  const newCycleTotalDays = DAYS_PER_CYCLE[request.newCycle] ?? cycleTotalDays;
  const newDailyRate = request.newPrice / newCycleTotalDays;

  // Unused amount from current plan
  const unusedAmountRaw = oldDailyRate * daysRemaining;
  const unusedAmount = Math.round(unusedAmountRaw * 100) / 100;

  // Charge for new plan for the remaining days
  const proratedNewAmountRaw = newDailyRate * daysRemaining;
  const proratedNewAmount = Math.round(proratedNewAmountRaw * 100) / 100;

  // Net amount
  const rawNet = proratedNewAmount - unusedAmount;
  const isCredit = rawNet < 0;
  const netProratedAmount = Math.round(Math.abs(rawNet) * 100) / 100;

  // Determine mode if not specified
  let mode: ProrationMode = request.mode ?? 'upgrade';
  if (!request.mode) {
    if (request.newPrice > request.currentPrice) mode = 'upgrade';
    else if (request.newPrice < request.currentPrice) mode = 'downgrade';
    else if (request.newCycle !== request.currentCycle) mode = 'billing_cycle_change';
  }

  // Tax calculation
  let taxAmount = 0;
  if (config.includeTax && config.defaultTaxRate > 0) {
    taxAmount = Math.round(((rawNet * config.defaultTaxRate) / 100) * 100) / 100;
  }

  const totalAmountDue = Math.max(0, Math.round((rawNet + taxAmount) * 100) / 100);

  // Detailed breakdown for transparency
  const breakdown: ProrationBreakdownItem[] = [
    {
      id: generateId('item'),
      label: `Unused time on ${request.currentPlanName}`,
      description: `Credit for ${daysRemaining} unused days of ${cycleTotalDays} day billing cycle (${request.currentPlanName} at $${oldDailyRate.toFixed(2)}/day)`,
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
      description: `Charge for ${daysRemaining} remaining days on new plan (${request.newPlanName} at $${newDailyRate.toFixed(2)}/day)`,
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
      description: `Tax calculated on net prorated adjustment`,
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

  // Generate transparent human-readable explanation
  const explanationText = generateExplanationText({
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
    id: generateId('proration-calc'),
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

function generateExplanationText(params: {
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
  const {
    currentPlanName,
    newPlanName,
    daysRemaining,
    cycleTotalDays,
    unusedAmount,
    proratedNewAmount,
    netProratedAmount,
    isCredit,
    currency,
  } = params;

  const symbol = currency === 'USD' ? '$' : `${currency} `;

  if (isCredit) {
    return (
      `Switching from ${currentPlanName} to ${newPlanName} with ${daysRemaining} of ${cycleTotalDays} days remaining. ` +
      `You receive a credit of ${symbol}${unusedAmount.toFixed(2)} for unused time and pay ${symbol}${proratedNewAmount.toFixed(2)} for your new plan. ` +
      `Your account will be credited ${symbol}${netProratedAmount.toFixed(2)} toward future invoices.`
    );
  }

  return (
    `Switching from ${currentPlanName} to ${newPlanName} with ${daysRemaining} of ${cycleTotalDays} days remaining. ` +
    `You are credited ${symbol}${unusedAmount.toFixed(2)} for unused time on ${currentPlanName} and charged ${symbol}${proratedNewAmount.toFixed(2)} for the remaining ${daysRemaining} days on ${newPlanName}. ` +
    `Your net due today is ${symbol}${netProratedAmount.toFixed(2)}.`
  );
}

/**
 * Generate analytics from a list of proration records.
 */
export function buildProrationAnalytics(records: ProrationRecord[]): ProrationAnalyticsSummary {
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

    if (result.isCredit) {
      totalCredits += result.netProratedAmount;
    } else {
      totalRevenue += result.netProratedAmount;
    }

    amountSum += result.netProratedAmount;

    // Track upgrade paths
    const pathKey = `${result.currentPlan.name} -> ${result.newPlan.name}`;
    upgradePaths.set(pathKey, (upgradePaths.get(pathKey) ?? 0) + 1);

    // Monthly aggregation
    const monthKey = new Date(record.createdAt).toISOString().slice(0, 7);
    const existingMonth = monthlyData.get(monthKey) ?? { upgrades: 0, downgrades: 0, netRevenue: 0 };
    if (mode === 'upgrade') existingMonth.upgrades++;
    if (mode === 'downgrade') existingMonth.downgrades++;
    existingMonth.netRevenue += result.isCredit ? -result.netProratedAmount : result.netProratedAmount;
    monthlyData.set(monthKey, existingMonth);
  }

  // Find most common upgrade path
  let mostCommonUpgradePath: ProrationAnalyticsSummary['mostCommonUpgradePath'] = null;
  let maxPathCount = 0;
  for (const [path, count] of upgradePaths) {
    if (count > maxPathCount) {
      maxPathCount = count;
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
    averageProratedAmount: totalCalculations > 0 ? Math.round((amountSum / totalCalculations) * 100) / 100 : 0,
    mostCommonUpgradePath,
    prorationVolumeByMonth,
  };
}
