/**
 * usageAlertService.ts — Pure functions for usage-alert business logic.
 *
 * No side effects, no store access — all functions take plain data and return
 * plain data.  The Zustand store imports these to implement its actions.
 */

import {
  UsageAlert,
  UsageAlertSeverity,
  UsageAlertType,
  UsageThreshold,
  OverageNotification,
} from '../types/usageAlerts';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Lightweight uuid-like generator that works without external packages. */
const generateId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// checkUsageThresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether the given usage crosses any of the threshold percentages.
 *
 * Returns the most severe matching {type, severity} pair, or `null` if no
 * threshold is crossed.
 */
export function checkUsageThresholds(
  currentValue: number,
  limit: number,
  threshold: UsageThreshold
): { type: UsageAlertType; severity: UsageAlertSeverity } | null {
  if (!threshold.enabled || limit <= 0) return null;

  const pct = (currentValue / limit) * 100;

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

// ─────────────────────────────────────────────────────────────────────────────
// formatAlertMessage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a human-readable description for an alert given its type.
 */
export function formatAlertMessage(
  type: UsageAlertType,
  metricName: string,
  usagePercent: number,
  overageAmount?: number
): string {
  const pct = usagePercent.toFixed(1);

  switch (type) {
    case 'approaching_limit':
      return `You have used ${pct}% of your ${metricName} quota. Consider upgrading your plan to avoid service interruption.`;
    case 'limit_exceeded':
      return `Your ${metricName} usage has reached ${pct}% of the allowed limit. New usage may be blocked.`;
    case 'overage':
      return overageAmount !== undefined
        ? `Your ${metricName} usage has exceeded the quota by ${overageAmount.toLocaleString()} units. Overage charges may apply.`
        : `Your ${metricName} usage has exceeded the quota. Overage charges may apply.`;
    case 'reset':
      return `Your ${metricName} quota has been reset for the new billing period.`;
    case 'custom':
      return `A custom alert has been triggered for your ${metricName} usage at ${pct}%.`;
    default:
      return `Usage alert for ${metricName} at ${pct}%.`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// generateUsageAlert
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a fully-formed {@link UsageAlert} from raw usage data and a
 * threshold definition.  Returns `null` when no threshold is crossed.
 */
export function generateUsageAlert(
  subscriptionId: string,
  metricName: string,
  currentValue: number,
  limit: number,
  threshold: UsageThreshold
): UsageAlert | null {
  const result = checkUsageThresholds(currentValue, limit, threshold);
  if (!result) return null;

  const usagePercent = limit > 0 ? (currentValue / limit) * 100 : 0;
  const overageAmount = Math.max(0, currentValue - limit);
  const { type, severity } = result;

  const titleMap: Record<UsageAlertType, string> = {
    approaching_limit: `${metricName} Approaching Limit`,
    limit_exceeded: `${metricName} Limit Exceeded`,
    overage: `${metricName} Overage Detected`,
    reset: `${metricName} Quota Reset`,
    custom: `${metricName} Custom Alert`,
  };

  return {
    id: generateId(),
    subscriptionId,
    metricName,
    type,
    severity,
    title: titleMap[type],
    message: formatAlertMessage(type, metricName, usagePercent, overageAmount || undefined),
    currentValue,
    limitValue: limit,
    usagePercent,
    timestamp: new Date().toISOString(),
    isRead: false,
    isDismissed: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateOverageCost
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates the monetary cost for a given overage amount.
 *
 * @param overageAmount - Units consumed beyond the quota.
 * @param pricePerUnit  - Cost per single overage unit in the billing currency.
 * @returns Total overage cost, rounded to two decimal places.
 */
export function calculateOverageCost(overageAmount: number, pricePerUnit: number): number {
  return Math.round(Math.max(0, overageAmount) * pricePerUnit * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateOverageNotification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an {@link OverageNotification} when usage exceeds the quota limit.
 * Returns `null` if currentValue is within the limit.
 */
export function generateOverageNotification(
  subscriptionId: string,
  metricName: string,
  currentValue: number,
  limit: number,
  costPerUnit: number
): OverageNotification | null {
  const overageAmount = currentValue - limit;
  if (overageAmount <= 0) return null;

  return {
    id: generateId(),
    subscriptionId,
    metricName,
    overageAmount,
    overageCost: calculateOverageCost(overageAmount, costPerUnit),
    timestamp: new Date().toISOString(),
    isAcknowledged: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// evaluateAllThresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates every threshold in `thresholds` against the supplied usage map.
 *
 * @param usageMap   - Keyed by `"subscriptionId::metricName"`.
 * @param thresholds - All configured thresholds across all subscriptions.
 * @returns An array of new {@link UsageAlert} objects (one per crossed threshold).
 */
export function evaluateAllThresholds(
  usageMap: Record<string, { current: number; limit: number }>,
  thresholds: UsageThreshold[]
): UsageAlert[] {
  const alerts: UsageAlert[] = [];

  for (const threshold of thresholds) {
    if (!threshold.enabled) continue;

    const key = `${threshold.subscriptionId}::${threshold.metricName}`;
    const usage = usageMap[key];
    if (!usage) continue;

    const alert = generateUsageAlert(
      threshold.subscriptionId,
      threshold.metricName,
      usage.current,
      usage.limit,
      threshold
    );

    if (alert) {
      alerts.push(alert);
    }
  }

  return alerts;
}
