import type { Request, Response } from 'express';
import {
  AggregationFunction,
  AggregationWindow,
  UsageAlertLevel,
  UsageThresholdAlert,
} from '../../../../src/types/usage';
import type { MeterPricingPlan } from '../metering';
import { MeteringService } from '../meteringService';
import { handleUsageIngestion } from '../usageIngestionApi';
import {
  createUsageMeteringPipeline,
  PipelineThresholdAlertRecord,
  PipelineUsageEvent,
  UsageMeteringPipeline,
} from '../usageMeteringPipeline';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: (code: number) => MockResponse;
  setHeader: (name: string, value: string) => MockResponse;
  json: (payload: unknown) => MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('UsageMeteringPipeline — High-Throughput Stream Processing Engine (#2197)', () => {
  const BASE_NOW = new Date('2026-03-15T12:00:00.000Z').getTime();

  describe('Micro-Batching, Sub-Second Flush & High-Throughput Ingestion', () => {
    it('buffers enqueued events and flushes synchronously when maxBatchSize is reached', () => {
      const currentNow = BASE_NOW;
      const pipeline = createUsageMeteringPipeline({
        maxBatchSize: 4,
        flushIntervalMs: 0,
        now: () => currentNow,
      });

      const r1 = pipeline.enqueue({
        subscriptionId: 'sub_alpha',
        metricType: 'api',
        amount: 10,
        timestamp: currentNow - 2_000,
        idempotencyKey: 'k1',
      });
      const r2 = pipeline.enqueue({
        subscriptionId: 'sub_alpha',
        metricType: 'api',
        amount: 20,
        timestamp: new Date(currentNow - 1_500),
        idempotencyKey: 'k2',
      });
      const r3 = pipeline.enqueue({
        subscriptionId: 'sub_alpha',
        metricType: 'api',
        amount: 30,
        timestamp: new Date(currentNow - 1_000).toISOString(),
        idempotencyKey: 'k3',
      });

      expect(r1.status).toBe('accepted');
      expect(r2.status).toBe('accepted');
      expect(r3.status).toBe('accepted');
      expect(pipeline.getMetrics().pendingQueueDepth).toBe(3);
      expect(pipeline.getMetrics().flushedBatchCount).toBe(0);

      // 4th event reaches maxBatchSize (4) and triggers immediate synchronous flush
      const r4 = pipeline.enqueue({
        subscriptionId: 'sub_alpha',
        metricType: 'api',
        amount: 40,
        timestamp: currentNow - 500,
        idempotencyKey: 'k4',
      });
      expect(r4.status).toBe('accepted');
      expect(pipeline.getMetrics().pendingQueueDepth).toBe(0);
      expect(pipeline.getMetrics().flushedBatchCount).toBe(1);
      expect(pipeline.getMetrics().flushedEventCount).toBe(4);
      expect(
        pipeline.queryRollup(
          'sub_alpha',
          'api',
          AggregationWindow.HOURLY,
          AggregationFunction.SUM,
          currentNow
        )
      ).toBe(100);
    });

    it('auto-flushes buffered micro-batches via sub-second background timer and start/stop lifecycle', async () => {
      const pipeline = new UsageMeteringPipeline({
        maxBatchSize: 100,
        flushIntervalMs: 25,
      });

      pipeline.enqueueBatch([
        {
          subscriptionId: 'sub_timer',
          metricType: 'compute',
          amount: 15,
          timestamp: Date.now(),
          idempotencyKey: 't1',
        },
        {
          subscriptionId: 'sub_timer',
          metricType: 'compute',
          amount: 25,
          timestamp: Date.now(),
          idempotencyKey: 't2',
        },
      ]);

      expect(pipeline.getMetrics().pendingQueueDepth).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(pipeline.getMetrics().pendingQueueDepth).toBe(0);
      expect(pipeline.getMetrics().flushedEventCount).toBe(2);

      // Test explicit periodic interval loop via start() and graceful stop()
      pipeline.start();
      // Calling start() a second time is a no-op
      pipeline.start();
      pipeline.enqueue({
        subscriptionId: 'sub_timer',
        metricType: 'compute',
        amount: 60,
        timestamp: Date.now(),
        idempotencyKey: 't3',
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(pipeline.getMetrics().flushedEventCount).toBe(3);

      // Enqueue one more and stop immediately — stop() must flush remaining events
      pipeline.enqueue({
        subscriptionId: 'sub_timer',
        metricType: 'compute',
        amount: 50,
        timestamp: Date.now(),
        idempotencyKey: 't4',
      });
      pipeline.stop();
      expect(pipeline.getMetrics().pendingQueueDepth).toBe(0);
      expect(pipeline.queryRollup('sub_timer', 'compute')).toBe(150);
    });

    it('supports immediate ingest() and ingestBatch() and handles flush() when buffer is empty', () => {
      const pipeline = new UsageMeteringPipeline({ flushIntervalMs: 0 });
      expect(pipeline.flush()).toBe(0);
      // Calling start() when flushIntervalMs <= 0 is a safe no-op
      pipeline.start();

      const single = pipeline.ingest({
        subscriptionId: 'sub_imm',
        metricType: 'storage',
        amount: 12,
        timestamp: BASE_NOW,
      });
      expect(single.status).toBe('accepted');
      expect(single.idempotencyKey).toMatch(/^auto-sub_imm::storage-/);
      expect(pipeline.getMetrics().pendingQueueDepth).toBe(0);

      const batchResults = pipeline.ingestBatch([
        {
          subscriptionId: 'sub_imm',
          metricType: 'storage',
          amount: 18,
          timestamp: BASE_NOW + 100,
        },
        {
          subscriptionId: 'sub_imm',
          metricType: 'storage',
          amount: 30,
          timestamp: BASE_NOW + 200,
        },
      ]);
      expect(batchResults).toHaveLength(2);
      expect(
        pipeline.queryRollup(
          'sub_imm',
          'storage',
          AggregationWindow.HOURLY,
          AggregationFunction.SUM,
          BASE_NOW + 200
        )
      ).toBe(60);
    });

    it('processes 5,000+ high-throughput usage events across multiple subscriptions in sub-second time', () => {
      const pipeline = new UsageMeteringPipeline({
        maxBatchSize: 500,
        maxQueueDepth: 10_000,
        flushIntervalMs: 0,
        now: () => BASE_NOW,
      });

      const totalEvents = 5_000;
      const subscriptions = ['sub_ent_1', 'sub_ent_2', 'sub_ent_3', 'sub_ent_4', 'sub_ent_5'];
      const events: PipelineUsageEvent[] = [];

      for (let i = 0; i < totalEvents; i += 1) {
        const subId = subscriptions[i % subscriptions.length];
        events.push({
          subscriptionId: subId,
          metricType: 'api',
          amount: 2,
          timestamp: BASE_NOW - (totalEvents - i) * 10,
          idempotencyKey: `burst_${i}`,
          dimensions: { region: i % 2 === 0 ? 'us-east' : 'eu-west' },
        });
      }

      const startedAt = Date.now();
      const results = pipeline.enqueueBatch(events);
      pipeline.flush();
      const elapsedMs = Date.now() - startedAt;

      expect(results).toHaveLength(totalEvents);
      expect(elapsedMs).toBeLessThan(1_000);
      expect(pipeline.getMetrics().acceptedCount).toBe(totalEvents);
      expect(pipeline.getMetrics().flushedEventCount).toBe(totalEvents);

      for (const subId of subscriptions) {
        const sum = pipeline.queryRollup(
          subId,
          'api',
          AggregationWindow.HOURLY,
          AggregationFunction.SUM,
          BASE_NOW
        );
        expect(sum).toBe(2_000);
      }
    });

    it('validates malformed events and increments rejectedCount without throwing', () => {
      const pipeline = new UsageMeteringPipeline({ flushIntervalMs: 0 });

      const nullEvent = pipeline.enqueue(null as unknown as PipelineUsageEvent);
      expect(nullEvent.status).toBe('rejected');
      expect(nullEvent.reason).toMatch(/event must be an object/);

      const noSub = pipeline.enqueue({
        subscriptionId: '   ',
        metricType: 'api',
        amount: 5,
        timestamp: BASE_NOW,
        idempotencyKey: 'bad_sub',
      });
      expect(noSub.status).toBe('rejected');
      expect(noSub.idempotencyKey).toBe('bad_sub');
      expect(noSub.reason).toMatch(/subscriptionId is required/);

      const noMetric = pipeline.enqueue({
        subscriptionId: 'sub_1',
        metricType: '',
        amount: 5,
        timestamp: BASE_NOW,
      });
      expect(noMetric.status).toBe('rejected');
      expect(noMetric.reason).toMatch(/metricType is required/);

      const negAmount = pipeline.enqueue({
        subscriptionId: 'sub_1',
        metricType: 'api',
        amount: -1,
        timestamp: BASE_NOW,
      });
      expect(negAmount.status).toBe('rejected');
      expect(negAmount.reason).toMatch(/amount must be a non-negative finite number/);

      const badTsString = pipeline.enqueue({
        subscriptionId: 'sub_1',
        metricType: 'api',
        amount: 10,
        timestamp: 'not-a-timestamp',
      });
      expect(badTsString.status).toBe('rejected');
      expect(badTsString.reason).toMatch(/timestamp must be a valid/);

      const emptyTsString = pipeline.enqueue({
        subscriptionId: 'sub_1',
        metricType: 'api',
        amount: 10,
        timestamp: '   ',
      });
      expect(emptyTsString.status).toBe('rejected');

      const nanTsNumber = pipeline.enqueue({
        subscriptionId: 'sub_1',
        metricType: 'api',
        amount: 10,
        timestamp: Number.NaN,
      });
      expect(nanTsNumber.status).toBe('rejected');

      expect(pipeline.getMetrics().rejectedCount).toBe(7);
    });
  });

  describe('Idempotency & Deduplication Window (TTL + LRU)', () => {
    it('deduplicates identical idempotencyKey within the same batch and across batches', () => {
      const pipeline = new UsageMeteringPipeline({
        flushIntervalMs: 0,
        now: () => BASE_NOW,
      });

      const batchResults = pipeline.ingestBatch([
        {
          subscriptionId: 'sub_dedup',
          metricType: 'api',
          amount: 50,
          timestamp: BASE_NOW,
          idempotencyKey: 'dup_key_1',
        },
        {
          subscriptionId: 'sub_dedup',
          metricType: 'api',
          amount: 50,
          timestamp: BASE_NOW,
          idempotencyKey: 'dup_key_1',
        },
      ]);

      expect(batchResults[0].status).toBe('accepted');
      expect(batchResults[1].status).toBe('duplicate');

      const followUp = pipeline.ingest({
        subscriptionId: 'sub_dedup',
        metricType: 'api',
        amount: 50,
        timestamp: BASE_NOW,
        idempotencyKey: 'dup_key_1',
      });
      expect(followUp.status).toBe('duplicate');
      expect(pipeline.getMetrics().duplicateCount).toBe(2);
      expect(
        pipeline.queryRollup(
          'sub_dedup',
          'api',
          AggregationWindow.HOURLY,
          AggregationFunction.SUM,
          BASE_NOW
        )
      ).toBe(50);
    });

    it('expires idempotency keys after dedupWindowMs and allows re-ingestion', () => {
      let currentNow = BASE_NOW;
      const pipeline = new UsageMeteringPipeline({
        flushIntervalMs: 0,
        dedupWindowMs: 10_000,
        now: () => currentNow,
      });

      const first = pipeline.ingest({
        subscriptionId: 'sub_ttl',
        metricType: 'api',
        amount: 25,
        timestamp: currentNow,
        idempotencyKey: 'ttl_key',
      });
      expect(first.status).toBe('accepted');

      // Advance 5s (still within 10s dedup window)
      currentNow += 5_000;
      const duplicate = pipeline.ingest({
        subscriptionId: 'sub_ttl',
        metricType: 'api',
        amount: 25,
        timestamp: currentNow,
        idempotencyKey: 'ttl_key',
      });
      expect(duplicate.status).toBe('duplicate');

      // Advance past 10s TTL window
      currentNow += 6_000;
      const afterExpiry = pipeline.ingest({
        subscriptionId: 'sub_ttl',
        metricType: 'api',
        amount: 25,
        timestamp: currentNow,
        idempotencyKey: 'ttl_key',
      });
      expect(afterExpiry.status).toBe('accepted');
      expect(
        pipeline.queryRollup(
          'sub_ttl',
          'api',
          AggregationWindow.HOURLY,
          AggregationFunction.SUM,
          currentNow
        )
      ).toBe(50);
    });

    it('evicts the least-recently-used key when maxDedupEntries cap is reached', () => {
      const pipeline = new UsageMeteringPipeline({
        flushIntervalMs: 0,
        maxDedupEntries: 3,
        now: () => BASE_NOW,
      });

      pipeline.ingest({
        subscriptionId: 'sub_lru',
        metricType: 'api',
        amount: 1,
        timestamp: BASE_NOW,
        idempotencyKey: 'key_1',
      });
      pipeline.ingest({
        subscriptionId: 'sub_lru',
        metricType: 'api',
        amount: 1,
        timestamp: BASE_NOW,
        idempotencyKey: 'key_2',
      });
      pipeline.ingest({
        subscriptionId: 'sub_lru',
        metricType: 'api',
        amount: 1,
        timestamp: BASE_NOW,
        idempotencyKey: 'key_3',
      });

      // Touch key_1 so it becomes most-recently-used; key_2 is now oldest
      expect(
        pipeline.ingest({
          subscriptionId: 'sub_lru',
          metricType: 'api',
          amount: 1,
          timestamp: BASE_NOW,
          idempotencyKey: 'key_1',
        }).status
      ).toBe('duplicate');

      // Inserting key_4 evicts key_2
      pipeline.ingest({
        subscriptionId: 'sub_lru',
        metricType: 'api',
        amount: 1,
        timestamp: BASE_NOW,
        idempotencyKey: 'key_4',
      });
      expect(pipeline.getMetrics().dedupCacheSize).toBe(3);

      // key_1 is still remembered as duplicate
      expect(
        pipeline.ingest({
          subscriptionId: 'sub_lru',
          metricType: 'api',
          amount: 1,
          timestamp: BASE_NOW,
          idempotencyKey: 'key_1',
        }).status
      ).toBe('duplicate');

      // key_2 was evicted and can be ingested fresh
      expect(
        pipeline.ingest({
          subscriptionId: 'sub_lru',
          metricType: 'api',
          amount: 1,
          timestamp: BASE_NOW,
          idempotencyKey: 'key_2',
        }).status
      ).toBe('accepted');
    });
  });

  describe('Event-Time Watermarks, Clock Skew & Out-of-Order / Late-Arriving Events', () => {
    it('progresses watermarks monotonically and classifies on-time, out-of-order, late_accepted, and dropped_late events', () => {
      const pipeline = new UsageMeteringPipeline({
        flushIntervalMs: 0,
        maxOutOfOrdernessMs: 30_000, // 30s
        allowedLatenessMs: 120_000, // 2m behind watermark
        bucketGranularityMs: 60_000, // 1m buckets
        lateEventPolicy: 'drop_dlq',
        now: () => BASE_NOW,
      });

      expect(pipeline.getWatermark('sub_wm', 'api')).toBeNull();

      // 1. Initial event at BASE_NOW -> watermark = BASE_NOW - 30s
      const e1 = pipeline.ingest({
        subscriptionId: 'sub_wm',
        metricType: 'api',
        amount: 10,
        timestamp: BASE_NOW,
        idempotencyKey: 'wm_1',
      });
      expect(e1.status).toBe('accepted');
      expect(e1.lateEvent).toBe(false);
      expect(pipeline.getWatermark('sub_wm', 'api')).toBe(BASE_NOW - 30_000);

      // 2. Out-of-order event 20s behind BASE_NOW (within 30s maxOutOfOrdernessMs -> on-time!)
      const e2 = pipeline.ingest({
        subscriptionId: 'sub_wm',
        metricType: 'api',
        amount: 15,
        timestamp: BASE_NOW - 20_000,
        idempotencyKey: 'wm_2',
      });
      expect(e2.status).toBe('accepted');
      expect(e2.lateEvent).toBe(false);
      // Watermark does not regress
      expect(pipeline.getWatermark('sub_wm', 'api')).toBe(BASE_NOW - 30_000);

      // 3. Late event 90s behind BASE_NOW (60s behind watermark, within 120s allowedLatenessMs)
      const e3 = pipeline.ingest({
        subscriptionId: 'sub_wm',
        metricType: 'api',
        amount: 25,
        timestamp: BASE_NOW - 90_000,
        idempotencyKey: 'wm_3',
      });
      expect(e3.status).toBe('late_accepted');
      expect(e3.lateEvent).toBe(true);
      expect(pipeline.getMetrics().lateAcceptedCount).toBe(1);

      // Verify historical bucket received the late event and incremented lateEventCount
      const buckets = pipeline.getRollupBuckets('sub_wm', 'api');
      const historicalBucket = buckets.find((b) => b.bucketStartMs === e3.bucketStartMs);
      expect(historicalBucket).toBeDefined();
      expect(historicalBucket?.lateEventCount).toBe(1);
      expect(historicalBucket?.sum).toBe(25);

      // 4. Too-late event 200s behind BASE_NOW (170s behind watermark > 120s allowedLatenessMs) -> DLQ
      const e4 = pipeline.ingest({
        subscriptionId: 'sub_wm',
        metricType: 'api',
        amount: 99,
        timestamp: BASE_NOW - 200_000,
        idempotencyKey: 'wm_4',
      });
      expect(e4.status).toBe('dropped_late');
      expect(e4.lateEvent).toBe(true);
      expect(pipeline.getMetrics().droppedLateCount).toBe(1);
      expect(pipeline.getDeadLetterQueue()).toHaveLength(1);
      expect(pipeline.getDeadLetterQueue('sub_wm', 'api')).toHaveLength(1);
      expect(pipeline.getDeadLetterQueue('other_sub')).toHaveLength(0);
      expect(pipeline.getDeadLetterQueue('sub_wm', 'other_metric')).toHaveLength(0);
    });

    it('routes too-late events to next-period lateAdjustments ledger when lateEventPolicy is route_adjustment', () => {
      const pipeline = new UsageMeteringPipeline({
        flushIntervalMs: 0,
        maxOutOfOrdernessMs: 10_000,
        allowedLatenessMs: 60_000,
        lateEventPolicy: 'route_adjustment',
        now: () => BASE_NOW,
      });

      pipeline.ingest({
        subscriptionId: 'sub_adj',
        metricType: 'api_calls',
        amount: 100,
        timestamp: BASE_NOW,
        idempotencyKey: 'adj_1',
      });

      // Event 120s behind BASE_NOW exceeds (watermark - allowedLatenessMs = BASE_NOW - 70s)
      const lateRes = pipeline.ingest({
        subscriptionId: 'sub_adj',
        metricType: 'api_calls',
        amount: 45,
        timestamp: BASE_NOW - 120_000,
        idempotencyKey: 'adj_2',
      });

      expect(lateRes.status).toBe('late_accepted');
      expect(lateRes.reason).toMatch(/late adjustment ledger/);
      expect(pipeline.getLateAdjustments('sub_adj', 'api_calls')).toHaveLength(1);
      expect(pipeline.getLateAdjustments('other')).toHaveLength(0);
      expect(pipeline.getLateAdjustments('sub_adj', 'other_metric')).toHaveLength(0);
      expect(pipeline.getMetrics().lateAdjustmentsCount).toBe(1);
    });

    it('detects future clock skew (>5m ahead) and clamps timestamp so watermark is not corrupted', () => {
      const pipeline = new UsageMeteringPipeline({
        flushIntervalMs: 0,
        maxClockSkewMs: 300_000, // 5m
        maxOutOfOrdernessMs: 30_000,
        now: () => BASE_NOW,
      });

      // Rogue client sends timestamp 15 minutes in the future
      const skewed = pipeline.ingest({
        subscriptionId: 'sub_skew',
        metricType: 'api',
        amount: 10,
        timestamp: BASE_NOW + 15 * 60_000,
        idempotencyKey: 'skew_future',
      });

      expect(skewed.status).toBe('accepted');
      expect(skewed.clockSkewDetected).toBe(true);
      expect(pipeline.getMetrics().clockSkewCount).toBe(1);
      // Watermark was clamped to BASE_NOW - 30_000 rather than advancing 15m into the future
      expect(pipeline.getWatermark('sub_skew', 'api')).toBe(BASE_NOW - 30_000);

      // Subsequent normal event at BASE_NOW is accepted on-time
      const normal = pipeline.ingest({
        subscriptionId: 'sub_skew',
        metricType: 'api',
        amount: 20,
        timestamp: BASE_NOW,
        idempotencyKey: 'skew_normal',
      });
      expect(normal.status).toBe('accepted');
      expect(normal.lateEvent).toBe(false);
    });
  });

  describe('Tumbling & Sliding Time-Window Rollups', () => {
    it('computes accurate SUM, MAX, AVERAGE, PERCENTILE_95, and PERCENTILE_99 across windows and custom ranges', () => {
      const pipeline = new UsageMeteringPipeline({
        flushIntervalMs: 0,
        bucketGranularityMs: 60_000,
        now: () => BASE_NOW,
      });

      const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      samples.forEach((amount, idx) => {
        pipeline.enqueue({
          subscriptionId: 'sub_rollup',
          metricType: 'api',
          amount,
          timestamp: BASE_NOW - (samples.length - idx) * 15_000,
          idempotencyKey: `sample_${idx}`,
        });
      });

      // Note: queryRollup automatically flushes pendingBuffer before reading
      expect(
        pipeline.queryRollup(
          'sub_rollup',
          'api',
          AggregationWindow.HOURLY,
          AggregationFunction.SUM,
          BASE_NOW
        )
      ).toBe(550);
      expect(
        pipeline.queryRollup(
          'sub_rollup',
          'api',
          AggregationWindow.DAILY,
          AggregationFunction.MAX,
          BASE_NOW
        )
      ).toBe(100);
      expect(
        pipeline.queryRollup(
          'sub_rollup',
          'api',
          AggregationWindow.MONTHLY,
          AggregationFunction.AVERAGE,
          BASE_NOW
        )
      ).toBe(55);

      const p95 = pipeline.queryRollup(
        'sub_rollup',
        'api',
        AggregationWindow.HOURLY,
        AggregationFunction.PERCENTILE_95,
        BASE_NOW
      );
      const p99 = pipeline.queryRollup(
        'sub_rollup',
        'api',
        AggregationWindow.HOURLY,
        AggregationFunction.PERCENTILE_99,
        BASE_NOW
      );
      expect(p95).toBeCloseTo(95.5, 1);
      expect(p99).toBeCloseTo(99.1, 1);

      // Partial bucket sub-range query (sliding window cutting inside a bucket)
      const subRangeSum = pipeline.queryRollup(
        'sub_rollup',
        'api',
        { start: BASE_NOW - 50_000, end: BASE_NOW - 10_000 },
        AggregationFunction.SUM
      );
      // Events at -45s (80), -30s (90), -15s (100)
      expect(subRangeSum).toBe(270);

      // Partial bucket sub-range with PERCENTILE_95 and MAX
      const subRangeP95 = pipeline.queryRollup(
        'sub_rollup',
        'api',
        { start: BASE_NOW - 50_000, end: BASE_NOW - 10_000 },
        AggregationFunction.PERCENTILE_95
      );
      expect(subRangeP95).toBeGreaterThanOrEqual(80);

      // Range with no matching events in existing buckets returns 0
      expect(
        pipeline.queryRollup(
          'sub_rollup',
          'api',
          { start: BASE_NOW - 900_000, end: BASE_NOW - 800_000 },
          AggregationFunction.SUM
        )
      ).toBe(0);

      // getRollupBuckets with pending unflushed event and explicit range
      pipeline.enqueue({
        subscriptionId: 'sub_rollup',
        metricType: 'api',
        amount: 10,
        timestamp: BASE_NOW,
      });
      const rangedBuckets = pipeline.getRollupBuckets('sub_rollup', 'api', {
        start: BASE_NOW - 120_000,
        end: BASE_NOW,
      });
      expect(rangedBuckets.length).toBeGreaterThan(0);

      // Edge cases: unknown stream or inverted range returns 0
      expect(pipeline.queryRollup('unknown_sub', 'api')).toBe(0);
      expect(
        pipeline.queryRollup('sub_rollup', 'api', {
          start: BASE_NOW,
          end: BASE_NOW - 10_000,
        })
      ).toBe(0);
      expect(pipeline.getRollupBuckets('unknown_sub', 'api')).toEqual([]);
    });

    it('trims oldest tumbling buckets when maxBucketsPerStream is exceeded', () => {
      const pipeline = new UsageMeteringPipeline({
        flushIntervalMs: 0,
        bucketGranularityMs: 60_000,
        maxBucketsPerStream: 3,
        now: () => BASE_NOW,
      });

      for (let i = 0; i < 5; i += 1) {
        pipeline.ingest({
          subscriptionId: 'sub_trim',
          metricType: 'api',
          amount: (i + 1) * 10,
          timestamp: BASE_NOW - (5 - i) * 60_000,
          idempotencyKey: `b_${i}`,
        });
      }

      const buckets = pipeline.getRollupBuckets('sub_trim', 'api');
      expect(buckets).toHaveLength(3);
      expect(buckets.map((b) => b.sum)).toEqual([30, 40, 50]);
    });
  });

  describe('Real-Time Quota Threshold Alerts & Listeners', () => {
    it('fires soft (80%) and hard (100%) alerts once per period, notifies listeners, and re-arms on reset or limit increase', () => {
      const pipeline = new UsageMeteringPipeline({
        flushIntervalMs: 0,
        now: () => BASE_NOW,
      });

      pipeline.setQuotaLimit('sub_quota', 'api', 100);
      expect(pipeline.getQuotaLimit('sub_quota', 'api')).toBe(100);

      const receivedAlerts: {
        alert: UsageThresholdAlert;
        record: PipelineThresholdAlertRecord;
      }[] = [];

      const unsubscribe = pipeline.onThresholdAlert((alert, record) => {
        receivedAlerts.push({ alert, record });
      });

      // Also register a faulty listener to ensure exceptions do not break flush
      pipeline.onThresholdAlert(() => {
        throw new Error('Listener failure simulation');
      });

      // 1. 50% usage -> no alert
      pipeline.ingest({
        subscriptionId: 'sub_quota',
        metricType: 'api',
        amount: 50,
        timestamp: BASE_NOW,
      });
      expect(receivedAlerts).toHaveLength(0);
      expect(pipeline.checkThresholds('sub_quota')).toBeNull();

      // 2. +35 = 85% usage -> SOFT alert fires
      pipeline.ingest({
        subscriptionId: 'sub_quota',
        metricType: 'api',
        amount: 35,
        timestamp: BASE_NOW,
      });
      expect(receivedAlerts).toHaveLength(1);
      expect(receivedAlerts[0].alert.level).toBe(UsageAlertLevel.SOFT);

      // Additional event at 90% does NOT re-fire duplicate SOFT alert
      pipeline.ingest({
        subscriptionId: 'sub_quota',
        metricType: 'api',
        amount: 5,
        timestamp: BASE_NOW,
      });
      expect(receivedAlerts).toHaveLength(1);

      // 3. +15 = 105% usage -> HARD alert fires
      pipeline.ingest({
        subscriptionId: 'sub_quota',
        metricType: 'api',
        amount: 15,
        timestamp: BASE_NOW,
      });
      expect(receivedAlerts).toHaveLength(2);
      expect(receivedAlerts[1].alert.level).toBe(UsageAlertLevel.HARD);

      // Acknowledge first alert
      const activeBefore = pipeline.getAlerts('sub_quota');
      expect(activeBefore).toHaveLength(2);
      expect(pipeline.acknowledgeAlert(activeBefore[0].id)).toBe(true);
      expect(pipeline.acknowledgeAlert('non_existent_id')).toBe(false);
      expect(pipeline.getAlerts('sub_quota', false)).toHaveLength(1);
      expect(pipeline.getAlerts('sub_quota', true)).toHaveLength(2);

      // Raise quota limit to 200 -> usage is 105/200 (52.5%), re-arming both SOFT and HARD
      pipeline.setQuotaLimit('sub_quota', 'api', 200);
      pipeline.enqueue({
        subscriptionId: 'sub_quota',
        metricType: 'api',
        amount: 60, // 165 / 200 = 82.5% -> SOFT fires again
        timestamp: BASE_NOW,
      });
      // Calling checkThresholds while event is in pendingBuffer flushes and returns the alert
      const directCheck = pipeline.checkThresholds('sub_quota', 'api');
      expect(directCheck?.level).toBe(UsageAlertLevel.SOFT);
      expect(pipeline.checkThresholds('sub_quota')?.level).toBe(UsageAlertLevel.SOFT);
      expect(receivedAlerts).toHaveLength(3);
      expect(receivedAlerts[2].alert.level).toBe(UsageAlertLevel.SOFT);

      // Unsubscribe listener and reset stream period
      unsubscribe();
      pipeline.resetStreamPeriod('sub_quota', 'api');
      expect(pipeline.queryRollup('sub_quota', 'api')).toBe(0);
    });
  });

  describe('Backpressure Policies (flush_sync vs. reject)', () => {
    it('rejects events with backpressure_rejected when maxQueueDepth is reached under reject policy', () => {
      const pipeline = new UsageMeteringPipeline({
        maxBatchSize: 10,
        maxQueueDepth: 3,
        flushIntervalMs: 0,
        backpressurePolicy: 'reject',
        now: () => BASE_NOW,
      });

      expect(
        pipeline.enqueue({
          subscriptionId: 'sub_bp',
          metricType: 'api',
          amount: 1,
          timestamp: BASE_NOW,
        }).status
      ).toBe('accepted');
      expect(
        pipeline.enqueue({
          subscriptionId: 'sub_bp',
          metricType: 'api',
          amount: 1,
          timestamp: BASE_NOW,
        }).status
      ).toBe('accepted');
      expect(
        pipeline.enqueue({
          subscriptionId: 'sub_bp',
          metricType: 'api',
          amount: 1,
          timestamp: BASE_NOW,
        }).status
      ).toBe('accepted');

      // 4th event exceeds maxQueueDepth (3)
      const rejected = pipeline.enqueue({
        subscriptionId: 'sub_bp',
        metricType: 'api',
        amount: 1,
        timestamp: BASE_NOW,
      });
      expect(rejected.status).toBe('backpressure_rejected');
      expect(pipeline.getMetrics().backpressureRejectedCount).toBe(1);
    });

    it('synchronously drains queue and admits new events under flush_sync policy', () => {
      const pipeline = new UsageMeteringPipeline({
        maxBatchSize: 10,
        maxQueueDepth: 2,
        flushIntervalMs: 0,
        backpressurePolicy: 'flush_sync',
        now: () => BASE_NOW,
      });

      pipeline.enqueue({
        subscriptionId: 'sub_sync',
        metricType: 'api',
        amount: 10,
        timestamp: BASE_NOW,
      });
      pipeline.enqueue({
        subscriptionId: 'sub_sync',
        metricType: 'api',
        amount: 20,
        timestamp: BASE_NOW,
      });
      // Queue reached maxQueueDepth (2) and auto-flushed synchronously
      expect(pipeline.getMetrics().pendingQueueDepth).toBe(0);
      expect(pipeline.getMetrics().flushedEventCount).toBe(2);
    });
  });

  describe('Billing Period Settlement (settlePeriod) & Pricing Models Integration', () => {
    it('settles a billing period across flat, graduated, volume, and package plans including late adjustments', () => {
      const periodStart = new Date('2026-03-01T00:00:00.000Z');
      const periodEnd = new Date('2026-03-31T23:59:59.000Z');
      const eventTime = new Date('2026-03-15T10:00:00.000Z').getTime();

      const pipeline = new UsageMeteringPipeline({
        flushIntervalMs: 0,
        maxOutOfOrdernessMs: 10_000,
        allowedLatenessMs: 30_000,
        lateEventPolicy: 'route_adjustment',
        now: () => eventTime,
      });

      // Ingest events for 4 distinct meters
      pipeline.enqueueBatch([
        {
          subscriptionId: 'sub_settle',
          metricType: 'api_calls',
          amount: 1_500,
          timestamp: eventTime,
        },
        {
          subscriptionId: 'sub_settle',
          metricType: 'gb_egress',
          amount: 20,
          timestamp: eventTime,
        },
        {
          subscriptionId: 'sub_settle',
          metricType: 'compute_seconds',
          amount: 500,
          timestamp: eventTime,
        },
        {
          subscriptionId: 'sub_settle',
          metricType: 'sms_blocks',
          amount: 1_200,
          timestamp: eventTime,
        },
        // Too-late event routed to lateAdjustments (+100 api_calls)
        {
          subscriptionId: 'sub_settle',
          metricType: 'api_calls',
          amount: 100,
          timestamp: eventTime - 120_000,
        },
      ]);

      const plans: MeterPricingPlan[] = [
        {
          metric: 'api_calls',
          model: 'graduated',
          includedUnits: 100,
          unitPrice: 1,
          tiers: [
            { upToUnits: 1_000, unitPrice: 3 },
            { upToUnits: null, unitPrice: 1 },
          ],
        },
        {
          metric: 'gb_egress',
          model: 'flat',
          includedUnits: 0,
          unitPrice: 5,
        },
        {
          metric: 'compute_seconds',
          model: 'volume',
          includedUnits: 0,
          unitPrice: 0,
          tiers: [
            { upToUnits: 100, unitPrice: 10 },
            { upToUnits: 1_000, unitPrice: 4 },
            { upToUnits: null, unitPrice: 2 },
          ],
        },
        {
          metric: 'sms_blocks',
          model: 'package',
          includedUnits: 0,
          unitPrice: 0,
          tiers: [{ upToUnits: 1_000, unitPrice: 0, flatFee: 25 }],
        },
      ];

      const settlement = pipeline.settlePeriod({
        subscriptionId: 'sub_settle',
        period: { start: periodStart, end: periodEnd },
        plans,
        currency: 'USDC',
        resetAfterSettlement: true,
      });

      // api_calls: 1500 + 100 late = 1600 used - 100 included = 1500 billable -> 1000*3 + 500*1 = 3500
      // gb_egress: 20 * 5 = 100
      // compute_seconds: 500 @ volume tier 4 = 2000
      // sms_blocks: 1200 in blocks of 1000 @ 25 = 2 blocks = 50
      expect(settlement.usageByMetric.api_calls).toBe(1_600);
      expect(settlement.lateAdjustmentsApplied.api_calls).toBe(100);
      expect(settlement.bill.currency).toBe('USDC');
      expect(settlement.bill.total).toBe(3_500 + 100 + 2_000 + 50);

      // Verify resetAfterSettlement cleared stream buckets and late adjustments
      expect(pipeline.getLateAdjustments('sub_settle')).toHaveLength(0);
      expect(pipeline.getRollupBuckets('sub_settle', 'api_calls')).toHaveLength(0);

      // Verify full pipeline reset()
      pipeline.resetStreamPeriod('sub_settle');
      pipeline.reset();
      expect(pipeline.getMetrics().ingestedCount).toBe(0);
    });
  });

  describe('MeteringService Integration & Backward Compatibility', () => {
    it('supports full MeteringService lifecycle, pipeline delegation, analytics, trends, and billing', async () => {
      const customPipeline = new UsageMeteringPipeline({ flushIntervalMs: 0 });
      const service = new MeteringService(customPipeline);
      expect(service.getPipeline()).toBe(customPipeline);

      service.setLimit('user_1', 'api', 100);
      service.setLimit('user_1', 'storage', 500);

      const now = new Date();
      const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);

      // Seed prior-period history (45 days ago) first in chronological order so watermarks advance forward
      await service.recordUsage({
        userId: 'user_1',
        metricType: 'api',
        amount: 50,
        timestamp: fortyFiveDaysAgo,
        idempotencyKey: 'hist_api_prev',
      });
      await service.recordUsage({
        userId: 'user_1',
        metricType: 'storage',
        amount: 200,
        timestamp: fortyFiveDaysAgo,
        idempotencyKey: 'hist_storage_prev',
      });
      await service.recordUsage({
        userId: 'user_1',
        metricType: 'compute',
        amount: 40,
        timestamp: fortyFiveDaysAgo,
        idempotencyKey: 'hist_compute_prev',
      });

      // 1. recordUsage in current period (soft threshold at 85%, then duplicate, then invalid)
      const r1 = await service.recordUsage({
        userId: 'user_1',
        metricType: 'api',
        amount: 85,
        timestamp: now,
        idempotencyKey: 'ms_k1',
      });
      expect(r1.status).toBe('accepted');

      // Verify SOFT threshold alert before hitting 100%
      const softCheck = await service.checkThresholds('user_1');
      expect(softCheck?.level).toBe(UsageAlertLevel.SOFT);

      const dup = await service.recordUsage({
        userId: 'user_1',
        metricType: 'api',
        amount: 85,
        timestamp: now,
        idempotencyKey: 'ms_k1',
      });
      expect(dup.status).toBe('duplicate');

      // Invalid negative amount rejected
      const invalid = await service.recordUsage({
        userId: 'user_1',
        metricType: 'api',
        amount: -10,
        timestamp: now,
        idempotencyKey: 'ms_neg',
      });
      expect(invalid.status).toBe('rejected');

      // Too-late event behind current watermark returns dropped_late
      const droppedLate = await service.recordUsage({
        userId: 'user_1',
        metricType: 'api',
        amount: 10,
        timestamp: fortyFiveDaysAgo,
        idempotencyKey: 'ms_too_late',
      });
      expect(droppedLate.status).toBe('dropped_late');

      // Oversized batch throws
      const oversized = Array.from({ length: 501 }, (_, i) => ({
        userId: 'user_1',
        metricType: 'api',
        amount: 1,
        timestamp: now,
        idempotencyKey: `over_${i}`,
      }));
      await expect(service.recordUsageBatch(oversized)).rejects.toThrow(/exceeds maximum/);

      // 2. Pipeline delegation methods on MeteringService (Date, number, and ISO string timestamps)
      const enqRes = service.enqueueUsageBatch([
        {
          subscriptionId: 'user_1',
          metricType: 'api',
          amount: 20,
          timestamp: now,
          idempotencyKey: 'ms_enq_1',
        },
        {
          subscriptionId: 'user_1',
          metricType: 'compute',
          amount: 40,
          timestamp: now.toISOString(),
          idempotencyKey: 'ms_enq_2',
        },
        {
          subscriptionId: 'user_1',
          metricType: 'storage',
          amount: 50,
          timestamp: now.getTime(),
          idempotencyKey: 'ms_enq_3',
        },
      ]);
      expect(enqRes).toHaveLength(3);
      expect(service.flushPipeline()).toBe(3);
      expect(service.queryRollup('user_1', 'api', AggregationWindow.HOURLY)).toBe(105);
      expect(service.getRollupBuckets('user_1', 'api').length).toBeGreaterThan(0);
      expect(service.getPipelineMetrics().acceptedCount).toBeGreaterThanOrEqual(6);

      // 3. Aggregations, thresholds, overage, and blocking
      expect(
        service.aggregate('user_1', 'api', AggregationWindow.DAILY, AggregationFunction.SUM)
      ).toBe(105);
      expect(
        service.aggregate('user_1', 'api', AggregationWindow.DAILY, AggregationFunction.MAX)
      ).toBe(85);
      expect(
        service.aggregate('user_1', 'api', AggregationWindow.DAILY, AggregationFunction.AVERAGE)
      ).toBe(52.5);
      expect(
        service.aggregate(
          'user_1',
          'api',
          AggregationWindow.DAILY,
          AggregationFunction.PERCENTILE_95
        )
      ).toBeGreaterThan(20);
      expect(
        service.aggregate(
          'user_1',
          'api',
          AggregationWindow.DAILY,
          AggregationFunction.PERCENTILE_99
        )
      ).toBeGreaterThan(20);
      expect(service.aggregate('unknown', 'api', AggregationWindow.DAILY)).toBe(0);

      expect(await service.calculateOverage('user_1')).toBe(5);
      expect(await service.calculateOverage('unknown_user')).toBe(0);
      expect(await service.isBlocked('user_1', 'api')).toBe(true);

      // Record an event without idempotencyKey to exercise auto-sequence key generation
      const autoKeyRes = await service.recordUsage({
        userId: 'user_2',
        metricType: 'api',
        amount: 10,
        timestamp: now,
      });
      expect(autoKeyRes.status).toBe('accepted');
      expect(autoKeyRes.idempotencyKey).toMatch(/^auto-user_2::api-/);

      // 4. Alerts, trends (increasing, decreasing, stable), analytics, and billing
      const activeAlerts = service.getActiveAlerts('user_1');
      expect(activeAlerts.length).toBeGreaterThan(0);
      expect(service.getActiveAlerts().length).toBeGreaterThan(0);
      service.acknowledgeAlert(activeAlerts[0].id);

      const trends = service.getUsageTrends('user_1');
      expect(trends.find((t) => t.metric === 'api')?.trend).toBe('increasing');
      expect(trends.find((t) => t.metric === 'storage')?.trend).toBe('decreasing');
      expect(trends.find((t) => t.metric === 'compute')?.trend).toBe('stable');

      const analyticsForSub = service.getAnalytics('user_1');
      expect(analyticsForSub.totalUsage).toBeGreaterThan(0);
      const analyticsAll = service.getAnalytics();
      expect(analyticsAll.totalUsage).toBeGreaterThan(0);

      expect(service.getUsageByMetric('user_1').api).toBe(155);
      expect(
        service.getUsageByMetric(
          'user_1',
          new Date(fortyFiveDaysAgo.getTime() - 1_000),
          new Date(fortyFiveDaysAgo.getTime() + 1_000)
        ).api
      ).toBe(50);
      expect(service.getUsageHistory('user_1', 'api').length).toBeGreaterThan(0);
      expect(service.getUsageHistory().length).toBeGreaterThan(0);

      const billing = service.calculateUsageBilling('user_1', 0.05, 'USD');
      expect(billing.meteredAmount).toBe(195);
      expect(billing.totalAmount).toBeCloseTo(195 * 0.05, 5);
      expect(service.calculateUsageBilling('user_1', Number.NaN, 'USD').totalAmount).toBe(0);

      const settled = service.settlePeriod({
        subscriptionId: 'user_1',
        period: {
          start: new Date(now.getTime() - 3600_000),
          end: new Date(now.getTime() + 3600_000),
        },
        plans: [{ metric: 'api', model: 'flat', includedUnits: 0, unitPrice: 2 }],
      });
      expect(settled.bill.total).toBe(210);

      service.resetPeriod('user_1', 'api');
      expect(service.getCurrentPeriodConsumption('user_1', 'api')).toBe(0);
    });
  });

  describe('POST /v1/usage HTTP Ingestion Endpoint (handleUsageIngestion)', () => {
    it('rejects malformed body with 422 and oversized batch with 413', async () => {
      const service = new MeteringService();

      const badReq = {
        headers: { 'x-request-id': 'req_422' },
        body: { invalid: true },
      } as unknown as Request;
      const badRes = createMockResponse();
      await handleUsageIngestion(badReq, badRes as unknown as Response, service);
      expect(badRes.statusCode).toBe(422);

      const hugeEvents = Array.from({ length: 501 }, (_, i) => ({
        userId: 'u1',
        metricType: 'api',
        amount: 1,
        timestamp: new Date().toISOString(),
        idempotencyKey: `huge_${i}`,
      }));
      const hugeReq = {
        headers: { 'x-request-id': 'req_413' },
        body: { events: hugeEvents },
      } as unknown as Request;
      const hugeRes = createMockResponse();
      await handleUsageIngestion(hugeReq, hugeRes as unknown as Response, service);
      expect(hugeRes.statusCode).toBe(413);
    });

    it('ingests single and batch events, reports duplicates and field rejections with 202 Accepted', async () => {
      const service = new MeteringService();
      const nowIso = new Date().toISOString();

      // Single event using subscriptionId field
      const singleReq = {
        headers: { 'x-request-id': 'req_single' },
        body: {
          subscriptionId: 'sub_http_1',
          metricType: 'api',
          amount: 10,
          timestamp: nowIso,
          idempotencyKey: 'http_k1',
        },
      } as unknown as Request;
      const singleRes = createMockResponse();
      await handleUsageIngestion(singleReq, singleRes as unknown as Response, service);
      expect(singleRes.statusCode).toBe(202);
      expect(singleRes.headers['X-Metering-Queue-Depth']).toBeDefined();

      // Batch with valid, duplicate, and invalid events
      const batchReq = {
        headers: {},
        body: {
          events: [
            {
              userId: 'sub_http_1',
              metricType: 'api',
              amount: 10,
              timestamp: nowIso,
              idempotencyKey: 'http_k1', // duplicate
            },
            {
              userId: 'sub_http_1',
              metricType: 'api',
              amount: 25,
              timestamp: nowIso,
              idempotencyKey: 'http_k2', // fresh
            },
            {
              userId: '',
              metricType: 'api',
              amount: 5,
              timestamp: nowIso,
              idempotencyKey: 'http_bad_user',
            },
            {
              userId: 'sub_http_1',
              metricType: '',
              amount: 5,
              timestamp: nowIso,
              idempotencyKey: 'http_bad_metric',
            },
            {
              userId: 'sub_http_1',
              metricType: 'api',
              amount: 5,
              timestamp: nowIso,
              idempotencyKey: '',
            },
            {
              userId: 'sub_http_1',
              metricType: 'api',
              amount: -5,
              timestamp: nowIso,
              idempotencyKey: 'http_bad_amount',
            },
            {
              userId: 'sub_http_1',
              metricType: 'api',
              amount: 5,
              timestamp: 'bad-date',
              idempotencyKey: 'http_bad_ts',
            },
          ],
        },
      } as unknown as Request;
      const batchRes = createMockResponse();
      await handleUsageIngestion(batchReq, batchRes as unknown as Response, service);
      expect(batchRes.statusCode).toBe(202);

      const envelope = batchRes.body as {
        data: { accepted: number; duplicate: number; rejected: number };
      };
      expect(envelope.data.accepted).toBe(1);
      expect(envelope.data.duplicate).toBe(1);
      expect(envelope.data.rejected).toBe(5);
    });

    it('supports direct UsageMeteringPipeline injection and returns 429 on backpressure saturation', async () => {
      const pipeline = new UsageMeteringPipeline({
        maxBatchSize: 10,
        maxQueueDepth: 1,
        flushIntervalMs: 0,
        backpressurePolicy: 'reject',
      });
      const nowIso = new Date().toISOString();

      // First request fills queue depth (1)
      const req1 = {
        headers: {},
        body: {
          subscriptionId: 'sub_bp_http',
          metricType: 'api',
          amount: 10,
          timestamp: nowIso,
          idempotencyKey: 'bp_http_1',
        },
      } as unknown as Request;
      const res1 = createMockResponse();
      await handleUsageIngestion(req1, res1 as unknown as Response, pipeline);
      expect(res1.statusCode).toBe(202);

      // Second request hits backpressure rejection -> 429 Too Many Requests
      const req2 = {
        headers: {},
        body: {
          subscriptionId: 'sub_bp_http',
          metricType: 'api',
          amount: 10,
          timestamp: nowIso,
          idempotencyKey: 'bp_http_2',
        },
      } as unknown as Request;
      const res2 = createMockResponse();
      await handleUsageIngestion(req2, res2 as unknown as Response, pipeline);
      expect(res2.statusCode).toBe(429);
      expect(res2.headers['Retry-After']).toBe('1');
    });
  });
});
