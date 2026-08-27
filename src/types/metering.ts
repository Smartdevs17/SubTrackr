export type UsageMetricType =
  | 'api_calls'
  | 'storage_gb'
  | 'compute_minutes'
  | 'data_transfer_gb'
  | 'custom';

export interface UsageMetric {
  id: string;
  subscriptionId: string;
  metricType: UsageMetricType;
  metricName: string;
  unitName: string;
  unitRate: number; // Cost per unit above included units
  includedUnits: number; // Base units included in base price
  currentUsage: number; // Usage in current billing cycle
  cumulativeUsage: number; // All-time total usage
  usageLimit: number; // Max allowed units per cycle (0 = unlimited)
  accruedCost: number; // Additional cost accrued in current cycle
  lastUpdated: string; // ISO date string
  billingCycleStart: string; // ISO date string
  billingCycleEnd: string; // ISO date string
}

export interface UsageEvent {
  id: string;
  subscriptionId: string;
  metricId: string;
  quantity: number;
  timestamp: string; // ISO date string
  reportedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface UsageAlert {
  id: string;
  subscriptionId: string;
  metricId: string;
  thresholdPercent: number; // e.g. 80, 90, 100
  message: string;
  triggeredAt: string; // ISO date string
  acknowledged: boolean;
}

export interface MeteredPlanConfig {
  basePrice: number;
  unitRate: number;
  includedUnits: number;
  billingCycleDays: number;
}

export interface RecordUsageParams {
  subscriptionId: string;
  metricId: string;
  quantity: number;
  reportedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterMetricParams {
  subscriptionId: string;
  metricType: UsageMetricType;
  metricName: string;
  unitName: string;
  unitRate: number;
  includedUnits?: number;
  usageLimit?: number;
  basePrice?: number;
  billingCycleDays?: number;
}
