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

interface StoredUsageEvent {
  idempotencyKey: string;
  amount: number;
  /** Time the client claims the usage happened. */
  eventTime: number;
  /** Time the server actually received/recorded the event. */
  receivedAt: number;
  /** True when eventTime and receivedAt diverged by more than MAX_CLOCK_SKEW_MS. */
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

export class MeteringService {
  private events = new Map<string, StoredUsageEvent[]>();
  private seenIdempotencyKeys = new Map<string, UsageIngestResult>();
  private limits = new Map<string, number>();

  /** Configure the quota limit used for threshold alerts on a given user+metric. */
  setLimit(userId: string, metricType: string, limit: number): void {
    this.limits.set(meterKey(userId, metricType), limit);
  }

  async recordUsage(metric: UsageMetric): Promise<UsageIngestResult> {
    const [result] = await this.recordUsageBatch([metric]);
    return result;
  }

  /**
   * Ingests a batch of usage events. Each event is deduplicated by
   * `idempotencyKey` (events missing one are auto-keyed and therefore never
   * deduplicated against retries — callers should always supply one).
   */
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
      const result: UsageIngestResult = {
        idempotencyKey,
        status: 'rejected',
        reason: 'amount must be a non-negative finite number',
      };
      return result;
    }

    const receivedAt = Date.now();
    const eventTime = metric.timestamp.getTime();
    const clockSkewDetected = Math.abs(receivedAt - eventTime) > MAX_CLOCK_SKEW_MS;
    // Future-dated events are clamped to server time so callers can't push usage
    // into a not-yet-closed billing window; late-arriving events keep their
    // original timestamp (so they land in the correct historical bucket) but
    // are flagged for audit.
    const normalizedEventTime = eventTime > receivedAt ? receivedAt : eventTime;

    const key = meterKey(metric.userId, metric.metricType);
    const list = this.events.get(key) ?? [];
    list.push({
      idempotencyKey,
      amount: metric.amount,
      eventTime: normalizedEventTime,
      receivedAt,
      clockSkewDetected,
    });
    this.events.set(key, list);

    const result: UsageIngestResult = { idempotencyKey, status: 'accepted', clockSkewDetected };
    this.seenIdempotencyKeys.set(idempotencyKey, result);

    await this.checkThresholds(metric.userId, metric.metricType);

    return result;
  }

  /** Aggregates recorded usage for a window ending now. */
  aggregate(
    userId: string,
    metricType: string,
    window: AggregationWindow,
    fn: AggregationFunction = AggregationFunction.SUM,
    now: number = Date.now()
  ): number {
    const windowMs = AGGREGATION_WINDOW_MS[window];
    const cutoff = now - windowMs;
    const values = (this.events.get(meterKey(userId, metricType)) ?? [])
      .filter((e) => e.eventTime >= cutoff && e.eventTime <= now)
      .map((e) => e.amount);

    if (values.length === 0) return 0;

    switch (fn) {
      case AggregationFunction.SUM:
        return values.reduce((a, b) => a + b, 0);
      case AggregationFunction.MAX:
        return Math.max(...values);
      case AggregationFunction.AVERAGE:
        return values.reduce((a, b) => a + b, 0) / values.length;
      case AggregationFunction.PERCENTILE_95:
        return percentile([...values].sort((a, b) => a - b), 95);
      case AggregationFunction.PERCENTILE_99:
        return percentile([...values].sort((a, b) => a - b), 99);
      default:
        return values.reduce((a, b) => a + b, 0);
    }
  }

  /** Total consumption for the metric in the current (default daily) window. */
  getCurrentPeriodConsumption(
    userId: string,
    metricType: string,
    window: AggregationWindow = AggregationWindow.MONTHLY
  ): number {
    return this.aggregate(userId, metricType, window, AggregationFunction.SUM);
  }

  /**
   * Checks current consumption against the configured limit. Returns the
   * highest alert level reached (soft = warning, hard = block) or null if
   * usage is within bounds.
   */
  async checkThresholds(userId: string, metricType: string): Promise<UsageThresholdAlert | null> {
    const limit = this.limits.get(meterKey(userId, metricType));
    if (!limit || limit <= 0) return null;

    const usage = this.getCurrentPeriodConsumption(userId, metricType);
    const ratio = usage / limit;

    if (ratio >= HARD_THRESHOLD_RATIO) {
      return {
        level: UsageAlertLevel.HARD,
        metric: metricType as any,
        subscriptionId: userId,
        usage,
        limit,
        ratio,
      };
    }
    if (ratio >= SOFT_THRESHOLD_RATIO) {
      return {
        level: UsageAlertLevel.SOFT,
        metric: metricType as any,
        subscriptionId: userId,
        usage,
        limit,
        ratio,
      };
    }
    return null;
  }

  /** Units billable beyond the free allotment, for the current period. */
  async calculateOverage(userId: string, metricType = 'api'): Promise<number> {
    const limit = this.limits.get(meterKey(userId, metricType)) ?? 0;
    const usage = this.getCurrentPeriodConsumption(userId, metricType);
    return Math.max(0, usage - limit);
  }

  /** Returns true if a hard limit has already been reached (used to block further usage). */
  async isBlocked(userId: string, metricType: string): Promise<boolean> {
    const alert = await this.checkThresholds(userId, metricType);
    return alert?.level === UsageAlertLevel.HARD;
  }

  /** Test/cron helper: clears events for a meter, e.g. after billing close. */
  resetPeriod(userId: string, metricType: string): void {
    this.events.delete(meterKey(userId, metricType));
  }
}

export const meteringService = new MeteringService();
