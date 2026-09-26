export enum QuotaMetric {
  API_CALLS = 'ApiCalls',
  STORAGE = 'Storage',
  SEATS = 'Seats',
}

export enum RolloverPolicy {
  NO_ROLLOVER = 'NoRollover',
  ROLLOVER_ALL = 'RolloverAll',
  ROLLOVER_CAP = 'RolloverCap',
}

export enum BillingPeriod {
  DAILY = 'Daily',
  WEEKLY = 'Weekly',
  MONTHLY = 'Monthly',
  QUARTERLY = 'Quarterly',
  YEARLY = 'Yearly',
}

export interface Quota {
  metric: QuotaMetric;
  limit: number;
  period: BillingPeriod;
  rolloverPolicy: RolloverPolicy;
  rolloverCap?: number;
}

export interface UsageRecord {
  subscriptionId: string;
  metric: QuotaMetric;
  currentUsage: number;
  periodStart: Date;
  rolloverBalance: number;
}

export enum QuotaStatus {
  WITHIN_LIMIT = 'WithinLimit',
  SOFT_LIMIT_REACHED = 'SoftLimitReached',
  HARD_LIMIT_REACHED = 'HardLimitReached',
}

export interface UsageReport {
  subscriptionId: string;
  records: UsageRecord[];
  healthStatus: QuotaStatus;
}

export enum AggregationWindow {
  HOURLY = 'Hourly',
  DAILY = 'Daily',
  MONTHLY = 'Monthly',
}

export enum AggregationFunction {
  SUM = 'Sum',
  MAX = 'Max',
  AVERAGE = 'Average',
  PERCENTILE_95 = 'Percentile95',
  PERCENTILE_99 = 'Percentile99',
}

export const AGGREGATION_WINDOW_MS: Record<AggregationWindow, number> = {
  [AggregationWindow.HOURLY]: 60 * 60 * 1000,
  [AggregationWindow.DAILY]: 24 * 60 * 60 * 1000,
  [AggregationWindow.MONTHLY]: 30 * 24 * 60 * 60 * 1000,
};

export enum UsageAlertLevel {
  SOFT = 'Soft',
  HARD = 'Hard',
}

export interface UsageThresholdAlert {
  level: UsageAlertLevel;
  metric: QuotaMetric;
  subscriptionId: string;
  usage: number;
  limit: number;
  ratio: number;
}

/** A graduated pricing tier. `upToUnits: null` marks the final, unbounded tier. */
export interface PricingTier {
  upToUnits: number | null;
  unitPrice: number;
}

export interface TierBreakdownLine {
  tier: PricingTier;
  unitsInTier: number;
  amount: number;
}

export interface TieredPricingResult {
  totalUnits: number;
  totalAmount: number;
  lines: TierBreakdownLine[];
}

/** Per-meter usage summary used to build invoice line items. */
export interface MeterUsageBreakdown {
  metric: QuotaMetric;
  unitsUsed: number;
  includedUnits: number;
  billableUnits: number;
  amount: number;
}

// Default quotas applied when a plan has not configured its own. Keyed by
// plan tier id so the dashboard and store always have something sane to show.
export const DEFAULT_QUOTAS: Record<string, Quota[]> = {
  free: [
    {
      metric: QuotaMetric.API_CALLS,
      limit: 1_000,
      period: BillingPeriod.MONTHLY,
      rolloverPolicy: RolloverPolicy.NO_ROLLOVER,
    },
    {
      metric: QuotaMetric.STORAGE,
      limit: 5,
      period: BillingPeriod.MONTHLY,
      rolloverPolicy: RolloverPolicy.NO_ROLLOVER,
    },
    {
      metric: QuotaMetric.SEATS,
      limit: 1,
      period: BillingPeriod.MONTHLY,
      rolloverPolicy: RolloverPolicy.NO_ROLLOVER,
    },
  ],
  pro: [
    {
      metric: QuotaMetric.API_CALLS,
      limit: 50_000,
      period: BillingPeriod.MONTHLY,
      rolloverPolicy: RolloverPolicy.ROLLOVER_CAP,
      rolloverCap: 10_000,
    },
    {
      metric: QuotaMetric.STORAGE,
      limit: 100,
      period: BillingPeriod.MONTHLY,
      rolloverPolicy: RolloverPolicy.NO_ROLLOVER,
    },
    {
      metric: QuotaMetric.SEATS,
      limit: 10,
      period: BillingPeriod.MONTHLY,
      rolloverPolicy: RolloverPolicy.NO_ROLLOVER,
    },
  ],
  enterprise: [
    {
      metric: QuotaMetric.API_CALLS,
      limit: 1_000_000,
      period: BillingPeriod.MONTHLY,
      rolloverPolicy: RolloverPolicy.ROLLOVER_ALL,
    },
    {
      metric: QuotaMetric.STORAGE,
      limit: 5_000,
      period: BillingPeriod.MONTHLY,
      rolloverPolicy: RolloverPolicy.ROLLOVER_ALL,
    },
    {
      metric: QuotaMetric.SEATS,
      limit: 250,
      period: BillingPeriod.MONTHLY,
      rolloverPolicy: RolloverPolicy.NO_ROLLOVER,
    },
  ],
};

export const getDefaultQuotas = (planId: string): Quota[] =>
  DEFAULT_QUOTAS[planId] ?? DEFAULT_QUOTAS.free;
