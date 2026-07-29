import { Subscription, BillingCycle } from '../types/subscription';
import { InvoiceLineItem } from '../types/invoice';

export interface ProrationPreview {
  amount: number;
  isCredit: boolean;
  remainingDays: number;
  periodDays: number;
  oldDailyRate: number;
  newDailyRate: number;
  description: string;
  effectiveDate: 'immediate' | 'end_of_period';
}

export interface CreditMemo {
  subscriptionId: string;
  amount: number;
  reason: string;
  createdAt: Date;
  applied: boolean;
  remainingBalance: number;
}

const DAYS_IN_CYCLE: Record<BillingCycle, number> = {
  [BillingCycle.WEEKLY]: 7,
  [BillingCycle.MONTHLY]: 30,
  [BillingCycle.YEARLY]: 365,
  [BillingCycle.CUSTOM]: 30,
};

/**
 * Calculate days in a billing cycle
 */
export function getPeriodDays(cycle: BillingCycle): number {
  return DAYS_IN_CYCLE[cycle] ?? 30;
}

/**
 * Calculate remaining days in current billing period
 */
export function getRemainingDays(subscription: Subscription): number {
  const now = new Date();
  const nextBilling = new Date(subscription.nextBillingDate);
  const diffMs = nextBilling.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Preview proration before confirming plan change
 *
 * Formula: (newRate - oldRate) * remainingDays / periodDays
 */
export function previewProration(
  currentSubscription: Subscription,
  newPrice: number,
  effectiveDate: 'immediate' | 'end_of_period' = 'immediate'
): ProrationPreview {
  const periodDays = getPeriodDays(currentSubscription.billingCycle);
  const remainingDays =
    effectiveDate === 'end_of_period' ? 0 : getRemainingDays(currentSubscription);

  const oldRate = currentSubscription.price;
  const oldDailyRate = oldRate / periodDays;
  const newDailyRate = newPrice / periodDays;

  const rawAmount =
    effectiveDate === 'end_of_period' ? 0 : ((newPrice - oldRate) * remainingDays) / periodDays;

  // Round to 2 decimal places for currency
  const amount = Math.round(Math.abs(rawAmount) * 100) / 100;
  const isCredit = rawAmount < 0;

  let description: string;
  if (amount === 0) {
    description = 'No proration required';
  } else if (isCredit) {
    description = `Prorated credit of ${amount} for plan downgrade (${remainingDays} days remaining)`;
  } else {
    description = `Prorated charge of ${amount} for plan upgrade (${remainingDays} days remaining)`;
  }

  return {
    amount,
    isCredit,
    remainingDays,
    periodDays,
    oldDailyRate: Math.round(oldDailyRate * 100) / 100,
    newDailyRate: Math.round(newDailyRate * 100) / 100,
    description,
    effectiveDate,
  };
}

/**
 * Calculate immediate upgrade with prorated charge
 */
export function calculateUpgradeProration(
  currentSubscription: Subscription,
  newPrice: number
): ProrationPreview {
  return previewProration(currentSubscription, newPrice, 'immediate');
}

/**
 * Calculate immediate downgrade with prorated credit
 */
export function calculateDowngradeProration(
  currentSubscription: Subscription,
  newPrice: number
): ProrationPreview {
  return previewProration(currentSubscription, newPrice, 'immediate');
}

/**
 * Calculate end-of-period change (no proration)
 */
export function calculateEndOfPeriodChange(
  currentSubscription: Subscription,
  newPrice: number
): ProrationPreview {
  return previewProration(currentSubscription, newPrice, 'end_of_period');
}

/**
 * Generate credit memo for downgrade
 */
export function generateCreditMemo(
  subscriptionId: string,
  amount: number,
  reason: string
): CreditMemo {
  return {
    subscriptionId,
    amount,
    reason,
    createdAt: new Date(),
    applied: false,
    remainingBalance: amount,
  };
}

/**
 * Apply credit memo to reduce charge amount
 */
export function applyCreditMemo(
  chargeAmount: number,
  creditMemo: CreditMemo
): { finalCharge: number; updatedMemo: CreditMemo } {
  if (creditMemo.applied || creditMemo.remainingBalance <= 0) {
    return { finalCharge: chargeAmount, updatedMemo: creditMemo };
  }

  const creditToApply = Math.min(chargeAmount, creditMemo.remainingBalance);
  const newRemaining = creditMemo.remainingBalance - creditToApply;

  return {
    finalCharge: Math.round((chargeAmount - creditToApply) * 100) / 100,
    updatedMemo: {
      ...creditMemo,
      remainingBalance: Math.round(newRemaining * 100) / 100,
      applied: newRemaining <= 0,
    },
  };
}

/**
 * Handle multiple changes within one cycle
 */
export function calculateNetProration(
  currentSubscription: Subscription,
  priceChanges: {
    oldPrice: number;
    newPrice: number;
    effectiveDate: 'immediate' | 'end_of_period';
  }[]
): ProrationPreview {
  let netAmount = 0;

  for (const change of priceChanges) {
    const result = previewProration(
      { ...currentSubscription, price: change.oldPrice },
      change.newPrice,
      change.effectiveDate
    );
    netAmount += result.isCredit ? -result.amount : result.amount;
  }

  const isCredit = netAmount < 0;
  const amount = Math.round(Math.abs(netAmount) * 100) / 100;

  return {
    amount,
    isCredit,
    remainingDays: getRemainingDays(currentSubscription),
    periodDays: getPeriodDays(currentSubscription.billingCycle),
    oldDailyRate: 0,
    newDailyRate: 0,
    description:
      amount === 0
        ? 'No net proration for multiple plan changes'
        : `Net ${isCredit ? 'credit' : 'charge'} of ${amount} for multiple plan changes`,
    effectiveDate: 'immediate',
  };
}

/**
 * Check if proration rounds to zero
 */
export function isZeroProration(preview: ProrationPreview): boolean {
  return preview.amount === 0;
}

/**
 * Build proration line item for invoice
 */
export function buildProrationLineItem(
  preview: ProrationPreview,
  currency: string
): InvoiceLineItem {
  return {
    description: preview.description,
    quantity: 1,
    unitPrice: preview.amount,
    currency,
    exchangeRate: 1,
    taxRateBps: 0, // Prorations typically not taxed separately
    lineTotal: preview.isCredit ? -preview.amount : preview.amount,
  };
}

/**
 * Proration configuration per plan
 */
export interface ProrationPlanConfig {
  planId: string;
  method: 'daily' | 'hourly' | 'none';
  allowMidCycleChanges: boolean;
  maxChangesPerCycle: number;
  creditExpirationDays: number;
  prorationPrecision: number;
}

export const DEFAULT_PRORATION_CONFIG: ProrationPlanConfig = {
  planId: 'default',
  method: 'daily',
  allowMidCycleChanges: true,
  maxChangesPerCycle: 3,
  creditExpirationDays: 90,
  prorationPrecision: 2,
};

/**
 * Proration analytics data
 */
export interface ProrationAnalyticsData {
  totalProrations: number;
  totalCreditsIssued: number;
  totalChargesApplied: number;
  netProrationAmount: number;
  averageProrationAmount: number;
  prorationCount: number;
  creditsUsedCount: number;
  chargesCount: number;
}

/**
 * Calculate proration with hourly granularity
 */
export function calculateHourlyProration(
  currentSubscription: Subscription,
  newPrice: number,
  effectiveDate: 'immediate' | 'end_of_period' = 'immediate'
): ProrationPreview {
  const periodDays = getPeriodDays(currentSubscription.billingCycle);
  const periodHours = periodDays * 24;
  const remainingDays =
    effectiveDate === 'end_of_period' ? 0 : getRemainingDays(currentSubscription);
  const remainingHours = remainingDays * 24;

  const rawAmount =
    effectiveDate === 'end_of_period'
      ? 0
      : ((newPrice - currentSubscription.price) * remainingHours) / periodHours;

  const amount = Math.round(Math.abs(rawAmount) * 100) / 100;
  const isCredit = rawAmount < 0;

  let description: string;
  if (amount === 0) {
    description = 'No proration required';
  } else if (isCredit) {
    description = `Prorated credit of ${amount} for plan downgrade (${remainingHours} hours remaining)`;
  } else {
    description = `Prorated charge of ${amount} for plan upgrade (${remainingHours} hours remaining)`;
  }

  return {
    amount,
    isCredit,
    remainingDays,
    periodDays,
    oldDailyRate: Math.round((currentSubscription.price / periodDays) * 100) / 100,
    newDailyRate: Math.round((newPrice / periodDays) * 100) / 100,
    description,
    effectiveDate,
  };
}

/**
 * Build proration analytics from a list of previews
 */
export function buildProrationAnalytics(previews: ProrationPreview[]): ProrationAnalyticsData {
  let totalCredits = 0;
  let totalCharges = 0;
  let creditsCount = 0;
  let chargesCount = 0;

  for (const preview of previews) {
    if (preview.isCredit) {
      totalCredits += preview.amount;
      creditsCount++;
    } else if (preview.amount > 0) {
      totalCharges += preview.amount;
      chargesCount++;
    }
  }

  const totalProrations = previews.length;
  const allAmounts = previews.map((p) => p.amount).filter((a) => a > 0);
  const averageAmount =
    allAmounts.length > 0
      ? Math.round((allAmounts.reduce((s, a) => s + a, 0) / allAmounts.length) * 100) / 100
      : 0;

  return {
    totalProrations,
    totalCreditsIssued: totalCredits,
    totalChargesApplied: totalCharges,
    netProrationAmount: Math.round((totalCharges - totalCredits) * 100) / 100,
    averageProrationAmount: averageAmount,
    prorationCount: totalProrations,
    creditsUsedCount: creditsCount,
    chargesCount,
  };
}

/**
 * Check if a subscription has exceeded its per-cycle change limit
 */
export function hasExceededChangeLimit(
  changeHistory: { applied: boolean; timestamp: Date }[],
  maxChangesPerCycle: number,
  cycleStart: Date
): boolean {
  const changesInCycle = changeHistory.filter(
    (c) => c.applied && c.timestamp.getTime() >= cycleStart.getTime()
  );
  return changesInCycle.length >= maxChangesPerCycle;
}

/**
 * Check if a credit memo has expired
 */
export function isCreditMemoExpired(creditMemo: CreditMemo, expirationDays: number): boolean {
  if (creditMemo.applied) return true;
  const now = new Date();
  const createdAt = new Date(creditMemo.createdAt);
  const diffMs = now.getTime() - createdAt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > expirationDays;
}
