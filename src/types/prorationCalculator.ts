/**
 * Subscription Proration Types
 *
 * Types for proration calculator, transparent display, analytics,
 * configuration, and API integration.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/784
 */

import { BillingCycle } from './subscription';

export type ProrationPolicy = 'exact_day' | 'calendar_month' | 'immediate_charge' | 'next_invoice';

export type ProrationMode = 'upgrade' | 'downgrade' | 'cancellation' | 'addon_change' | 'billing_cycle_change';

export interface ProrationConfig {
  policy: ProrationPolicy;
  /** Whether tax is calculated on prorated amounts */
  includeTax: boolean;
  /** Default tax rate in percent (e.g. 10 for 10%) */
  defaultTaxRate: number;
  /** Currency code (e.g. 'USD') */
  currency: string;
  /** Minimum prorated charge allowed (below this is waived) */
  minProratedAmount: number;
  /** Grace period in days for immediate cancellation refunds */
  refundGracePeriodDays: number;
  /** Custom calculation rules */
  allowCredits: boolean;
}

export const DEFAULT_PRORATION_CONFIG: ProrationConfig = {
  policy: 'exact_day',
  includeTax: false,
  defaultTaxRate: 0,
  currency: 'USD',
  minProratedAmount: 0.5,
  refundGracePeriodDays: 3,
  allowCredits: true,
};

export interface ProrationBreakdownItem {
  id: string;
  label: string;
  description: string;
  unitPrice: number;
  dailyRate: number;
  daysActive: number;
  daysRemaining: number;
  totalCycleDays: number;
  amount: number;
  isCredit: boolean;
  type: 'unused_portion' | 'new_portion' | 'tax' | 'credit_applied' | 'fee';
}

export interface ProrationCalculationRequest {
  subscriptionId?: string;
  currentPlanId: string;
  currentPlanName: string;
  currentPrice: number;
  currentCycle: BillingCycle;
  newPlanId: string;
  newPlanName: string;
  newPrice: number;
  newCycle: BillingCycle;
  cycleStartDate: number | string;
  cycleEndDate: number | string;
  effectiveDate?: number | string;
  mode?: ProrationMode;
  config?: Partial<ProrationConfig>;
}

export interface ProrationCalculationResult {
  id: string;
  mode: ProrationMode;
  currentPlan: {
    id: string;
    name: string;
    price: number;
    cycle: BillingCycle;
    unusedDays: number;
    unusedAmount: number;
    dailyRate: number;
  };
  newPlan: {
    id: string;
    name: string;
    price: number;
    cycle: BillingCycle;
    remainingDays: number;
    proratedAmount: number;
    dailyRate: number;
  };
  cycleTotalDays: number;
  daysUsed: number;
  daysRemaining: number;
  netProratedAmount: number;
  taxAmount: number;
  totalAmountDue: number;
  isCredit: boolean;
  effectiveDate: number;
  breakdown: ProrationBreakdownItem[];
  explanationText: string;
  transparencySummary: {
    unusedCreditFromOldPlan: number;
    chargeForNewPlan: number;
    netAdjustment: number;
    taxApplied: number;
    finalAmountToBillOrCredit: number;
  };
  createdAt: number;
}

export interface ProrationAnalyticsSummary {
  totalCalculations: number;
  totalUpgrades: number;
  totalDowngrades: number;
  totalCancellations: number;
  totalProratedRevenueCollected: number;
  totalCreditsIssued: number;
  averageProratedAmount: number;
  mostCommonUpgradePath: {
    fromPlan: string;
    toPlan: string;
    count: number;
  } | null;
  prorationVolumeByMonth: Array<{
    month: string;
    upgrades: number;
    downgrades: number;
    netRevenue: number;
  }>;
}

export interface ProrationRecord {
  id: string;
  subscriptionId: string;
  result: ProrationCalculationResult;
  status: 'preview' | 'applied' | 'cancelled';
  appliedAt?: number;
  createdAt: number;
}
