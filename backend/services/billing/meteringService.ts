import {
  AggregationFunction,
  AggregationWindow,
  AGGREGATION_WINDOW_MS,
  UsageAlertLevel,
  UsageThresholdAlert,
} from '../../../src/types/usage';

/** Maximum tolerated difference between client-reported and server-received event time. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes
const SOFT_THRESHOLD_RATIO = 0.8;
const HARD_THRESHOLD_RATIO = 1.0;
const MAX_BATCH_SIZE = 500;

export interface UsageMetric {
  userId: string;
  metricType: 'api' | 'compute' | 'storage';
  amount: number;
  timestamp: Date;
  /** Caller-supplied dedup key. Required for batch ingestion. */
  idempotencyKey?: string;
}

export interface UsageAlert {
  id: string;
  subscriptionId: string;
  metric: string;
  threshold: number;
  currentUsage: number;
  message: string;
  createdAt: Date;
  acknowledged: boolean;
}

export interface UsageHistoryEntry {
  subscriptionId: string;
  metric: string;
  value: number;
  timestamp: Date;
}

interface StoredUsageEvent {
  idempotencyKey: string;
  amount: number;
  eventTime: number;
  receivedAt: number;
  clockSkewDetected: boolean;
}

export type UsageIngestStatus = 'accepted' | 'duplicate' | 'rejected';

export interface UsageIngestResult {
  idempotencyKey: string;
  status: UsageIngestStatus;
  reason?: string;
  clockSkewDetected?: boolean;
}

function meterKey(userId: string, metricType: string): string {
  return `${userId}::${metricType}`;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const rank = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedValues[lower];
  const weight = rank - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export interface UsageTrend {
  metric: string;
  currentPeriod: number;
  previousPeriod: number;
  changePercent: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface UsageAnalytics {
  totalUsage: number;
  usageByMetric: Record<string, number>;
  usageBySubscription: Record<string, number>;
  usageHistory: UsageHistoryEntry[];
  trends: UsageTrend[];
  alertsCount: number;
  alerts: UsageAlert[];
}

export interface UsageBillingIntegration {
  subscriptionId: string;
  meteredAmount: number;
  unitPrice: number;
  totalAmount: number;
  currency: string;
  period: { start: Date; end: Date };
}

export class MeteringService {
  private events = new Map<string, StoredUsageEvent[]>();
  private seenIdempotencyKeys = new Map<string, UsageIngestResult>();
  private limits = new Map<string, number>();
  private usageHistory: UsageHistoryEntry[] = [];
  private alerts: UsageAlert[] = [];

  /** Configure the quota limit used for threshold alerts on a given user+metric. */
  setLimit(userId: string, metricType: string, limit: number): void {
    this.limits.set(meterKey(userId, metricType), limit);
  }

  async recordUsage(metric: UsageMetric): Promise<UsageIngestResult> {
    const [result] = await this.recordUsageBatch([metric]);
    return result;
  }

  async recordUsageBatch(metrics: UsageMetric[]): Promise<UsageIngestResult[]> {
    if (metrics.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${metrics.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
    }
    const results: UsageIngestResult[] = [];
    for (const metric of metrics) {
      results.push(await this.recordOne(metric));
    }
    return results;
  }

  private async recordOne(metric: UsageMetric): Promise<UsageIngestResult> {
    const idempotencyKey = metric.idempotencyKey ?? `auto-${meterKey(metric.userId, metric.metricType)}-${metric.timestamp.getTime()}`;

    const cached = this.seenIdempotencyKeys.get(idempotencyKey);
    if (cached) {
      return { ...cached, status: 'duplicate' };
    }

    if (!Number.isFinite(metric.amount) || metric.amount < 0) {
      return { idempotencyKey, status: 'rejected', reason: 'amount must be a non-negative finite number' };
    }

    const receivedAt = Date.now();
    const eventTime = metric.timestamp.getTime();
    const clockSkewDetected = Math.abs(receivedAt - eventTime) > MAX_CLOCK_SKEW_MS;
    const normalizedEventTime = eventTime > receivedAt ? receivedAt : eventTime;

    const key = meterKey(metric.userId, metric.metricType);
    const list = this.events.get(key) ?? [];
    list.push({ idempotencyKey, amount: metric.amount, eventTime: normalizedEventTime, receivedAt, clockSkewDetected });
    this.events.set(key, list);

    this.usageHistory.push({
      subscriptionId: metric.userId,
      metric: metric.metricType,
      value: metric.amount,
      timestamp: metric.timestamp,
    });

    const result: UsageIngestResult = { idempotencyKey, status: 'accepted', clockSkewDetected };
    this.seenIdempotencyKeys.set(idempotencyKey, result);

    await this.checkThresholds(metric.userId, metric.metricType);
    return result;
  }

  aggregate(userId: string, metricType: string, window: AggregationWindow, fn: AggregationFunction = AggregationFunction.SUM, now: number = Date.now()): number {
    const windowMs = AGGREGATION_WINDOW_MS[window];
    const cutoff = now - windowMs;
    const values = (this.events.get(meterKey(userId, metricType)) ?? [])
      .filter((e) => e.eventTime >= cutoff && e.eventTime <= now)
      .map((e) => e.amount);
    if (values.length === 0) return 0;
    switch (fn) {
      case AggregationFunction.SUM: return values.reduce((a, b) => a + b, 0);
      case AggregationFunction.MAX: return Math.max(...values);
      case AggregationFunction.AVERAGE: return values.reduce((a, b) => a + b, 0) / values.length;
      case AggregationFunction.PERCENTILE_95: return percentile([...values].sort((a, b) => a - b), 95);
      case AggregationFunction.PERCENTILE_99: return percentile([...values].sort((a, b) => a - b), 99);
      default: return values.reduce((a, b) => a + b, 0);
    }
  }

  getCurrentPeriodConsumption(userId: string, metricType: string, window: AggregationWindow = AggregationWindow.MONTHLY): number {
    return this.aggregate(userId, metricType, window, AggregationFunction.SUM);
  }

  async checkThresholds(userId: string, metricType?: string): Promise<UsageThresholdAlert | null> {
    const metricTypes = metricType ? [metricType] : ['api', 'compute', 'storage'];
    for (const mt of metricTypes) {
      const limit = this.limits.get(meterKey(userId, mt));
      if (!limit || limit <= 0) continue;
      const usage = this.getCurrentPeriodConsumption(userId, mt);
      const ratio = usage / limit;
      if (ratio >= HARD_THRESHOLD_RATIO) {
        const alert: UsageAlert = {
          id: `alert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          subscriptionId: userId, metric: mt, threshold: limit, currentUsage: usage,
          message: `Usage for ${mt} has reached ${Math.round(ratio * 100)}% of limit`,
          createdAt: new Date(), acknowledged: false,
        };
        this.alerts.push(alert);
        return { level: UsageAlertLevel.HARD, metric: mt as any, subscriptionId: userId, usage, limit, ratio };
      }
      if (ratio >= SOFT_THRESHOLD_RATIO) {
        const alert: UsageAlert = {
          id: `alert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          subscriptionId: userId, metric: mt, threshold: limit, currentUsage: usage,
          message: `Usage for ${mt} has reached ${Math.round(ratio * 100)}% of limit`,
          createdAt: new Date(), acknowledged: false,
        };
        this.alerts.push(alert);
        return { level: UsageAlertLevel.SOFT, metric: mt as any, subscriptionId: userId, usage, limit, ratio };
      }
    }
    return null;
  }

  async calculateOverage(userId: string, metricType = 'api'): Promise<number> {
    const limit = this.limits.get(meterKey(userId, metricType)) ?? 0;
    const usage = this.getCurrentPeriodConsumption(userId, metricType);
    return Math.max(0, usage - limit);
  }

  async isBlocked(userId: string, metricType: string): Promise<boolean> {
    const alert = await this.checkThresholds(userId, metricType);
    return alert?.level === UsageAlertLevel.HARD;
  }

  resetPeriod(userId: string, metricType: string): void {
    this.events.delete(meterKey(userId, metricType));
  }

  getUsageByMetric(subscriptionId: string): Record<string, number> {
    const usage: Record<string, number> = {};
    for (const entry of this.usageHistory) {
      if (entry.subscriptionId === subscriptionId) {
        usage[entry.metric] = (usage[entry.metric] || 0) + entry.value;
      }
    }
    return usage;
  }

  getUsageHistory(subscriptionId?: string, metric?: string): UsageHistoryEntry[] {
    let history = this.usageHistory;
    if (subscriptionId) history = history.filter((h) => h.subscriptionId === subscriptionId);
    if (metric) history = history.filter((h) => h.metric === metric);
    return history;
  }

  getUsageTrends(subscriptionId: string): UsageTrend[] {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const currentHistory = this.usageHistory.filter((h) => h.subscriptionId === subscriptionId && h.timestamp >= thirtyDaysAgo);
    const previousHistory = this.usageHistory.filter((h) => h.subscriptionId === subscriptionId && h.timestamp >= sixtyDaysAgo && h.timestamp < thirtyDaysAgo);

    const currentByMetric: Record<string, number> = {};
    const previousByMetric: Record<string, number> = {};
    for (const entry of currentHistory) currentByMetric[entry.metric] = (currentByMetric[entry.metric] || 0) + entry.value;
    for (const entry of previousHistory) previousByMetric[entry.metric] = (previousByMetric[entry.metric] || 0) + entry.value;

    const allMetrics = new Set([...Object.keys(currentByMetric), ...Object.keys(previousByMetric)]);
    const trends: UsageTrend[] = [];
    for (const metric of allMetrics) {
      const current = currentByMetric[metric] || 0;
      const previous = previousByMetric[metric] || 0;
      const changePercent = previous > 0 ? ((current - previous) / previous) * 100 : 0;
      let trend: 'increasing' | 'decreasing' | 'stable';
      if (changePercent > 5) trend = 'increasing';
      else if (changePercent < -5) trend = 'decreasing';
      else trend = 'stable';
      trends.push({ metric, currentPeriod: current, previousPeriod: previous, changePercent: Math.round(changePercent * 100) / 100, trend });
    }
    return trends;
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) alert.acknowledged = true;
  }

  getActiveAlerts(subscriptionId?: string): UsageAlert[] {
    let alerts = this.alerts.filter((a) => !a.acknowledged);
    if (subscriptionId) alerts = alerts.filter((a) => a.subscriptionId === subscriptionId);
    return alerts;
  }

  getAnalytics(subscriptionId?: string): UsageAnalytics {
    let history = subscriptionId ? this.usageHistory.filter((h) => h.subscriptionId === subscriptionId) : this.usageHistory;
    const totalUsage = history.reduce((sum, h) => sum + h.value, 0);
    const usageByMetric: Record<string, number> = {};
    const usageBySubscription: Record<string, number> = {};
    for (const entry of history) {
      usageByMetric[entry.metric] = (usageByMetric[entry.metric] || 0) + entry.value;
      usageBySubscription[entry.subscriptionId] = (usageBySubscription[entry.subscriptionId] || 0) + entry.value;
    }
    const trends = subscriptionId ? this.getUsageTrends(subscriptionId) : [];
    const activeAlerts = this.getActiveAlerts(subscriptionId);
    return { totalUsage, usageByMetric, usageBySubscription, usageHistory: history, trends, alertsCount: activeAlerts.length, alerts: activeAlerts };
  }

  calculateUsageBilling(subscriptionId: string, unitPrice: number, currency: string): UsageBillingIntegration {
    const metricUsage = this.getUsageByMetric(subscriptionId);
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    let totalMetered = 0;
    for (const usage of Object.values(metricUsage)) totalMetered += usage;
    return { subscriptionId, meteredAmount: totalMetered, unitPrice, totalAmount: totalMetered * unitPrice, currency, period: { start: periodStart, end: periodEnd } };
  }
}

export const meteringService = new MeteringService();
