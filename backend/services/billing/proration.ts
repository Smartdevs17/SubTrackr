import { BillingCycle, Subscription } from '../../../src/types/subscription';

export interface ProrationResult {
  /** Charge amount (positive) or credit amount (positive value representing credit) */
  amount: number;
  /** True if this proration yields a credit to the subscriber */
  isCredit: boolean;
  /** Remaining days left in the current billing cycle */
  remainingDays: number;
  /** Remaining seconds left in current billing cycle */
  remainingSeconds: number;
  /** Total days in current billing period */
  periodDays: number;
  /** Total seconds in current billing period */
  periodSeconds: number;
  /** Unused value of old plan */
  unusedOldValue: number;
  /** Prorated value of new plan for remaining period */
  proratedNewValue: number;
  /** Daily rate of old plan */
  oldDailyRate: number;
  /** Daily rate of new plan */
  newDailyRate: number;
  /** Human-readable explanation */
  description: string;
  /** Effective timing of change */
  effectiveDate: 'immediate' | 'end_of_period';
}

export interface CreditMemo {
  id: string;
  subscriptionId: string;
  amount: number;
  remainingBalance: number;
  reason: string;
  createdAt: Date;
  applied: boolean;
}

export interface MidCycleChangeRequest {
  subscription: Subscription;
  newPrice: number;
  newBillingCycle?: BillingCycle;
  effectiveDate?: 'immediate' | 'end_of_period';
  customPeriodDays?: number;
}

const CYCLE_DAYS: Record<string, number> = {
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
  * Calculate duration of a billing cycle in days
  */
export function getCycleDays(cycle: BillingCycle): number {
  return CYCLE_DAYS[cycle] ?? 30;
}

/**
  * Calculate duration of a billing cycle in seconds
  */
export function getCycleSeconds(cycle: BillingCycle): number {
  return getCycleDays(cycle) * 86400;
}

/**
  * Generate a unique credit memo ID
  */
function generateMemoId(): string {
  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

export class ProrationEngine {
  /**
    * Calculate proration for mid-cycle plan or interval changes
    *
    * Formula:
    * Unused Old Value = (Old Price / Total Period) * Remaining Period
    * Prorated New Value = (New Price / Total Period) * Remaining Period
    * Net Adjustment = Prorated New Value - Unused Old Value
    */
  public static calculateMidCycleProration(request: MidCycleChangeRequest): ProrationResult {
    const { subscription, newPrice, newBillingCycle, effectiveDate = 'immediate' } = request;

    const now = new Date();
    const nextBilling = new Date(subscription.nextBillingDate);
    const targetCycle = newBillingCycle ?? subscription.billingCycle;

    const periodDays = request.customPeriodDays ?? getCycleDays(subscription.billingCycle);
    const periodSeconds = periodDays * 86400;

    if (effectiveDate === 'end_of_period' || nextBilling <= now) {
      return {
        amount: 0,
        isCredit: false,
        remainingDays: 0,
        remainingSeconds: 0,
        periodDays,
        periodSeconds,
        unusedOldValue: 0,
        proratedNewValue: 0,
        oldDailyRate: Math.round((subscription.price / periodDays) * 100) / 100,
        newDailyRate: Math.round((newPrice / getCycleDays(targetCycle)) * 100) / 100,
        description: 'Plan change takes effect at the end of current billing period (no proration)',
        effectiveDate: 'end_of_period',
      };
    }

    const remainingMs = Math.max(0, nextBilling.getTime() - now.getTime());
    const remainingSeconds = Math.floor(remainingMs / 1000);
    const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));

    const oldDailyRate = subscription.price / periodDays;
    const newCycleDays = getCycleDays(targetCycle);
    const newDailyRate = newPrice / newCycleDays;

    // Proration math based on exact second ratio
    const fractionRemaining = remainingSeconds / periodSeconds;
    const unusedOldValue = subscription.price * fractionRemaining;
    const proratedNewValue = newPrice * fractionRemaining;

    const netAdjustment = proratedNewValue - unusedOldValue;
    const isCredit = netAdjustment < 0;
    const rawAmount = Math.abs(netAdjustment);
    const amount = Math.round(rawAmount * 100) / 100;

    let description: string;
    if (amount === 0) {
      description = 'No net proration required for this plan change';
    } else if (isCredit) {
      description = `Prorated credit of $${amount.toFixed(2)} applied for plan downgrade (${remainingDays} days remaining)`;
    } else {
      description = `Prorated charge of $${amount.toFixed(2)} for mid-cycle plan upgrade (${remainingDays} days remaining)`;
    }

    return {
      amount,
      isCredit,
      remainingDays,
      remainingSeconds,
      periodDays,
      periodSeconds,
      unusedOldValue: Math.round(unusedOldValue * 100) / 100,
      proratedNewValue: Math.round(proratedNewValue * 100) / 100,
      oldDailyRate: Math.round(oldDailyRate * 100) / 100,
      newDailyRate: Math.round(newDailyRate * 100) / 100,
      description,
      effectiveDate: 'immediate',
    };
  }

  /**
    * Create a credit memo for downgrade credits or unused balances
    */
  public static generateCreditMemo(
    subscriptionId: string,
    amount: number,
    reason: string
  ): CreditMemo {
    const roundedAmount = Math.round(Math.abs(amount) * 100) / 100;
    return {
      id: generateMemoId(),
      subscriptionId,
      amount: roundedAmount,
      remainingBalance: roundedAmount,
      reason,
      createdAt: new Date(),
      applied: roundedAmount <= 0,
    };
  }

  /**
    * Apply credit memo balance to reduce upcoming charge
    */
  public static applyCreditBalance(
    chargeAmount: number,
    creditMemo: CreditMemo
  ): { finalCharge: number; updatedMemo: CreditMemo; creditApplied: number } {
    if (creditMemo.applied || creditMemo.remainingBalance <= 0) {
      return { finalCharge: chargeAmount, updatedMemo: creditMemo, creditApplied: 0 };
    }

    const creditApplied = Math.min(chargeAmount, creditMemo.remainingBalance);
    const remainingBalance = creditMemo.remainingBalance - creditApplied;
    const finalCharge = Math.round((chargeAmount - creditApplied) * 100) / 100;
    const roundedRemaining = Math.round(remainingBalance * 100) / 100;

    return {
      finalCharge,
      creditApplied: Math.round(creditApplied * 100) / 100,
      updatedMemo: {
        ...creditMemo,
        remainingBalance: roundedRemaining,
        applied: roundedRemaining <= 0,
      },
    };
  }

  /**
    * Calculate aggregate net proration for multiple sequential changes in one cycle
    */
  public static calculateNetProration(
    subscription: Subscription,
    changes: Array<{ newPrice: number; newBillingCycle?: BillingCycle; effectiveDate?: 'immediate' | 'end_of_period' }>
  ): ProrationResult {
    let currentSub = { ...subscription };
    let totalAdjustment = 0;
    let lastResult: ProrationResult | null = null;

    for (const change of changes) {
      const res = this.calculateMidCycleProration({
        subscription: currentSub,
        newPrice: change.newPrice,
        newBillingCycle: change.newBillingCycle,
        effectiveDate: change.effectiveDate,
      });

      totalAdjustment += res.isCredit ? -res.amount : res.amount;
      currentSub = { ...currentSub, price: change.newPrice };
      if (change.newBillingCycle) {
        currentSub.billingCycle = change.newBillingCycle;
      }
      lastResult = res;
    }

    const isCredit = totalAdjustment < 0;
    const amount = Math.round(Math.abs(totalAdjustment) * 100) / 100;

    return {
      amount,
      isCredit,
      remainingDays: lastResult?.remainingDays ?? 0,
      remainingSeconds: lastResult?.remainingSeconds ?? 0,
      periodDays: lastResult?.periodDays ?? 30,
      periodSeconds: lastResult?.periodSeconds ?? 2592000,
      unusedOldValue: lastResult?.unusedOldValue ?? 0,
      proratedNewValue: lastResult?.proratedNewValue ?? 0,
      oldDailyRate: lastResult?.oldDailyRate ?? 0,
      newDailyRate: lastResult?.newDailyRate ?? 0,
      description: amount === 0
        ? 'No net proration for multiple mid-cycle plan changes'
        : isCredit
        ? `Net prorated credit of $${amount.toFixed(2)} for multiple mid-cycle changes`
        : `Net prorated charge of $${amount.toFixed(2)} for multiple mid-cycle changes`,
      effectiveDate: 'immediate',
    };
  }
}
