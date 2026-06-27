/**
 * Shared types for revenue recognition accounting within the billing slice.
 * Kept separate to avoid circular imports from the main billing slice.
 */

import type { BillingCycle } from '../../types/subscription';

export type RecognitionMethod = 'straight-line' | 'usage-based';

export interface RevenueRecognitionRule {
  subscriptionId: string;
  method: RecognitionMethod;
  recognitionPeriodMs: number;
}

export interface RevenueScheduleEntry {
  periodStart: number;
  periodEnd: number;
  recognisedAmount: number;
  isRecognised: boolean;
}

export interface RevenueSchedule {
  subscriptionId: string;
  totalAmount: number;
  chargeDate: number;
  entries: RevenueScheduleEntry[];
}

export interface Recognition {
  subscriptionId: string;
  recognisedRevenue: number;
  deferredRevenue: number;
  asOf: number;
}

export interface PeriodRevenue {
  periodStart: number;
  periodEnd: number;
  recognisedAmount: number;
  subscriptionCount: number;
}
