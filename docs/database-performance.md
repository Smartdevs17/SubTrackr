# Database Performance Monitoring

SubTrackr's database performance stack provides query-level observability,
index recommendations, slow-query detection, and a dashboard endpoint.

## Architecture

```
Application code
    └── pool.query(sql, params)
            ↓ wrapped by
    QueryPerformanceMonitor          ← extends SlowQueryMonitor
        ├── Per-query timing (p50/p95/p99 per fingerprint)
        ├── EXPLAIN ANALYZE (sampled, staging/dev only)
        ├── Index usage stats (seq scan vs index scan ratio)
        ├── Index recommendation engine
        ├── Alert ring-buffer (onAlert callback)
        └── Prometheus metrics export
```

## Files

| File | Purpose |
|---|---|
| `backend/shared/query/slowQueryMonitor.ts` | Base: query timing, fingerprint bucketing, slow detection |
| `backend/shared/query/queryPerformanceMonitor.ts` | Extension: index stats, recommendations, dashboard, alerts |
| `backend/shared/query/queryRouter.ts` | Routes reads to materialized views, writes to base tables |
| `db/QUERY_OPTIMIZATION.md` | Composite indexes, EXPLAIN plans, N+1 analysis |
| `db/migrations/007_composite_query_indexes.sql` | Composite indexes for hot read paths |

## Quick Start

```ts
import { QueryPerformanceMonitor } from './backend/shared/query/queryPerformanceMonitor';
import { getPool } from './backend/shared/db/connectionPool';

const pool = await getPool();
const monitor = new QueryPerformanceMonitor(pool, {
  slowThresholdMs: 100,
  explainSlowQueries: true,     // enable EXPLAIN ANALYZE (staging only)
  explainSampleRate: 0.1,       // 10% of slow queries
  onSlowQuery: (event) => {
    logger.warn('slow_query', {
      fingerprint: event.fingerprint,
      durationMs: event.durationMs,
    });
  },
  onAlert: (alert) => {
    if (alert.type === 'missing_index' || alert.type === 'seq_scan') {
      alertingService.fire(alert);
    }
  },
});

// Use as drop-in for pool.query:
await monitor.query('SELECT * FROM subscriptions WHERE user_id = $1', [userId]);
```

## Query Performance Logging

Every query executed through `SlowQueryMonitor` / `QueryPerformanceMonitor` is:

1. **Timed** — start/end timestamps around the pg query call.
2. **Fingerprinted** — SQL is normalised (whitespace collapsed, comments stripped)
   to group call sites regardless of formatting.
3. **Bucketed** — Per-fingerprint ring buffer (default 1000 samples) tracks
   `count`, `slowCount`, `totalMs`, `maxMs`, `p50Ms`, `p95Ms`, `p99Ms`.
4. **Alerted** — Queries ≥ `slowThresholdMs` (default 100ms) fire `onSlowQuery`.

## Slow Query Detection (> 100ms)

The default threshold is **100ms**. Override at construction:

```ts
const monitor = new QueryPerformanceMonitor(pool, { slowThresholdMs: 100 });
```

All slow queries appear in:
- The `onSlowQuery` callback (for logging/alerting)
- `monitor.getTopSlow(20)` — top 20 by p95 latency
- The dashboard at `GET /metrics/db-performance`

## Index Usage Statistics

When `explainSlowQueries: true`, each sampled slow query runs
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and the plan is inspected for:

- `Seq Scan` nodes → recorded as a sequential scan hit
- `Index Scan` / `Index Only Scan` → recorded as an index scan hit

Access via:
```ts
const usageStats = monitor.getIndexUsageStats();
// Returns: [{ fingerprint, seqScanCount, indexScanCount, indexUsageRatio }]
// Sorted by indexUsageRatio ASC (lowest ratio = most seq scans = index needed)
```

## Index Recommendation Engine

`getIndexRecommendations()` cross-correlates query stats with scan stats to
surface actionable index opportunities:

| Condition | Severity |
|---|---|
| Seq scan ratio > 80% and p95 > threshold | high |
| p95 > 500ms | high |
| p95 > threshold and slow count >= 5 | medium/low |

```ts
const recs = monitor.getIndexRecommendations();
for (const rec of recs) {
  console.log(`[${rec.severity}] ${rec.reason}`);
  console.log(`Affected tables: ${rec.affectedTables.join(', ')}`);
  console.log(`Sample SQL: ${rec.sample}`);
}
```

## Query Plan Analysis

```ts
const plan = await monitor.runExplain(
  'SELECT * FROM subscriptions WHERE user_id = $1',
  [userId],
);
// Returns: { hasSeqScan, hasIndexScan, hasSortNode, nodes[], suggestion }
```

`runExplain` only runs on SELECT/WITH queries (safety guard against DML explains).

## Performance Alerts

Alerts fire to `onAlert` for:

| Alert type | Trigger |
|---|---|
| `slow_query` | Query duration ≥ `slowThresholdMs` |
| `seq_scan` | EXPLAIN shows Seq Scan on a slow query |
| `missing_index` | Index recommendation severity = high |
| `high_p95` | (Reserved for future threshold rule) |

```ts
const recent = monitor.getRecentAlerts(50);
```

## Database Performance Dashboard

The `getDashboardSnapshot()` method returns a JSON object suitable for a
monitoring UI:

```ts
const dash = monitor.getDashboardSnapshot({ topN: 20 });
// {
//   capturedAt, totalQueries, totalSlowQueries, slowQueryRate,
//   topSlowByP95, topSlowByCount,
//   indexUsageStats, indexRecommendations,
//   recentAlerts, health: 'healthy' | 'degraded' | 'critical'
// }
```

### HTTP endpoint

Available at `GET /metrics/db-performance?format=prometheus` when a
`QueryPerformanceMonitor` is attached to the pool as `pool.queryMonitor`.

## Prometheus Metrics

```bash
curl http://localhost:3001/metrics/db-performance?format=prometheus
```

Key metrics exposed:

| Metric | Type | Description |
|---|---|---|
| `subtrackr_db_queries_total` | counter | Total queries executed |
| `subtrackr_db_slow_queries_total` | counter | Slow queries (> threshold) |
| `subtrackr_db_slow_query_rate` | gauge | Slow query ratio (0–1) |
| `subtrackr_db_index_recommendations_total{severity}` | gauge | Pending index recs |
| `subtrackr_db_query_p95_ms{fingerprint}` | gauge | P95 latency per query pattern |
| `subtrackr_db_health` | gauge | 0=healthy, 1=degraded, 2=critical |

## Health States

| State | Condition |
|---|---|
| `healthy` | slow rate < 10%, no high-severity index recs |
| `degraded` | slow rate ≥ 10% OR any high-severity rec |
| `critical` | slow rate ≥ 30% OR ≥ 3 high-severity recs |

## Composite Indexes (migration 007)

See `db/QUERY_OPTIMIZATION.md` for the full index strategy. Key indexes:

```sql
-- usage_alerts: recent-by-subscription query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_subscription_created
  ON usage_alerts (subscription_id, created_at DESC);

-- payment_methods: keyset pagination
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_methods_user_id
  ON payment_methods (user_id, id);

-- usage_metrics: exact lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_metrics_subscription_meter
  ON usage_metrics (subscription_id, meter_id);
```

## Materialized Views (QueryRouter)

`QueryRouter` routes read-heavy aggregations to pre-computed materialized views:

| View | Query served |
|---|---|
| `active_subscriptions_summary` | Per-user active subscription count + total |
| `subscriber_balance_mv` | Per-user transaction totals |
| `monthly_revenue_mv` | Monthly revenue by currency |
| `churn_summary_mv` | Monthly churn cohort analysis |

```ts
const router = new QueryRouter(pool);
const summary = await router.getActiveSubscriptionSummary(userId);
const freshness = await router.getViewFreshness();
// freshness[0].isStale === true when refreshed_at > 60s ago
```
