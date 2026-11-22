import { BillingCycle } from './subscription';

export enum AlignmentTargetDay {
  DAY_1 = 1,
  DAY_15 = 15,
}

export const REALIGNMENT_LOCKOUT_DAYS = 90;

export type AlignmentExclusionReason = 'free_subscription';

export interface SubscriptionAlignmentPreview {
  subscriptionId: string;
  subscriptionName: string;
  billingCycle: BillingCycle;
  currentBillingDate: Date;
  alignedBillingDate: Date;
  /** Positive = pushed later (charge), negative = pulled earlier (credit). */
  daysShifted: number;
  proratedAmount: number;
  isCredit: boolean;
  excludedReason?: AlignmentExclusionReason;
}

export interface AlignmentPlanPreview {
  targetDay: AlignmentTargetDay;
  previews: SubscriptionAlignmentPreview[];
  totalCharge: number;
  totalCredit: number;
  netAmount: number;
  isNetCredit: boolean;
}

export interface AlignmentHistoryEntry {
  alignedAt: Date;
  targetDay: AlignmentTargetDay;
  subscriptionIds: string[];
}

export interface ConsolidationGroup {
  /** ISO date string (YYYY-MM-DD) shared by every subscription in the group. */
  billingDateKey: string;
  subscriptionIds: string[];
}
