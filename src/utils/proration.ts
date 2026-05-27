import { Subscription, BillingCycle } from '../types/subscription';
import { InvoiceLineItem, InvoicePeriod } from '../types/invoice';

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
  [BillingCycle.DAILY]: 1,
  [BillingCycle.WEEKLY]: 7,
  [BillingCycle.BIWEEKLY]: 14,
  [BillingCycle.MONTHLY]: 30,
  [BillingCycle.BIMONTHLY]: 60,
  [BillingCycle.QUARTERLY]: 90,
  [BillingCycle.SEMI_ANNUALLY]: 182,
  [BillingCycle.ANNUALLY]: 365,
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
  const remainingDays = effectiveDate === 'end_of_period' ? 0 : getRemainingDays(currentSubscription);
  
  const oldRate = currentSubscription.price;
  const oldDailyRate = oldRate / periodDays;
  const newDailyRate = newPrice / periodDays;
  
  const rawAmount = effectiveDate === 'end_of_period' 
    ? 0 
    : (newPrice - oldRate) * remainingDays / periodDays;
  
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
  priceChanges: Array<{ oldPrice: number; newPrice: number; effectiveDate: 'immediate' | 'end_of_period' }>
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
    description: amount === 0 
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