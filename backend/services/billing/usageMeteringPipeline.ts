/**
 * High-Throughput Usage Event Metering Pipeline (Issue #2197)
 *
 * Stream processing engine for sub-second usage event ingestion, O(1) TTL + LRU
 * idempotency deduplication, per-stream event-time watermarks, clock-skew clamping,
 * out-of-order & late-arriving event routing, pre-aggregated tumbling/sliding
 * window rollups, backpressure control, real-time soft/hard quota threshold
 * alerting, and billing period settlement via `rateUsage()`.
 */

import {
  AggregationFunction,
  AggregationWindow,
  AGGREGATION_WINDOW_MS,
  QuotaMetric,
  UsageAlertLevel,
  UsageThresholdAlert,
} from '../../../src/types/usage';
import { MeterPricingPlan, RatedUsageBill, rateUsage } from './metering';

export type UsageMetricKind = 'api' | 'compute' | 'storage' | (string & {});

export interface PipelineUsageEvent {
  /** Subscription or user identifier owning the meter. */
  subscriptionId: string;
  /** Meter identifier (e.g., 'api', 'compute', 'storage', 'api_calls', 'gb_egress'). */
  metricType: UsageMetricKind;
  /** Non-negative finite usage quantity. */
  amount: number;
  /** Event occurrence timestamp (Date, epoch ms, or ISO-8601 string). */
  timestamp: Date | number | string;
  /** Client-supplied deterministic idempotency key for exactly-once ingestion. */
  idempotencyKey?: string;
  /** Optional dimensional metadata (region, endpoint, tenant, etc.). */
  dimensions?: Record<string, string>;
}

export type PipelineEventDisposition =
  | 'accepted'
  | 'duplicate'
  | 'rejected'
  | 'late_accepted'
  | 'dropped_late'
  | 'backpressure_rejected';

export interface PipelineIngestResult {
  idempotencyKey: string;
  subscriptionId: string;
  metricType: string;
  status: PipelineEventDisposition;
  bucketStartMs?: number;
  watermarkMs?: number;
  clockSkewDetected?: boolean;
  lateEvent?: boolean;
  reason?: string;
}

export interface UsageMeteringPipelineConfig {
  /** Maximum events per batch ingestion call or micro-batch flush (default: 500). */
  maxBatchSize?: number;
  /** Maximum queued events before backpressure triggers (default: 10_000). */
  maxQueueDepth?: number;
  /** Sub-second auto-flush interval in milliseconds (default: 100ms; 0 disables background timer). */
  flushIntervalMs?: number;
  /** Bounded watermark out-of-order tolerance in milliseconds (default: 30_000ms = 30s). */
  maxOutOfOrdernessMs?: number;
  /** Maximum allowed lateness behind watermark before an event is dropped to DLQ (default: 300_000ms = 5m). */
  allowedLatenessMs?: number;
  /** Maximum tolerated future clock skew ahead of server clock (default: 300_000ms = 5m). */
  maxClockSkewMs?: number;
  /** Idempotency key retention window in milliseconds (default: 86_400_000ms = 24h). */
  dedupWindowMs?: number;
  /** Maximum distinct idempotency keys retained in memory before LRU eviction (default: 100_000). */
  maxDedupEntries?: number;
  /** Tumbling bucket granularity in milliseconds for sub-second/minute rollups (default: 60_000ms = 1m). */
  bucketGranularityMs?: number;
  /** Maximum retained buckets per (subscriptionId, metricType) stream (default: 1_440 = 24h of 1m buckets). */
  maxBucketsPerStream?: number;
  /** Policy for events arriving behind (watermark - allowedLatenessMs): 'drop_dlq' | 'route_adjustment' (default: 'drop_dlq'). */
  lateEventPolicy?: 'drop_dlq' | 'route_adjustment';
  /** Backpressure policy when queue depth reaches maxQueueDepth: 'flush_sync' | 'reject' (default: 'flush_sync'). */
  backpressurePolicy?: 'flush_sync' | 'reject';
  /** Injectable clock function for deterministic testing (default: () => Date.now()). */
  now?: () => number;
}

export interface UsageRollupBucket {
  bucketStartMs: number;
  bucketEndMs: number;
  sum: number;
  count: number;
  min: number;
  max: number;
  values: number[];
  lateEventCount: number;
}

export interface DeadLetterUsageEvent {
  event: PipelineUsageEvent;
  idempotencyKey: string;
  eventTimeMs: number;
  watermarkMs: number;
  droppedAtMs: number;
  reason: string;
}

export interface LateUsageAdjustment {
  idempotencyKey: string;
  subscriptionId: string;
  metricType: string;
  amount: number;
  eventTimeMs: number;
  watermarkMs: number;
  recordedAtMs: number;
  dimensions?: Record<string, string>;
}

export interface PipelineThresholdAlertRecord {
  id: string;
  subscriptionId: string;
  metric: string;
  level: UsageAlertLevel;
  threshold: number;
  currentUsage: number;
  ratio: number;
  message: string;
  createdAt: Date;
  acknowledged: boolean;
}

export type ThresholdAlertListener = (
  alert: UsageThresholdAlert,
  record: PipelineThresholdAlertRecord
) => void | Promise<void>;

export type RollupQueryWindowOrRange =
  AggregationWindow | { start: Date | number; end: Date | number };

export interface PeriodSettlementInput {
  subscriptionId: string;
  period: { start: Date; end: Date };
  plans: MeterPricingPlan[];
  currency?: string;
  prorationFactor?: number;
  resetAfterSettlement?: boolean;
}

export interface PeriodSettlementResult {
  bill: RatedUsageBill;
  usageByMetric: Record<string, number>;
  lateAdjustmentsApplied: Record<string, number>;
  settledAt: Date;
}

export interface PipelineMetrics {
  ingestedCount: number;
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  lateAcceptedCount: number;
  droppedLateCount: number;
  backpressureRejectedCount: number;
  clockSkewCount: number;
  flushedBatchCount: number;
  flushedEventCount: number;
  pendingQueueDepth: number;
  dedupCacheSize: number;
  activeStreamsCount: number;
  dlqSize: number;
  lateAdjustmentsCount: number;
  lastFlushAtMs: number | null;
}

interface InternalRollupBucket extends UsageRollupBucket {
  entries: { eventTimeMs: number; amount: number }[];
}

interface StreamState {
  subscriptionId: string;
  metricType: string;
  maxObservedEventTimeMs: number | null;
  watermarkMs: number | null;
  buckets: Map<number, InternalRollupBucket>;
  periodUsageSum: number;
  firedAlertLevels: Set<UsageAlertLevel>;
}

interface BufferedPipelineEvent {
  idempotencyKey: string;
  subscriptionId: string;
  metricType: string;
  amount: number;
  eventTimeMs: number;
  bucketStartMs: number;
  lateEvent: boolean;
  clockSkewDetected: boolean;
  dimensions?: Record<string, string>;
}

interface DedupCacheEntry {
  result: PipelineIngestResult;
  expiresAt: number;
}

const DEFAULT_PIPELINE_CONFIG: Required<UsageMeteringPipelineConfig> = {
  maxBatchSize: 500,
  maxQueueDepth: 10_000,
  flushIntervalMs: 100,
  maxOutOfOrdernessMs: 30_000,
  allowedLatenessMs: 300_000,
  maxClockSkewMs: 300_000,
  dedupWindowMs: 86_400_000,
  maxDedupEntries: 100_000,
  bucketGranularityMs: 60_000,
  maxBucketsPerStream: 1_440,
  lateEventPolicy: 'drop_dlq',
  backpressurePolicy: 'flush_sync',
  now: () => Date.now(),
};

const SOFT_THRESHOLD_RATIO = 0.8;
const HARD_THRESHOLD_RATIO = 1.0;

function buildStreamKey(subscriptionId: string, metricType: string): string {
  return `${subscriptionId}::${metricType}`;
}

function parseTimestampMs(ts: Date | number | string): number {
  if (ts instanceof Date) {
    return ts.getTime();
  }
  if (typeof ts === 'number') {
    return Number.isFinite(ts) ? ts : Number.NaN;
  }
  if (typeof ts === 'string' && ts.trim().length > 0) {
    return new Date(ts).getTime();
  }
  return Number.NaN;
}

function computePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const rank = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedValues[lower];
  const weight = rank - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export class UsageMeteringPipeline {
  private readonly config: Required<UsageMeteringPipelineConfig>;
  private readonly seenKeys = new Map<string, DedupCacheEntry>();
  private readonly streams = new Map<string, StreamState>();
  private readonly pendingBuffer: BufferedPipelineEvent[] = [];
  private readonly deadLetterQueue: DeadLetterUsageEvent[] = [];
  private readonly lateAdjustments: LateUsageAdjustment[] = [];
  private readonly quotaLimits = new Map<string, number>();
  private readonly alerts: PipelineThresholdAlertRecord[] = [];
  private readonly alertListeners = new Set<ThresholdAlertListener>();

  private flushTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private autoSequence = 0;

  private ingestedCount = 0;
  private acceptedCount = 0;
  private duplicateCount = 0;
  private rejectedCount = 0;
  private lateAcceptedCount = 0;
  private droppedLateCount = 0;
  private backpressureRejectedCount = 0;
  private clockSkewCount = 0;
  private flushedBatchCount = 0;
  private flushedEventCount = 0;
  private lastFlushAtMs: number | null = null;

  constructor(config: UsageMeteringPipelineConfig = {}) {
    this.config = {
      ...DEFAULT_PIPELINE_CONFIG,
      ...config,
    };
  }

  /**
   * Starts a background periodic flush loop at `flushIntervalMs`.
   */
  start(): void {
    if (this.intervalHandle || this.config.flushIntervalMs <= 0) {
      return;
    }
    this.intervalHandle = setInterval(() => {
      this.flush();
    }, this.config.flushIntervalMs);
    if (typeof this.intervalHandle.unref === 'function') {
      this.intervalHandle.unref();
    }
  }

  /**
   * Stops background flush timers and commits any remaining buffered events.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.flushTimeoutHandle) {
      clearTimeout(this.flushTimeoutHandle);
      this.flushTimeoutHandle = null;
    }
    this.flush();
  }

  /**
   * Validates, deduplicates, evaluates watermark/lateness, and places the event
   * into the sub-second micro-batch buffer. Automatically flushes synchronously
   * when `maxBatchSize` (or `maxQueueDepth` under `flush_sync`) is reached.
   */
  enqueue(event: PipelineUsageEvent): PipelineIngestResult {
    this.ingestedCount += 1;

    const validationError = this.validateEvent(event);
    if (validationError) {
      this.rejectedCount += 1;
      return {
        idempotencyKey:
          typeof event?.idempotencyKey === 'string' && event.idempotencyKey.trim().length > 0
            ? event.idempotencyKey.trim()
            : 'unknown',
        subscriptionId: typeof event?.subscriptionId === 'string' ? event.subscriptionId : '',
        metricType: typeof event?.metricType === 'string' ? event.metricType : '',
        status: 'rejected',
        reason: validationError,
      };
    }

    const subscriptionId = event.subscriptionId.trim();
    const metricType = event.metricType.trim();
    const streamKey = buildStreamKey(subscriptionId, metricType);
    const serverNow = this.config.now();
    const rawEventTime = parseTimestampMs(event.timestamp);

    const idempotencyKey =
      typeof event.idempotencyKey === 'string' && event.idempotencyKey.trim().length > 0
        ? event.idempotencyKey.trim()
        : `auto-${streamKey}-${rawEventTime}-${++this.autoSequence}`;

    // 1. O(1) TTL-bounded + LRU idempotency deduplication lookup
    const cachedDedup = this.lookupDedupKey(idempotencyKey, serverNow);
    if (cachedDedup) {
      this.duplicateCount += 1;
      return {
        ...cachedDedup,
        status: 'duplicate',
      };
    }

    // 2. Backpressure check before admitting to queue
    if (this.pendingBuffer.length >= this.config.maxQueueDepth) {
      if (this.config.backpressurePolicy === 'reject') {
        this.backpressureRejectedCount += 1;
        return {
          idempotencyKey,
          subscriptionId,
          metricType,
          status: 'backpressure_rejected',
          reason: `Pipeline queue depth (${this.pendingBuffer.length}) reached maxQueueDepth (${this.config.maxQueueDepth})`,
        };
      }
      // flush_sync policy drains pending queue synchronously before continuing
      this.flush();
    }

    // 3. Clock skew detection & future timestamp clamping
    const clockSkewDetected = Math.abs(serverNow - rawEventTime) > this.config.maxClockSkewMs;
    if (clockSkewDetected) {
      this.clockSkewCount += 1;
    }
    const eventTimeMs = rawEventTime > serverNow ? serverNow : rawEventTime;

    // 4. Per-stream event-time watermark progression
    const stream = this.getOrCreateStream(subscriptionId, metricType);
    const nextMaxObserved =
      stream.maxObservedEventTimeMs === null
        ? eventTimeMs
        : Math.max(stream.maxObservedEventTimeMs, eventTimeMs);
    stream.maxObservedEventTimeMs = nextMaxObserved;
    const watermarkMs = nextMaxObserved - this.config.maxOutOfOrdernessMs;
    stream.watermarkMs = watermarkMs;

    const granularity = this.config.bucketGranularityMs;
    const bucketStartMs = Math.floor(eventTimeMs / granularity) * granularity;

    // 5. Lateness classification against [watermarkMs - allowedLatenessMs, watermarkMs]
    const latenessCutoffMs = watermarkMs - this.config.allowedLatenessMs;

    if (eventTimeMs < latenessCutoffMs) {
      if (this.config.lateEventPolicy === 'drop_dlq') {
        const reason = 'Event timestamp precedes watermark allowed lateness cutoff';
        this.deadLetterQueue.push({
          event,
          idempotencyKey,
          eventTimeMs,
          watermarkMs,
          droppedAtMs: serverNow,
          reason,
        });
        this.droppedLateCount += 1;

        const droppedResult: PipelineIngestResult = {
          idempotencyKey,
          subscriptionId,
          metricType,
          status: 'dropped_late',
          watermarkMs,
          clockSkewDetected,
          lateEvent: true,
          reason,
        };
        this.recordDedupKey(idempotencyKey, droppedResult, serverNow);
        return droppedResult;
      }

      // route_adjustment policy: record into next-period reconciliation ledger
      this.lateAdjustments.push({
        idempotencyKey,
        subscriptionId,
        metricType,
        amount: event.amount,
        eventTimeMs,
        watermarkMs,
        recordedAtMs: serverNow,
        dimensions: event.dimensions,
      });
      this.lateAcceptedCount += 1;

      const adjustmentResult: PipelineIngestResult = {
        idempotencyKey,
        subscriptionId,
        metricType,
        status: 'late_accepted',
        bucketStartMs,
        watermarkMs,
        clockSkewDetected,
        lateEvent: true,
        reason: 'Routed to next-period late adjustment ledger',
      };
      this.recordDedupKey(idempotencyKey, adjustmentResult, serverNow);
      return adjustmentResult;
    }

    const isLateWithinWindow = eventTimeMs < watermarkMs;
    const status: PipelineEventDisposition = isLateWithinWindow ? 'late_accepted' : 'accepted';
    if (isLateWithinWindow) {
      this.lateAcceptedCount += 1;
    } else {
      this.acceptedCount += 1;
    }

    const result: PipelineIngestResult = {
      idempotencyKey,
      subscriptionId,
      metricType,
      status,
      bucketStartMs,
      watermarkMs,
      clockSkewDetected,
      lateEvent: isLateWithinWindow,
    };

    this.recordDedupKey(idempotencyKey, result, serverNow);

    this.pendingBuffer.push({
      idempotencyKey,
      subscriptionId,
      metricType,
      amount: event.amount,
      eventTimeMs,
      bucketStartMs,
      lateEvent: isLateWithinWindow,
      clockSkewDetected,
      dimensions: event.dimensions,
    });

    // Trigger synchronous micro-batch flush when maxBatchSize is reached (unless
    // maxQueueDepth < maxBatchSize under 'reject' policy to allow queue depth saturation).
    const shouldFlushOnBatchSize =
      this.pendingBuffer.length >= this.config.maxBatchSize &&
      (this.config.backpressurePolicy === 'flush_sync' ||
        this.config.maxBatchSize < this.config.maxQueueDepth);
    const shouldFlushOnQueueDepth =
      this.pendingBuffer.length >= this.config.maxQueueDepth &&
      this.config.backpressurePolicy === 'flush_sync';

    if (shouldFlushOnBatchSize || shouldFlushOnQueueDepth) {
      this.flush();
    } else {
      this.scheduleSubSecondFlush();
    }

    return result;
  }

  /**
   * Enqueues a batch of events into the micro-batching buffer.
   */
  enqueueBatch(events: PipelineUsageEvent[]): PipelineIngestResult[] {
    const results: PipelineIngestResult[] = [];
    for (const event of events) {
      results.push(this.enqueue(event));
    }
    return results;
  }

  /**
   * Enqueues a single event and immediately flushes the micro-batch buffer.
   */
  ingest(event: PipelineUsageEvent): PipelineIngestResult {
    const result = this.enqueue(event);
    if (this.pendingBuffer.length > 0) {
      this.flush();
    }
    return result;
  }

  /**
   * Enqueues a batch of events and immediately flushes all pending micro-batches.
   */
  ingestBatch(events: PipelineUsageEvent[]): PipelineIngestResult[] {
    const results = this.enqueueBatch(events);
    if (this.pendingBuffer.length > 0) {
      this.flush();
    }
    return results;
  }

  /**
   * Commits all currently buffered events into their target tumbling rollup
   * buckets in a single pass and evaluates quota thresholds once per affected stream.
   *
   * @returns Number of events committed in this flush.
   */
  flush(): number {
    if (this.flushTimeoutHandle) {
      clearTimeout(this.flushTimeoutHandle);
      this.flushTimeoutHandle = null;
    }

    if (this.pendingBuffer.length === 0) {
      return 0;
    }

    const batch = this.pendingBuffer.splice(0, this.pendingBuffer.length);
    const affectedStreams = new Set<string>();

    for (const item of batch) {
      const streamKey = buildStreamKey(item.subscriptionId, item.metricType);
      const stream = this.getOrCreateStream(item.subscriptionId, item.metricType);
      affectedStreams.add(streamKey);

      let bucket = stream.buckets.get(item.bucketStartMs);
      if (!bucket) {
        bucket = {
          bucketStartMs: item.bucketStartMs,
          bucketEndMs: item.bucketStartMs + this.config.bucketGranularityMs,
          sum: 0,
          count: 0,
          min: item.amount,
          max: item.amount,
          values: [],
          lateEventCount: 0,
          entries: [],
        };
        stream.buckets.set(item.bucketStartMs, bucket);
      }

      bucket.sum += item.amount;
      bucket.count += 1;
      if (item.amount < bucket.min) bucket.min = item.amount;
      if (item.amount > bucket.max) bucket.max = item.amount;
      bucket.values.push(item.amount);
      bucket.entries.push({ eventTimeMs: item.eventTimeMs, amount: item.amount });
      if (item.lateEvent) {
        bucket.lateEventCount += 1;
      }

      stream.periodUsageSum += item.amount;
      this.trimStreamBuckets(stream);
    }

    this.flushedBatchCount += 1;
    this.flushedEventCount += batch.length;
    this.lastFlushAtMs = this.config.now();

    // Evaluate quota thresholds once per affected stream per batch flush
    for (const streamKey of affectedStreams) {
      const stream = this.streams.get(streamKey);
      if (stream) {
        this.evaluateStreamThreshold(stream);
      }
    }

    return batch.length;
  }

  /**
   * Queries pre-aggregated rollup statistics (`SUM`, `MAX`, `AVERAGE`,
   * `PERCENTILE_95`, `PERCENTILE_99`) for a subscription and metric over a
   * standard `AggregationWindow` (`HOURLY`, `DAILY`, `MONTHLY`) or custom time range.
   */
  queryRollup(
    subscriptionId: string,
    metricType: string,
    windowOrRange: RollupQueryWindowOrRange = AggregationWindow.MONTHLY,
    fn: AggregationFunction = AggregationFunction.SUM,
    referenceNowMs?: number
  ): number {
    if (this.pendingBuffer.length > 0) {
      this.flush();
    }

    const stream = this.streams.get(buildStreamKey(subscriptionId, metricType));
    if (!stream || stream.buckets.size === 0) {
      return 0;
    }

    let startMs: number;
    let endMs: number;

    if (typeof windowOrRange === 'string') {
      endMs = referenceNowMs ?? this.config.now();
      const windowDuration =
        AGGREGATION_WINDOW_MS[windowOrRange] ?? AGGREGATION_WINDOW_MS[AggregationWindow.MONTHLY];
      startMs = endMs - windowDuration;
    } else {
      startMs = parseTimestampMs(windowOrRange.start);
      endMs = parseTimestampMs(windowOrRange.end);
    }

    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
      return 0;
    }

    let totalSum = 0;
    let totalCount = 0;
    let maxVal = Number.NEGATIVE_INFINITY;
    const needValues =
      fn === AggregationFunction.PERCENTILE_95 || fn === AggregationFunction.PERCENTILE_99;
    const collectedValues: number[] = [];

    for (const bucket of stream.buckets.values()) {
      if (bucket.bucketEndMs <= startMs || bucket.bucketStartMs > endMs) {
        continue;
      }

      const fullyContained = bucket.bucketStartMs >= startMs && bucket.bucketEndMs <= endMs;
      if (fullyContained) {
        totalSum += bucket.sum;
        totalCount += bucket.count;
        if (bucket.max > maxVal) {
          maxVal = bucket.max;
        }
        if (needValues) {
          collectedValues.push(...bucket.values);
        }
      } else {
        for (const entry of bucket.entries) {
          if (entry.eventTimeMs >= startMs && entry.eventTimeMs <= endMs) {
            totalSum += entry.amount;
            totalCount += 1;
            if (entry.amount > maxVal) {
              maxVal = entry.amount;
            }
            if (needValues) {
              collectedValues.push(entry.amount);
            }
          }
        }
      }
    }

    if (totalCount === 0) {
      return 0;
    }

    switch (fn) {
      case AggregationFunction.SUM:
        return totalSum;
      case AggregationFunction.MAX:
        return maxVal;
      case AggregationFunction.AVERAGE:
        return totalSum / totalCount;
      case AggregationFunction.PERCENTILE_95:
        return computePercentile(
          collectedValues.sort((a, b) => a - b),
          95
        );
      case AggregationFunction.PERCENTILE_99:
        return computePercentile(
          collectedValues.sort((a, b) => a - b),
          99
        );
      default:
        return totalSum;
    }
  }

  /**
   * Returns tumbling rollup buckets for a stream, ordered by `bucketStartMs` ascending.
   */
  getRollupBuckets(
    subscriptionId: string,
    metricType: string,
    range?: { start?: Date | number; end?: Date | number }
  ): UsageRollupBucket[] {
    if (this.pendingBuffer.length > 0) {
      this.flush();
    }

    const stream = this.streams.get(buildStreamKey(subscriptionId, metricType));
    if (!stream) {
      return [];
    }

    const startMs =
      range?.start !== undefined ? parseTimestampMs(range.start) : Number.NEGATIVE_INFINITY;
    const endMs = range?.end !== undefined ? parseTimestampMs(range.end) : Number.POSITIVE_INFINITY;

    return [...stream.buckets.values()]
      .filter((b) => b.bucketEndMs > startMs && b.bucketStartMs <= endMs)
      .sort((a, b) => a.bucketStartMs - b.bucketStartMs)
      .map((b) => ({
        bucketStartMs: b.bucketStartMs,
        bucketEndMs: b.bucketEndMs,
        sum: b.sum,
        count: b.count,
        min: b.min,
        max: b.max,
        values: [...b.values],
        lateEventCount: b.lateEventCount,
      }));
  }

  /**
   * Sets a period quota limit for a `(subscriptionId, metricType)` stream.
   * Re-arms threshold alerts if the limit is raised above current consumption ratios.
   */
  setQuotaLimit(subscriptionId: string, metricType: string, limit: number): void {
    const streamKey = buildStreamKey(subscriptionId, metricType);
    this.quotaLimits.set(streamKey, limit);

    const stream = this.streams.get(streamKey);
    if (stream && limit > 0) {
      const ratio = stream.periodUsageSum / limit;
      if (ratio < HARD_THRESHOLD_RATIO) {
        stream.firedAlertLevels.delete(UsageAlertLevel.HARD);
      }
      if (ratio < SOFT_THRESHOLD_RATIO) {
        stream.firedAlertLevels.delete(UsageAlertLevel.SOFT);
      }
    }
  }

  /**
   * Retrieves the configured quota limit for a stream, if any.
   */
  getQuotaLimit(subscriptionId: string, metricType: string): number | undefined {
    return this.quotaLimits.get(buildStreamKey(subscriptionId, metricType));
  }

  /**
   * Evaluates quota thresholds for a subscription (across a specific metric or all configured metrics).
   */
  checkThresholds(subscriptionId: string, metricType?: string): UsageThresholdAlert | null {
    if (this.pendingBuffer.length > 0) {
      this.flush();
    }

    const candidateMetrics: string[] = [];
    if (metricType) {
      candidateMetrics.push(metricType);
    } else {
      const prefix = `${subscriptionId}::`;
      for (const key of this.quotaLimits.keys()) {
        if (key.startsWith(prefix)) {
          candidateMetrics.push(key.slice(prefix.length));
        }
      }
    }

    for (const mt of candidateMetrics) {
      const stream = this.getOrCreateStream(subscriptionId, mt);
      const alert = this.evaluateStreamThreshold(stream);
      if (alert) {
        return alert;
      }
    }

    return null;
  }

  /**
   * Registers a callback invoked whenever a new soft (80%) or hard (100%)
   * quota threshold alert is triggered.
   *
   * @returns Unsubscribe function.
   */
  onThresholdAlert(listener: ThresholdAlertListener): () => void {
    this.alertListeners.add(listener);
    return () => {
      this.alertListeners.delete(listener);
    };
  }

  /**
   * Returns generated threshold alert records, optionally filtered by subscription
   * and acknowledgment status.
   */
  getAlerts(subscriptionId?: string, includeAcknowledged = false): PipelineThresholdAlertRecord[] {
    return this.alerts.filter((alert) => {
      if (!includeAcknowledged && alert.acknowledged) return false;
      if (subscriptionId && alert.subscriptionId !== subscriptionId) return false;
      return true;
    });
  }

  /**
   * Marks an alert as acknowledged.
   */
  acknowledgeAlert(alertId: string): boolean {
    const found = this.alerts.find((a) => a.id === alertId);
    if (!found) return false;
    found.acknowledged = true;
    return true;
  }

  /**
   * Settles a subscription's billing period by flushing pending micro-batches,
   * aggregating period usage across all meters (including any routed late
   * adjustments), and rating the usage via `rateUsage()`.
   */
  settlePeriod(input: PeriodSettlementInput): PeriodSettlementResult {
    this.flush();

    const startMs = input.period.start.getTime();
    const endMs = input.period.end.getTime();

    const metricsToSettle = new Set<string>();
    for (const plan of input.plans) {
      metricsToSettle.add(plan.metric);
    }
    const prefix = `${input.subscriptionId}::`;
    for (const key of this.streams.keys()) {
      if (key.startsWith(prefix)) {
        metricsToSettle.add(key.slice(prefix.length));
      }
    }
    for (const adj of this.lateAdjustments) {
      if (adj.subscriptionId === input.subscriptionId) {
        metricsToSettle.add(adj.metricType);
      }
    }

    const usageByMetric: Record<string, number> = {};
    const lateAdjustmentsApplied: Record<string, number> = {};

    for (const metric of metricsToSettle) {
      const windowSum =
        endMs >= startMs
          ? this.queryRollup(
              input.subscriptionId,
              metric,
              { start: startMs, end: endMs },
              AggregationFunction.SUM
            )
          : 0;

      const lateSum = this.lateAdjustments
        .filter((a) => a.subscriptionId === input.subscriptionId && a.metricType === metric)
        .reduce((acc, a) => acc + a.amount, 0);

      if (lateSum > 0) {
        lateAdjustmentsApplied[metric] = lateSum;
      }

      const combined = windowSum + lateSum;
      if (combined > 0 || input.plans.some((p) => p.metric === metric)) {
        usageByMetric[metric] = combined;
      }
    }

    const bill = rateUsage({
      subscriptionId: input.subscriptionId,
      period: input.period,
      usageByMetric,
      plans: input.plans,
      currency: input.currency,
      prorationFactor: input.prorationFactor,
    });

    if (input.resetAfterSettlement) {
      for (let i = this.lateAdjustments.length - 1; i >= 0; i -= 1) {
        if (this.lateAdjustments[i].subscriptionId === input.subscriptionId) {
          this.lateAdjustments.splice(i, 1);
        }
      }
      for (const metric of metricsToSettle) {
        this.resetStreamPeriod(input.subscriptionId, metric);
      }
    }

    return {
      bill,
      usageByMetric,
      lateAdjustmentsApplied,
      settledAt: new Date(this.config.now()),
    };
  }

  /**
   * Returns current event-time watermark (in epoch ms) for a stream, or `null`
   * if no events have been ingested on that stream.
   */
  getWatermark(subscriptionId: string, metricType: string): number | null {
    const stream = this.streams.get(buildStreamKey(subscriptionId, metricType));
    return stream?.watermarkMs ?? null;
  }

  /**
   * Returns events dropped to the dead-letter queue due to arriving behind
   * `watermark - allowedLatenessMs` when `lateEventPolicy === 'drop_dlq'`.
   */
  getDeadLetterQueue(subscriptionId?: string, metricType?: string): DeadLetterUsageEvent[] {
    return this.deadLetterQueue.filter((entry) => {
      if (subscriptionId && entry.event.subscriptionId !== subscriptionId) return false;
      if (metricType && entry.event.metricType !== metricType) return false;
      return true;
    });
  }

  /**
   * Returns late-arriving event adjustments queued for next-period billing
   * reconciliation when `lateEventPolicy === 'route_adjustment'`.
   */
  getLateAdjustments(subscriptionId?: string, metricType?: string): LateUsageAdjustment[] {
    return this.lateAdjustments.filter((entry) => {
      if (subscriptionId && entry.subscriptionId !== subscriptionId) return false;
      if (metricType && entry.metricType !== metricType) return false;
      return true;
    });
  }

  /**
   * Resets period accumulators, rollup buckets, and per-period threshold alert
   * state for a subscription stream.
   */
  resetStreamPeriod(subscriptionId: string, metricType?: string): void {
    this.flush();

    if (metricType) {
      const stream = this.streams.get(buildStreamKey(subscriptionId, metricType));
      if (stream) {
        stream.buckets.clear();
        stream.periodUsageSum = 0;
        stream.firedAlertLevels.clear();
      }
      return;
    }

    const prefix = `${subscriptionId}::`;
    for (const [key, stream] of this.streams.entries()) {
      if (key.startsWith(prefix)) {
        stream.buckets.clear();
        stream.periodUsageSum = 0;
        stream.firedAlertLevels.clear();
      }
    }
  }

  /**
   * Returns a live telemetry snapshot of pipeline counters and queue gauges.
   */
  getMetrics(): PipelineMetrics {
    return {
      ingestedCount: this.ingestedCount,
      acceptedCount: this.acceptedCount,
      duplicateCount: this.duplicateCount,
      rejectedCount: this.rejectedCount,
      lateAcceptedCount: this.lateAcceptedCount,
      droppedLateCount: this.droppedLateCount,
      backpressureRejectedCount: this.backpressureRejectedCount,
      clockSkewCount: this.clockSkewCount,
      flushedBatchCount: this.flushedBatchCount,
      flushedEventCount: this.flushedEventCount,
      pendingQueueDepth: this.pendingBuffer.length,
      dedupCacheSize: this.seenKeys.size,
      activeStreamsCount: this.streams.size,
      dlqSize: this.deadLetterQueue.length,
      lateAdjustmentsCount: this.lateAdjustments.length,
      lastFlushAtMs: this.lastFlushAtMs,
    };
  }

  /**
   * Resets all pipeline state, buffers, deduplication cache, streams, and metrics.
   */
  reset(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.flushTimeoutHandle) {
      clearTimeout(this.flushTimeoutHandle);
      this.flushTimeoutHandle = null;
    }

    this.pendingBuffer.length = 0;
    this.seenKeys.clear();
    this.streams.clear();
    this.deadLetterQueue.length = 0;
    this.lateAdjustments.length = 0;
    this.quotaLimits.clear();
    this.alerts.length = 0;
    this.alertListeners.clear();

    this.ingestedCount = 0;
    this.acceptedCount = 0;
    this.duplicateCount = 0;
    this.rejectedCount = 0;
    this.lateAcceptedCount = 0;
    this.droppedLateCount = 0;
    this.backpressureRejectedCount = 0;
    this.clockSkewCount = 0;
    this.flushedBatchCount = 0;
    this.flushedEventCount = 0;
    this.lastFlushAtMs = null;
  }

  private validateEvent(event: PipelineUsageEvent): string | null {
    if (!event || typeof event !== 'object') {
      return 'event must be an object';
    }
    if (typeof event.subscriptionId !== 'string' || event.subscriptionId.trim().length === 0) {
      return 'subscriptionId is required';
    }
    if (typeof event.metricType !== 'string' || event.metricType.trim().length === 0) {
      return 'metricType is required';
    }
    if (typeof event.amount !== 'number' || !Number.isFinite(event.amount) || event.amount < 0) {
      return 'amount must be a non-negative finite number';
    }
    const tsMs = parseTimestampMs(event.timestamp);
    if (Number.isNaN(tsMs)) {
      return 'timestamp must be a valid Date, epoch ms, or ISO-8601 string';
    }
    return null;
  }

  private lookupDedupKey(idempotencyKey: string, nowMs: number): PipelineIngestResult | null {
    const existing = this.seenKeys.get(idempotencyKey);
    if (!existing) {
      return null;
    }
    if (existing.expiresAt <= nowMs) {
      this.seenKeys.delete(idempotencyKey);
      return null;
    }
    // Refresh LRU order in O(1) by re-inserting
    this.seenKeys.delete(idempotencyKey);
    this.seenKeys.set(idempotencyKey, existing);
    return existing.result;
  }

  private recordDedupKey(
    idempotencyKey: string,
    result: PipelineIngestResult,
    nowMs: number
  ): void {
    if (this.seenKeys.has(idempotencyKey)) {
      this.seenKeys.delete(idempotencyKey);
    } else if (this.seenKeys.size >= this.config.maxDedupEntries) {
      const oldestKey = this.seenKeys.keys().next().value;
      if (oldestKey !== undefined) {
        this.seenKeys.delete(oldestKey);
      }
    }

    this.seenKeys.set(idempotencyKey, {
      result,
      expiresAt: nowMs + this.config.dedupWindowMs,
    });
  }

  private getOrCreateStream(subscriptionId: string, metricType: string): StreamState {
    const streamKey = buildStreamKey(subscriptionId, metricType);
    let stream = this.streams.get(streamKey);
    if (!stream) {
      stream = {
        subscriptionId,
        metricType,
        maxObservedEventTimeMs: null,
        watermarkMs: null,
        buckets: new Map<number, InternalRollupBucket>(),
        periodUsageSum: 0,
        firedAlertLevels: new Set<UsageAlertLevel>(),
      };
      this.streams.set(streamKey, stream);
    }
    return stream;
  }

  private trimStreamBuckets(stream: StreamState): void {
    if (stream.buckets.size <= this.config.maxBucketsPerStream) {
      return;
    }
    const sortedKeys = [...stream.buckets.keys()].sort((a, b) => a - b);
    const excess = stream.buckets.size - this.config.maxBucketsPerStream;
    for (let i = 0; i < excess; i += 1) {
      stream.buckets.delete(sortedKeys[i]);
    }
  }

  private scheduleSubSecondFlush(): void {
    if (this.config.flushIntervalMs <= 0 || this.flushTimeoutHandle || this.intervalHandle) {
      return;
    }
    this.flushTimeoutHandle = setTimeout(() => {
      this.flushTimeoutHandle = null;
      this.flush();
    }, this.config.flushIntervalMs);
    if (typeof this.flushTimeoutHandle.unref === 'function') {
      this.flushTimeoutHandle.unref();
    }
  }

  private evaluateStreamThreshold(stream: StreamState): UsageThresholdAlert | null {
    const streamKey = buildStreamKey(stream.subscriptionId, stream.metricType);
    const limit = this.quotaLimits.get(streamKey);
    if (!limit || limit <= 0) {
      return null;
    }

    const usage = stream.periodUsageSum;
    const ratio = usage / limit;

    if (ratio >= HARD_THRESHOLD_RATIO) {
      const thresholdAlert: UsageThresholdAlert = {
        level: UsageAlertLevel.HARD,
        metric: stream.metricType as QuotaMetric,
        subscriptionId: stream.subscriptionId,
        usage,
        limit,
        ratio,
      };
      if (!stream.firedAlertLevels.has(UsageAlertLevel.HARD)) {
        stream.firedAlertLevels.add(UsageAlertLevel.SOFT);
        stream.firedAlertLevels.add(UsageAlertLevel.HARD);
        this.emitAlertRecord(thresholdAlert);
      }
      return thresholdAlert;
    }

    if (ratio >= SOFT_THRESHOLD_RATIO) {
      const thresholdAlert: UsageThresholdAlert = {
        level: UsageAlertLevel.SOFT,
        metric: stream.metricType as QuotaMetric,
        subscriptionId: stream.subscriptionId,
        usage,
        limit,
        ratio,
      };
      if (!stream.firedAlertLevels.has(UsageAlertLevel.SOFT)) {
        stream.firedAlertLevels.add(UsageAlertLevel.SOFT);
        this.emitAlertRecord(thresholdAlert);
      }
      return thresholdAlert;
    }

    return null;
  }

  private emitAlertRecord(thresholdAlert: UsageThresholdAlert): void {
    const nowMs = this.config.now();
    const record: PipelineThresholdAlertRecord = {
      id: `alert_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      subscriptionId: thresholdAlert.subscriptionId,
      metric: String(thresholdAlert.metric),
      level: thresholdAlert.level,
      threshold: thresholdAlert.limit,
      currentUsage: thresholdAlert.usage,
      ratio: thresholdAlert.ratio,
      message: `Usage for ${thresholdAlert.metric} has reached ${Math.round(thresholdAlert.ratio * 100)}% of limit`,
      createdAt: new Date(nowMs),
      acknowledged: false,
    };

    this.alerts.push(record);

    for (const listener of this.alertListeners) {
      try {
        void listener(thresholdAlert, record);
      } catch {
        // Prevent a faulty listener from interrupting stream flush commit
      }
    }
  }
}

export function createUsageMeteringPipeline(
  config?: UsageMeteringPipelineConfig
): UsageMeteringPipeline {
  return new UsageMeteringPipeline(config);
}
