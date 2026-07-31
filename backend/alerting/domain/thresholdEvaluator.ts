import type { UsageAlertConfig, UsageAlert, MeterUsageSnapshot, ThresholdConfig } from './types';

const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

export class ThresholdEvaluator {
  /**
   * Evaluate if an alert should be sent for a given usage snapshot.
   * Checks if threshold is crossed and cooldown has expired.
   */
  shouldSendAlert(
    snapshot: MeterUsageSnapshot,
    config: UsageAlertConfig,
    lastAlerts: Map<string, UsageAlert>
  ): { alert: UsageAlert; threshold: ThresholdConfig } | null {
    const percentage = (snapshot.current_usage / snapshot.plan_limit) * 100;
    const enabledThresholds = config.thresholds.filter((t) => t.enabled);

    // Find highest enabled threshold that's been crossed
    let triggeredThreshold: ThresholdConfig | null = null;
    for (const threshold of [100, 90, 75, 50] as const) {
      if (percentage >= threshold && config.thresholds.find((t) => t.level === threshold)?.enabled) {
        triggeredThreshold = config.thresholds.find((t) => t.level === threshold) || null;
        break;
      }
    }

    if (!triggeredThreshold) return null;

    const alertKey = `${config.meter_id}::${triggeredThreshold.level}`;
    const lastAlert = lastAlerts.get(alertKey);

    // Check cooldown
    if (lastAlert && lastAlert.cooldown_until && Date.now() < lastAlert.cooldown_until) {
      return null;
    }

    // Calculate burn rate (units per minute) — use average over last 5 minutes if available
    const burnRate = this.calculateBurnRate(snapshot);

    // Project completion time
    const remainingUnits = snapshot.plan_limit - snapshot.current_usage;
    const minutesRemaining = remainingUnits > 0 ? remainingUnits / burnRate : 0;
    const projectedCompletion = Date.now() + minutesRemaining * 60 * 1000;

    const alert: UsageAlert = {
      id: `alert::${config.subscription_id}::${triggeredThreshold.level}::${Date.now()}`,
      subscription_id: config.subscription_id,
      user_id: config.user_id,
      meter_id: config.meter_id,
      threshold_level: triggeredThreshold.level,
      current_usage: snapshot.current_usage,
      limit: snapshot.plan_limit,
      burned_rate: burnRate,
      projected_completion: Math.floor(projectedCompletion),
      created_at: Date.now(),
      cooldown_until: Date.now() + ALERT_COOLDOWN_MS,
    };

    return { alert, threshold: triggeredThreshold };
  }

  private calculateBurnRate(snapshot: MeterUsageSnapshot): number {
    // Simple rate: current usage / elapsed time in billing period
    const elapsedMs = Date.now() - snapshot.billing_period_start;
    const elapsedMinutes = Math.max(1, elapsedMs / (1000 * 60));
    return snapshot.current_usage / elapsedMinutes;
  }

  /**
   * Check if plan change resets baseline (e.g., new limit > old usage).
   * If so, allow new alert window to open.
   */
  didPlanChange(oldLimit: number, newLimit: number, currentUsage: number): boolean {
    // Plan change detected if new limit significantly differs and current usage < old limit
    return Math.abs(newLimit - oldLimit) > oldLimit * 0.05 && currentUsage < oldLimit;
  }

  /**
   * Check if usage reset mid-cycle (usage dropped significantly).
   * If so, reopen alert window for new threshold evaluation.
   */
  didUsageReset(previousUsage: number, currentUsage: number): boolean {
    // Reset if usage dropped by > 20% (anomaly)
    return currentUsage < previousUsage * 0.8 && previousUsage > 0;
  }
}
