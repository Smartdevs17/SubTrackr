/**
 * Types for usage alerts and overage notifications (#1230).
 */

import { QuotaMetric } from './usage';

// ── Alert classification ───────────────────────────────────────────────────

export type UsageAlertType =
  | 'approaching_limit'
  | 'limit_exceeded'
  | 'overage'
  | 'reset'
  | 'custom';

export type UsageAlertSeverity = 'info' | 'warning' | 'critical';

// ── Threshold configuration ────────────────────────────────────────────────

export interface UsageThreshold {
  id: string;
  subscriptionId: string;
  metric: QuotaMetric;
  /** Percentage of limit at which a warning alert fires (default 80) */
  warningPercent: number;
  /** Percentage of limit at which a critical alert fires (default 95) */
  criticalPercent: number;
  /** Percentage at which overage notifications fire (default 100) */
  overagePercent: number;
  enabled: boolean;
  /** Cost per unit beyond the limit, for overage cost calculation */
  costPerUnit?: number;
}

// ── Alert record ───────────────────────────────────────────────────────────

export interface UsageAlert {
  id: string;
  subscriptionId: string;
  metric: QuotaMetric;
  type: UsageAlertType;
  severity: UsageAlertSeverity;
  title: string;
  message: string;
  currentValue: number;
  limitValue: number;
  usagePercent: number;
  timestamp: string; // ISO
  isRead: boolean;
  isDismissed: boolean;
}

// ── Overage notification ───────────────────────────────────────────────────

export interface OverageNotification {
  id: string;
  subscriptionId: string;
  metric: QuotaMetric;
  /** Units consumed beyond the limit */
  overageAmount: number;
  /** Calculated cost of the overage */
  overageCost: number;
  timestamp: string; // ISO
  isAcknowledged: boolean;
}

// ── Global alert config ────────────────────────────────────────────────────

export interface UsageAlertConfig {
  thresholds: UsageThreshold[];
  notifyOnApproaching: boolean;
  notifyOnExceeded: boolean;
  notifyOnOverage: boolean;
  /** Minimum minutes between repeat alerts for the same metric */
  cooldownMinutes: number;
}
