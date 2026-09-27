/**
 * Usage Alerts & Overage Notifications Service (#1230)
 *
 * Pure, stateless functions for evaluating usage thresholds,
 * generating alerts, and calculating overage costs.
 */

import { QuotaMetric } from '../types/usage';
import type {
  OverageNotification,
  UsageAlert,
  UsageAlertSeverity,
  UsageAlertType,
  UsageThreshold,
} from '../types/usageAlerts';

// ── Helpers ────────────────────────────────────────────────────────────────

function uuid(): string {
  return `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const METRIC_LABELS: Record<QuotaMetric, string> = {
  [QuotaMetric.API_CALLS]: 'API Calls',
  [QuotaMetric.STORAGE]: 'Storage',
  [QuotaMetric.SEATS]: 'Seats',
};

// ── Core threshold evaluation ──────────────────────────────────────────────

export interface ThresholdResult {
  type: UsageAlertType;
  severity: UsageAlertSeverity;
}

/**
 * Determines whether a usage reading crosses a threshold boundary.
 * Returns null when usage is healthy (below warning level).
 */
export function checkUsageThresholds(
  currentValue: number,
  limitValue: number,
  threshold: UsageThreshold
): ThresholdResult | null {
  if (!threshold.enabled || limitValue <= 0) return null;

  const pct = (currentValue / limitValue) * 100;

  if (pct >= threshold.overagePercent) {
    return { type: 'overage', severity: 'critical' };
  }
  if (pct >= threshold.criticalPercent) {
    return { type: 'limit_exceeded', severity: 'critical' };
  }
  if (pct >= threshold.warningPercent) {
    return { type: 'approaching_limit', severity: 'warning' };
  }
  return null;
}

// ── Alert message formatting ───────────────────────────────────────────────

export function formatAlertMessage(
  type: UsageAlertType,
  metric: QuotaMetric,
  usagePercent: number,
  overageAmount?: number
): string {
  const label = METRIC_LABELS[metric] ?? metric;
  switch (type) {
    case 'approaching_limit':
      return `${label} usage is at ${usagePercent.toFixed(1)}% of your limit. Consider upgrading your plan.`;
    case 'limit_exceeded':
      return `${label} usage has reached ${usagePercent.toFixed(1)}% of your limit. Upgrade to avoid service interruptions.`;
    case 'overage':
      return overageAmount !== undefined
        ? `${label} has exceeded your limit by ${overageAmount.toLocaleString()} units. Overage charges may apply.`
        : `${label} has exceeded your plan limit. Overage charges may apply.`;
    case 'reset':
      return `${label} usage has been reset for the new billing period.`;
    case 'custom':
      return `${label} usage alert triggered at ${usagePercent.toFixed(1)}%.`;
    default:
      return `${label} usage alert.`;
  }
}

function formatAlertTitle(type: UsageAlertType, metric: QuotaMetric): string {
  const label = METRIC_LABELS[metric] ?? metric;
  switch (type) {
    case 'approaching_limit':
      return `${label} Approaching Limit`;
    case 'limit_exceeded':
      return `${label} Limit Exceeded`;
    case 'overage':
      return `${label} Overage Detected`;
    case 'reset':
      return `${label} Usage Reset`;
    default:
      return `${label} Alert`;
  }
}

// ── Alert generation ───────────────────────────────────────────────────────

export function generateUsageAlert(
  subscriptionId: string,
  metric: QuotaMetric,
  currentValue: number,
  limitValue: number,
  threshold: UsageThreshold
): UsageAlert | null {
  const result = checkUsageThresholds(currentValue, limitValue, threshold);
  if (!result) return null;

  const usagePercent = limitValue > 0 ? (currentValue / limitValue) * 100 : 0;
  const overageAmount = currentValue > limitValue ? currentValue - limitValue : undefined;

  return {
    id: uuid(),
    subscriptionId,
    metric,
    type: result.type,
    severity: result.severity,
    title: formatAlertTitle(result.type, metric),
    message: formatAlertMessage(result.type, metric, usagePercent, overageAmount),
    currentValue,
    limitValue,
    usagePercent: Number(usagePercent.toFixed(2)),
    timestamp: new Date().toISOString(),
    isRead: false,
    isDismissed: false,
  };
}

// ── Overage cost calculation ───────────────────────────────────────────────

export function calculateOverageCost(overageAmount: number, pricePerUnit: number): number {
  return Number(Math.max(0, overageAmount * pricePerUnit).toFixed(2));
}

export function generateOverageNotification(
  subscriptionId: string,
  metric: QuotaMetric,
  currentValue: number,
  limitValue: number,
  costPerUnit: number = 0
): OverageNotification | null {
  if (currentValue <= limitValue) return null;

  const overageAmount = currentValue - limitValue;
  const overageCost = calculateOverageCost(overageAmount, costPerUnit);

  return {
    id: uuid(),
    subscriptionId,
    metric,
    overageAmount: Number(overageAmount.toFixed(2)),
    overageCost,
    timestamp: new Date().toISOString(),
    isAcknowledged: false,
  };
}

// ── Batch evaluation ───────────────────────────────────────────────────────

export interface UsageEntry {
  current: number;
  limit: number;
}

/**
 * Evaluates all thresholds against a usage map.
 * usageMap key format: `${subscriptionId}:${metric}`
 */
export function evaluateAllThresholds(
  usageMap: Record<string, UsageEntry>,
  thresholds: UsageThreshold[]
): UsageAlert[] {
  const alerts: UsageAlert[] = [];

  for (const threshold of thresholds) {
    if (!threshold.enabled) continue;

    const key = `${threshold.subscriptionId}:${threshold.metric}`;
    const entry = usageMap[key];
    if (!entry) continue;

    const alert = generateUsageAlert(
      threshold.subscriptionId,
      threshold.metric,
      entry.current,
      entry.limit,
      threshold
    );
    if (alert) alerts.push(alert);
  }

  return alerts;
}

/**
 * Generates overage notifications for all entries exceeding their limits.
 */
export function evaluateOverages(
  usageMap: Record<string, UsageEntry>,
  thresholds: UsageThreshold[]
): OverageNotification[] {
  const notifications: OverageNotification[] = [];

  for (const threshold of thresholds) {
    if (!threshold.enabled) continue;

    const key = `${threshold.subscriptionId}:${threshold.metric}`;
    const entry = usageMap[key];
    if (!entry) continue;

    const notification = generateOverageNotification(
      threshold.subscriptionId,
      threshold.metric,
      entry.current,
      entry.limit,
      threshold.costPerUnit ?? 0
    );
    if (notification) notifications.push(notification);
  }

  return notifications;
}

// ── Default threshold factory ──────────────────────────────────────────────

export function createDefaultThreshold(
  subscriptionId: string,
  metric: QuotaMetric
): UsageThreshold {
  return {
    id: `threshold-${subscriptionId}-${metric}-${Date.now()}`,
    subscriptionId,
    metric,
    warningPercent: 80,
    criticalPercent: 95,
    overagePercent: 100,
    enabled: true,
    costPerUnit: 0,
  };
}
