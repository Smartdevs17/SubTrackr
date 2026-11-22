# High-Throughput Usage Event Metering Pipeline

## Overview

SubTrackr's Usage Event Metering Pipeline provides sub-second stream processing for usage-based billing across three architectural layers:

1. **Client-Side SDK (`src/services/usageMeteringClient.ts`)** — Sub-second micro-batching buffer with deterministic FNV-1a idempotency key generation, configurable batch chunking (`maxBatchSize = 500`), exponential backoff retries, dead-letter callback, and optimistic Zustand `meteringSlice` store synchronization.
2. **Backend Stream Processing Engine (`backend/services/billing/usageMeteringPipeline.ts`)** — High-throughput ingestion pipeline featuring $O(1)$ TTL-bounded + LRU idempotency deduplication, per-stream event-time watermarks, clock-skew clamping, out-of-order and late-arriving event routing, pre-aggregated tumbling & sliding window rollups (`SUM`, `MAX`, `AVERAGE`, `PERCENTILE_95`, `PERCENTILE_99`), backpressure controls, real-time soft/hard quota alerting, and deterministic period settlement via `rateUsage()`.
3. **On-Chain Soroban Quota & Usage Enforcement (`contracts/subscription/src/usage.rs`)** — Persistent on-chain usage accumulation (`StorageKey::SubscriptionUsage`), automatic billing period rollover evaluation (`NoRollover`, `RolloverAll`, `RolloverCap(cap)`), saturating arithmetic, and quota status checks (`WithinLimit`, `SoftLimitReached` at 80%, `HardLimitReached` at 100%).

---

## Architecture & Dataflow

```text
+-------------------------------------------------------------------------+
| Client SDK (UsageMeteringClient)                                        |
|  track(event) -> FNV-1a idempotencyKey -> 100ms Buffer / 500 Batch      |
|  + Optimistic sync to Zustand meteringSlice                             |
+------------------------------------+------------------------------------+
                                     | POST /v1/usage (Exponential Backoff)
                                     v
+-------------------------------------------------------------------------+
| Backend Ingestion Gateway (handleUsageIngestion)                        |
|  Schema validation (422) | Batch cap 500 (413) | Backpressure (429)     |
+------------------------------------+------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
| UsageMeteringPipeline                                                   |
|  1. O(1) TTL + LRU Deduplication Cache (24h window, 100k max entries)   |
|  2. Clock-Skew Detection & Future Timestamp Clamping (5m threshold)     |
|  3. Per-Stream Event-Time Watermark Progression                         |
|     - On-Time: eventTime >= watermark                                   |
|     - Late Within Window: watermark - allowedLateness <= eventTime      |
|     - Too Late: drop_dlq (Dead-Letter Queue) | route_adjustment         |
|  4. Sub-Second Micro-Batch Buffer (100ms flush / 500 maxBatchSize)      |
|  5. Tumbling Time-Bucket Rollups + Quota Threshold Alerts (80% / 100%)  |
+------------------------------------+------------------------------------+
                                     |
                  +------------------+------------------+
                  |                                     |
                  v                                     v
+-----------------------------------+ +-----------------------------------+
| Off-Chain Period Settlement       | | Soroban Subscription Contract     |
|  settlePeriod() -> rateUsage()    | |  record_usage / get_usage_record  |
|  (flat, graduated, volume, pkg)   | |  check_quota (RolloverPolicy)     |
+-----------------------------------+ +-----------------------------------+
```

---

## Watermark, Clock Skew & Lateness Formulas

For each independent stream `streamKey = "${subscriptionId}::${metricType}"`:

1. **Clock-Skew Clamping:**
   $$\text{clockSkewDetected} = |\text{serverNow} - \text{rawEventTime}| > \text{maxClockSkewMs}$$
   $$\text{eventTime} = \min(\text{rawEventTime}, \text{serverNow})$$
   Clamping future client timestamps to `serverNow` prevents a skewed client clock from advancing the stream watermark into the future and falsely marking subsequent valid events as late.

2. **Event-Time Watermark Progression:**
   $$\text{maxObservedEventTime}_t = \max(\text{maxObservedEventTime}_{t-1}, \text{eventTime})$$
   $$\text{watermark}_t = \text{maxObservedEventTime}_t - \text{maxOutOfOrdernessMs}$$

3. **Lateness Disposition Rules:**
   - **On-Time (`accepted`):** $\text{eventTime} \ge \text{watermark}_t$
   - **Out-of-Order / Late Within Window (`late_accepted`):** $\text{watermark}_t - \text{allowedLatenessMs} \le \text{eventTime} < \text{watermark}_t$
     - Routed into historical tumbling bucket $\lfloor \text{eventTime} / \text{bucketGranularityMs} \rfloor \times \text{bucketGranularityMs}$ and updates rollup accumulators in place.
   - **Too Late (`dropped_late` or `late_accepted` via adjustment):** $\text{eventTime} < \text{watermark}_t - \text{allowedLatenessMs}$
     - Under `lateEventPolicy: 'drop_dlq'` (default): appended to the inspectable Dead-Letter Queue (`getDeadLetterQueue()`).
     - Under `lateEventPolicy: 'route_adjustment'`: recorded in `getLateAdjustments()` and automatically reconciled during the next `settlePeriod()` invocation.

---

## Backend Pipeline API (`backend/services/billing/usageMeteringPipeline.ts`)

### Quick Start

```typescript
import {
  createUsageMeteringPipeline,
  AggregationFunction,
  AggregationWindow,
} from '../backend/services/billing';

const pipeline = createUsageMeteringPipeline({
  maxBatchSize: 500,
  flushIntervalMs: 100,
  maxOutOfOrdernessMs: 30_000,
  allowedLatenessMs: 300_000,
  lateEventPolicy: 'drop_dlq',
  backpressurePolicy: 'flush_sync',
});

// Configure soft (80%) and hard (100%) quota alerting
pipeline.setQuotaLimit('sub_101', 'api', 10_000);
pipeline.onThresholdAlert((alert, record) => {
  console.warn(`[${alert.level}] ${record.message}`);
});

// Enqueue events into sub-second micro-batch buffer
pipeline.enqueueBatch([
  {
    subscriptionId: 'sub_101',
    metricType: 'api',
    amount: 250,
    timestamp: new Date(),
    idempotencyKey: 'req-001',
  },
]);

// Query real-time tumbling/sliding window rollups (auto-flushes pending buffer)
const p95 = pipeline.queryRollup(
  'sub_101',
  'api',
  AggregationWindow.HOURLY,
  AggregationFunction.PERCENTILE_95
);

// Settle billing period with tiered pricing plans
const settlement = pipeline.settlePeriod({
  subscriptionId: 'sub_101',
  period: {
    start: new Date('2026-01-01T00:00:00.000Z'),
    end: new Date('2026-02-01T00:00:00.000Z'),
  },
  plans: [
    {
      metric: 'api',
      model: 'graduated',
      includedUnits: 1_000,
      unitPrice: 0.01,
      tiers: [
        { upToUnits: 10_000, unitPrice: 0.02 },
        { upToUnits: null, unitPrice: 0.01 },
      ],
    },
  ],
  resetAfterSettlement: true,
});
```

### Configuration Options (`UsageMeteringPipelineConfig`)

| Option                | Default        | Description                                                       |
| :-------------------- | :------------- | :---------------------------------------------------------------- |
| `maxBatchSize`        | `500`          | Maximum events per micro-batch before synchronous auto-flush      |
| `maxQueueDepth`       | `10_000`       | Maximum buffered events before backpressure policy activates      |
| `flushIntervalMs`     | `100`          | Sub-second timer interval in milliseconds (`0` disables timer)    |
| `maxOutOfOrdernessMs` | `30_000`       | Watermark out-of-order tolerance (30 seconds)                     |
| `allowedLatenessMs`   | `300_000`      | Allowed lateness behind watermark before cutoff (5 minutes)       |
| `maxClockSkewMs`      | `300_000`      | Maximum tolerated client clock drift (5 minutes)                  |
| `dedupWindowMs`       | `86_400_000`   | Idempotency key TTL window (24 hours)                             |
| `maxDedupEntries`     | `100_000`      | Maximum cached idempotency keys before $O(1)$ LRU eviction        |
| `bucketGranularityMs` | `60_000`       | Tumbling rollup bucket size (1 minute)                            |
| `maxBucketsPerStream` | `1_440`        | Maximum retained buckets per stream before oldest-bucket eviction |
| `lateEventPolicy`     | `'drop_dlq'`   | `'drop_dlq'` or `'route_adjustment'`                              |
| `backpressurePolicy`  | `'flush_sync'` | `'flush_sync'` or `'reject'`                                      |

---

## HTTP Ingestion Endpoint (`POST /v1/usage`)

Handled by `handleUsageIngestion` in `backend/services/billing/usageIngestionApi.ts`.

### Request Payload (Single Event or Batch)

```json
{
  "events": [
    {
      "userId": "sub_101",
      "metricType": "api",
      "amount": 42,
      "timestamp": "2026-01-15T12:00:00.000Z",
      "idempotencyKey": "idem_sub_101_api_1768478400000_8f2a1c90_1",
      "dimensions": { "region": "us-east-1" }
    }
  ]
}
```

### Response Status Codes & Headers

| Status Code                | Condition                                                            | Error Code              |
| :------------------------- | :------------------------------------------------------------------- | :---------------------- |
| `202 Accepted`             | Batch processed (individual dispositions reported in `data.results`) | —                       |
| `413 Payload Too Large`    | Batch exceeds `MAX_BATCH_SIZE` (`500`)                               | `USAGE_BATCH_TOO_LARGE` |
| `422 Unprocessable Entity` | Malformed request body                                               | `USAGE_INVALID_EVENT`   |
| `429 Too Many Requests`    | Pipeline backpressure queue full under `reject` policy               | `RATE_LIMIT_EXCEEDED`   |

Response headers include `X-Metering-Queue-Depth` and `X-Metering-Flushed-Batches`.

---

## Client-Side Batching SDK (`src/services/usageMeteringClient.ts`)

```typescript
import {
  createUsageMeteringClient,
  generateDeterministicIdempotencyKey,
} from '../src/services/usageMeteringClient';

const client = createUsageMeteringClient({
  endpoint: '/v1/usage',
  flushIntervalMs: 100,
  maxBatchSize: 500,
  maxRetries: 3,
  baseRetryDelayMs: 50,
  store: useAppStore.getState(), // Optional Zustand meteringSlice sync
  onDeadLetter: (failedEvents, err) => {
    console.error(`Dropped ${failedEvents.length} events to DLQ:`, err.message);
  },
});

client.track({
  subscriptionId: 'sub_101',
  metricType: 'api',
  amount: 1,
  dimensions: { endpoint: '/v1/charges' },
});

await client.flush();
```

---

## Soroban Smart Contract Quota & Usage (`contracts/subscription/src/usage.rs`)

The Soroban subscription contract exposes three on-chain metering functions backed by `StorageKey::SubscriptionUsage(subscription_id, metric)` and `StorageKey::PlanQuotas(plan_id)`:

- `record_usage(env, proxy, storage, subscription_id, metric, amount) -> UsageRecord`
  - Evaluates whether `env.ledger().timestamp() >= record.period_start + quota.period.seconds()`.
  - On period rollover, calculates unused units from `quota.limit + record.rollover_balance - record.current_usage` and applies `RolloverPolicy::NoRollover`, `RolloverPolicy::RolloverAll`, or `RolloverPolicy::RolloverCap(cap)`.
  - Increments `current_usage` using saturating arithmetic (`saturating_add`).
- `get_usage_record(env, proxy, storage, subscription_id, metric) -> UsageRecord`
  - Returns the persisted `UsageRecord` or a zero-initialized record anchored at current ledger timestamp.
- `check_quota(env, proxy, storage, subscription_id, metric) -> QuotaStatus`
  - Evaluates `current_usage` against `effective_limit = quota.limit + record.rollover_balance`:
    - `QuotaStatus::HardLimitReached` when `current_usage >= effective_limit` (100%)
    - `QuotaStatus::SoftLimitReached` when `current_usage * 100 >= effective_limit * 80` (80%)
    - `QuotaStatus::WithinLimit` otherwise.
