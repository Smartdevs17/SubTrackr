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
