# Job Queue & Priority Management

SubTrackr's job queue system provides weighted-fair scheduling across four
priority classes, with rate limiting, exponential backoff retry, dead letter
queue, cron scheduling, and a monitoring dashboard.

## Architecture

```
WeightedFairQueue  (Deficit Round Robin scheduler)
    ├── PriorityQueue[critical]   — BullMQ + in-memory buffer
    ├── PriorityQueue[high]
    ├── PriorityQueue[normal]
    └── PriorityQueue[low]
            │
            ├── RetryPolicy          — exponential backoff + jitter
            ├── DeadLetterQueue      — exhausted jobs → DLQ
            ├── JobRateLimiter       — per-service token buckets
            ├── JobScheduler         — cron-based job firing
            └── JobMonitoringDashboard — unified snapshot + Prometheus
```

## Files

| File | Purpose |
|---|---|
| `backend/shared/queue/types.ts` | Priority types, weights, SLO constants |
| `backend/shared/queue/priorityQueue.ts` | `PriorityQueue<T>` wrapping BullMQ |
| `backend/shared/queue/weightedFairQueue.ts` | `WeightedFairQueue` DRR scheduler |
| `backend/shared/queue/queueFactory.ts` | `createJobQueueSystem()` factory |
| `backend/shared/queue/retryPolicy.ts` | Exponential backoff with full jitter |
| `backend/shared/queue/deadLetterQueue.ts` | Dead letter queue |
| `backend/shared/queue/jobRateLimiter.ts` | Per-service rate limiting |
| `backend/shared/queue/jobScheduler.ts` | Cron-based job scheduling |
| `backend/shared/queue/jobMonitoringDashboard.ts` | Unified monitoring snapshot |
| `backend/billing/jobs/billingJobQueue.ts` | Billing-domain job queue wiring |

## Priority Classes

| Priority | BullMQ # | WFQ Weight | Latency SLO | Use for |
|---|---|---|---|---|
| `critical` | 1 | 50% | 30 s | Payment confirmations, dunning |
| `high` | 2 | 25% | 2 min | Email notifications, webhooks |
| `normal` | 3 | 15% | 10 min | Revenue recognition, analytics |
| `low` | 4 | 10% | ∞ | Reporting, export, cleanup |

Low priority always gets ≥ 1% capacity (starvation prevention).

## Quick Start

```ts
import { createJobQueueSystem, RetryPolicy, DeadLetterQueue,
         createDefaultJobRateLimiter, JobScheduler,
         JobMonitoringDashboard } from './backend/shared/queue';

const redisConnection = { host: 'localhost', port: 6379 };

// 1. Create queue system
const { scheduler, queues } = createJobQueueSystem({
  connection: redisConnection,
  baseQueueName: 'subtrackr:jobs',
});

// 2. Retry policy with exponential backoff
const retry = new RetryPolicy({
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  maxAttempts: { critical: 10, high: 7, normal: 5, low: 3 },
  jitter: true,
});

// 3. Dead letter queue
const dlq = new DeadLetterQueue({
  connection: redisConnection,
  onDeadLetter: (entry) => logger.error('dead_letter', { jobId: entry.job.id }),
});

// 4. Rate limiter
const rateLimiter = createDefaultJobRateLimiter();

// 5. Cron scheduler
const cronScheduler = new JobScheduler(scheduler);
cronScheduler.register({
  name: 'daily-revenue-recognition',
  cron: '0 0 2 * * *',
  priority: 'normal',
  jobName: 'billing:revenue-recognition',
  dataFactory: () => ({ runDate: new Date().toISOString() }),
  skipIfRunning: true,
});
cronScheduler.start();

// 6. Dashboard
const dashboard = new JobMonitoringDashboard(scheduler, { dlq, rateLimiter, scheduler: cronScheduler });

// 7. Register job handlers with retry + DLQ
const handlers = {
  'payment:confirmation-email': async (job) => {
    let attempt = 0;
    while (true) {
      try {
        // Check rate limit before calling Stripe
        const decision = rateLimiter.check('stripe');
        if (!decision.allowed) {
          await new Promise(r => setTimeout(r, decision.retryAfterMs));
        }
        await sendPaymentConfirmation(job.data);
        return;
      } catch (err) {
        const { shouldRetry, delayMs } = retry.decide(job.priority, attempt++, err);
        if (!shouldRetry) {
          await dlq.add(job, err.message, attempt);
          throw err;
        }
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  },
};

scheduler.startProcessing(handlers);
```

## Rate Limiting for External API Jobs

`JobRateLimiter` implements a sliding-window token bucket per service.

Default limits (from `createDefaultJobRateLimiter()`):

| Service | Limit | Window |
|---|---|---|
| `stripe` | 90 req | 1 s |
| `sendgrid` | 550 req | 60 s |
| `twilio` | 80 req | 1 s |
| `expo-push` | 900 req | 1 s |
| `blockchain-rpc` | 30 req | 1 s |

Register custom limits:
```ts
rateLimiter.register('my-api', { requestsPerWindow: 200, windowMs: 1000 });
```

Check before calling:
```ts
const { allowed, retryAfterMs } = rateLimiter.check('my-api');
if (!allowed) await sleep(retryAfterMs);
```

## Exponential Backoff Retry

`RetryPolicy.decide(priority, attempt, error)` returns:
- `shouldRetry: false` → job has exhausted attempts, send to DLQ
- `shouldRetry: true` + `delayMs` → wait and retry

Formula (full-jitter):
```
delay = random(0, min(base * 2^attempt, maxDelay))
```

Example delays for default config (base=1s, max=60s):
```
Attempt 0: 0–1s
Attempt 1: 0–2s
Attempt 2: 0–4s
Attempt 3: 0–8s
...
Attempt 6: 0–60s (capped)
```

Max attempts by priority: `critical=10, high=7, normal=5, low=3`.

## Dead Letter Queue

Jobs that exhaust all retry attempts land in the DLQ.

```ts
// Inspect entries
const entries = dlq.getEntries();

// Replay a specific entry
const entry = dlq.remove(entryId);
if (entry) {
  await scheduler.enqueue(entry.job.priority, entry.job.name, entry.job.data);
}

// View DLQ by priority
const criticalFailed = dlq.getEntriesByPriority('critical');
```

The DLQ retains entries for 7 days by default. Entries older than the retention
window are pruned on the next `getEntries()` call.

## Job Scheduling with Cron

`JobScheduler` fires jobs into the `WeightedFairQueue` on a cron schedule.

Cron expression format: `second minute hour day month weekday`

```ts
// Every day at 2:00 AM
scheduler.register({ name: 'daily-report', cron: '0 0 2 * * *', … });

// Every Monday at 9:00 AM
scheduler.register({ name: 'weekly-digest', cron: '0 0 9 * * 1', … });

// Every minute
scheduler.register({ name: 'heartbeat', cron: '0 * * * * *', … });
```

The scheduler ticks every second (configurable via `tickMs`). Jobs that would
fire in the same second as the previous fire are debounced.

## Job Monitoring Dashboard

```ts
const snap = dashboard.getDashboardSnapshot();
// {
//   health: 'healthy' | 'degraded' | 'critical',
//   queues: [{ priority, depth, paused, sloViolations, avgWaitMs, … }],
//   dlq: { total, byCritical, byHigh, byNormal, byLow, recentEntries },
//   rateLimits: [{ service, throttledCount, remaining, … }],
//   scheduledJobs: [{ name, cron, lastFiredAt, fireCount, … }],
//   totalSloViolations, totalProcessed,
// }
```

### Prometheus metrics

```bash
curl http://localhost:3001/metrics/jobs
```

Key metrics:

| Metric | Description |
|---|---|
| `subtrackr_jobs_health` | 0=healthy, 1=degraded, 2=critical |
| `subtrackr_jobs_queue_depth{priority}` | Current depth per class |
| `subtrackr_jobs_enqueued_total{priority}` | Total enqueued |
| `subtrackr_jobs_processed_total{priority}` | Total processed |
| `subtrackr_jobs_slo_violations_total{priority}` | SLO violations |
| `subtrackr_jobs_avg_wait_ms{priority}` | Average wait time |
| `subtrackr_jobs_dlq_depth{priority}` | DLQ depth per class |
| `subtrackr_jobs_rate_limit_throttled_total{service}` | Throttled requests |

## Health States

| State | Condition |
|---|---|
| `healthy` | DLQ < 10, SLO violations < 5 |
| `degraded` | DLQ ≥ 10 OR SLO violations ≥ 5 |
| `critical` | DLQ ≥ 100 OR SLO violations ≥ 25 |

## Backpressure

When all queues are full, the scheduler automatically pauses the lowest
non-empty priority class (never pauses `critical`). It resumes automatically
when capacity is available.

Manually resume all paused queues:
```ts
await scheduler.resumeAll();
```

## ML Jobs

ML inference jobs (churn prediction, pricing optimisation, recommendations)
are dispatched at `normal` priority via the analytics service. The ML service
is on Kubernetes with HPA (2–10 replicas) and handles burst capacity.

```ts
// In analytics/predictionService.ts
await scheduler.enqueue('normal', 'ml:churn-prediction', {
  subscriberId,
  features,
});
```
