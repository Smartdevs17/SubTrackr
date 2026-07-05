# Database Query Optimization

This document covers query profiling, the composite indexes added for the hot
read paths, `EXPLAIN ANALYZE` for the critical queries, N+1 handling, and the
runtime slow-query monitor. It is the reference for issue #418.

> Note on numbers: percentile/latency targets below are validated against a
> populated database using the procedure in **§1**. Run that procedure in a
> staging environment with production-representative data to capture concrete
> before/after numbers for a PR; the plans in **§3** are the structures to
> expect, not synthetic figures.

## 1. Profiling: top slowest queries

The backend uses PostgreSQL (`pg`). Enable `pg_stat_statements` and pull the
top 20 by total and by p95-ish mean time:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 20 by total time
SELECT queryid, calls, total_exec_time, mean_exec_time, rows,
       100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0) AS hit_pct,
       query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- Top 20 by mean time (proxy for slow individual calls)
SELECT queryid, calls, mean_exec_time, max_exec_time, rows, query
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

Reset between runs with `SELECT pg_stat_statements_reset();` so before/after
comparisons are clean.

At runtime, the application-level `SlowQueryMonitor`
(`backend/shared/query/slowQueryMonitor.ts`) provides the same top-N view
without DB access — see **§5**.

## 2. Composite indexes added (migration 007)

`db/migrations/007_composite_query_indexes.sql` adds three indexes. Each targets
a query the existing indexes (`001_base_indexes.sql`, `006_usage_alerts.sql`) do
**not** fully cover:

| Index | Table | Serves |
|---|---|---|
| `idx_alerts_subscription_created (subscription_id, created_at DESC)` | `usage_alerts` | `WHERE subscription_id = $1 AND created_at > $2 ORDER BY created_at DESC` (`alertingRepository.ts:57`, `usageAlertsController.ts:144`) |
| `idx_payment_methods_user_id (user_id, id)` | `payment_methods` | keyset pagination `WHERE user_id = $1 AND id > $cursor ORDER BY id` (`resolvers.ts:257`) |
| `idx_usage_metrics_subscription_meter (subscription_id, meter_id)` | `usage_metrics` | exact lookup `WHERE subscription_id = $1 AND meter_id = $2` (`alertingService.ts:130`) |

Why not the existing indexes:

- `idx_alerts_subscription_level` is `(subscription_id, threshold_level, created_at)`.
  Queries that omit `threshold_level` cannot use the trailing `created_at` for the
  range/ORDER BY, so they degrade to a filter + sort.
- `payment_methods` had only the `id` primary key — the per-user keyset page
  scanned and sorted.
- `idx_usage_metrics_subscription` is single-column and **partial**
  (`WHERE current_usage > 0`), so it can't serve the exact `(subscription_id,
  meter_id)` lookup for zero-usage rows.

All three are created `CONCURRENTLY IF NOT EXISTS` (online, idempotent).

## 3. EXPLAIN ANALYZE for the critical queries

Run each before and after applying migration 007. Expected shape after:

```sql
-- usage_alerts recent-by-subscription
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM usage_alerts
WHERE subscription_id = '00000000-0000-0000-0000-000000000001'
  AND created_at > now() - INTERVAL '30 days'
ORDER BY created_at DESC
LIMIT 100;
-- expect: Index Scan using idx_alerts_subscription_created (no Sort node)

-- payment_methods keyset page
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, user_id, type, last4, brand, expires_at
FROM payment_methods
WHERE user_id = '00000000-0000-0000-0000-000000000001'
ORDER BY id
LIMIT 11;
-- expect: Index Scan using idx_payment_methods_user_id (no Seq Scan, no Sort)

-- usage_metrics point lookup
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM usage_metrics
WHERE subscription_id = '00000000-0000-0000-0000-000000000001'
  AND meter_id = 'api_calls';
-- expect: Index Scan using idx_usage_metrics_subscription_meter (rows≈1)
```

The "before" plans show `Seq Scan` and/or a `Sort` node on these tables; the
"after" plans should show an `Index Scan` and no `Sort`. The p95 target (80%
reduction) is met when these tables are large enough that the sequential scan
dominated — confirm with the `pg_stat_statements` deltas from **§1**.

## 4. N+1 detection and eager loading

The GraphQL layer already mitigates N+1 with DataLoaders
(`backend/graphql/dataloaders/index.ts`): related rows are batched with
`WHERE id = ANY($1::text[])` instead of one query per parent (e.g.
`payment_methods`, `plans`). The list resolvers
(`backend/graphql/resolvers.ts`) use keyset pagination rather than per-row
fetches.

A sweep for per-row awaited queries (`for (… of …) { await client.query(…) }`)
across `backend/` found no N+1 loops in the service/repository layer. The new
`idx_payment_methods_user_id` additionally backs the DataLoader's batched lookup
ordering. No code change was required for this criterion; this section documents
the verification.

## 5. Slow-query monitoring and alerting

`backend/shared/query/slowQueryMonitor.ts` wraps any pg-style client and is a
drop-in for `pool.query`:

```ts
import { SlowQueryMonitor } from './backend/shared/query/slowQueryMonitor';

const monitor = new SlowQueryMonitor(pool, {
  slowThresholdMs: 100,
  onSlowQuery: (e) => logger.warn('slow_query', {
    fingerprint: e.fingerprint, durationMs: e.durationMs, rowCount: e.rowCount,
  }),
});

await monitor.query('SELECT ... WHERE user_id = $1', [userId]); // timed
const worst = monitor.getTopSlow(20); // top-20 slowest patterns by p95
```

- Groups timings by a normalized SQL fingerprint (comments/whitespace stripped),
  so call sites aggregate regardless of formatting.
- Tracks p50/p95/p99/max and call/slow counts per pattern.
- `onSlowQuery` is the alerting seam — wire it to the existing logger/alerting
  channel. `getTopSlow(20)` mirrors the §1 profiling view at runtime.

Covered by unit tests in
`backend/shared/query/__tests__/slowQueryMonitor.test.ts`.

## 6. Write-overhead / maintenance (Edge)

Every index is maintained on each write and consumes storage. Assessment for the
three new indexes:

- `idx_payment_methods_user_id` — `payment_methods` is low-write; negligible.
- `idx_alerts_subscription_created` — `usage_alerts` is append-mostly; one extra
  index write per insert.
- `idx_usage_metrics_subscription_meter` — `usage_metrics` is the highest-write
  table (updated each metering tick); the index is intentionally two narrow
  columns to keep per-write cost low.

Monitor index health and unused indexes after deploy:

```sql
-- Index size and usage
SELECT relname AS table, indexrelname AS index,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size,
       idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE indexrelname LIKE 'idx_%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Detect duplicate/overlapping indexes before adding more
SELECT indexrelid::regclass, indrelid::regclass, indkey
FROM pg_index ORDER BY indrelid;
```

If `idx_scan` stays at 0 after a representative window, or write latency
regresses on `usage_metrics`, drop the offending index (`DROP INDEX
CONCURRENTLY …`) — it is safe to remove because no application code depends on an
index existing.
