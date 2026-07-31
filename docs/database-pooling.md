# Database Connection Pool Optimization

`backend/services/shared/poolMonitor.ts`

## Overview

`MonitoredPool` wraps any `Pool` (primary or replica) and adds real-time monitoring, leak detection, exhaustion alerting, and tuning recommendations without changing the `Pool` interface contract.

## Architecture

```
Request
  │
  ▼
MonitoredPool.query() / connect()
  │
  ├─ Records latency (p99 rolling window)
  ├─ Tracks checked-out clients with timestamps
  ├─ Injects SET statement_timeout on connect
  │
  ▼
Inner pg.Pool → PostgreSQL primary / replica
  │
Background poll (every 5s)
  ├─ Exhaustion check (waitingCount ≥ threshold → alert)
  └─ Leak sweep (checkedOut age > leakThresholdMs → force-release + alert)
```

## Pool Configuration

Tuned via environment variables in `backend/config/database.ts`:

| Variable | Default | Description |
|---|---|---|
| `DB_POOL_MAX` | `20` | Max primary connections |
| `DB_REPLICA_POOL_SIZE` | `25` | Connections per replica (via PgBouncer) |
| `DB_IDLE_TIMEOUT_MS` | `10000` | Idle connection recycling |
| `DB_CONNECTION_TIMEOUT_MS` | `30000` | Acquisition timeout |
| `DB_STATEMENT_TIMEOUT_MS` | `30000` | Per-query statement timeout |
| `DB_REPLICATION_LAG_FAILOVER_MS` | `5000` | Route reads to primary above this lag |
| `DB_LAG_POLL_INTERVAL_MS` | `5000` | Replication lag poll interval |

## Wrapping a Pool

```typescript
import { wrapWithMonitor } from '../services/shared/poolMonitor';

const pool = await getPool();
const monitored = wrapWithMonitor(pool, {
  name: 'primary',
  maxConnections: 20,
  exhaustionThreshold: 5,   // alert when 5+ requests waiting
  leakThresholdMs: 30_000,  // flag connections held > 30s
  queryTimeoutMs: 30_000,
  onExhaustion: (stats) => alertingService.fire('db.pool.exhaustion', stats),
  onLeak: (leak) => logger.error('Connection leak', leak),
});
```

`MonitoredPool` implements the full `Pool` interface — it's a drop-in replacement.

## Pool Monitoring Dashboard

```
GET /pool/stats
```

```json
{
  "stats": {
    "name": "primary",
    "total": 18,
    "idle": 14,
    "waiting": 0,
    "checkedOut": 4,
    "utilizationPct": 20,
    "leakedConnections": 0,
    "peakCheckedOut": 12,
    "totalQueries": 84210,
    "totalErrors": 3,
    "avgQueryLatencyMs": 4,
    "p99QueryLatencyMs": 38
  },
  "tuning": {
    "currentMax": 20,
    "recommendedMax": 20,
    "reason": "Current pool size appears sufficient for observed load"
  },
  "history": [...]
}
```

## Pool Exhaustion Alerts

When `waitingCount ≥ exhaustionThreshold` (default 5), the monitor:
1. Logs a structured warning via `logger.warn`
2. Calls the `onExhaustion` callback for external alerting
3. Records the event in pool history

Recovery options:
- Increase `DB_POOL_MAX` (check DB `max_connections` first)
- Add a PgBouncer proxy tier (use `serverlessPool.ts` pattern)
- Reduce query durations (check `p99QueryLatencyMs`)

## Connection Leak Detection

Every `pool.connect()` call records a checkout timestamp. The background sweep (every `leakThresholdMs / 2`) force-releases any client held longer than `leakThresholdMs`:

1. Calls `client.release()` to return the connection
2. Increments `leakedConnections` counter
3. Calls `onLeak` callback
4. Logs origin information for debugging

To avoid leaks in application code, always use `try/finally`:

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ...
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release(); // always reached
}
```

## Query Timeout Configuration

`MonitoredPool` runs `SET statement_timeout = <ms>` on every new client checkout. This ensures long-running queries are killed at the database level before they exhaust pool connections.

Default: 30 000 ms. Override via `queryTimeoutMs` in config or `DB_STATEMENT_TIMEOUT_MS` env var.

## Prometheus Metrics

```
GET /metrics/pool
```

| Metric | Type | Description |
|---|---|---|
| `subtrackr_db_pool_total_connections` | gauge | Active connections |
| `subtrackr_db_pool_idle_connections` | gauge | Idle connections |
| `subtrackr_db_pool_waiting_connections` | gauge | Requests waiting |
| `subtrackr_db_pool_checked_out_connections` | gauge | Currently in use |
| `subtrackr_db_pool_utilization_pct` | gauge | % of max in use |
| `subtrackr_db_pool_leaked_connections_total` | counter | Leaked connections |
| `subtrackr_db_pool_queries_total` | counter | Total queries |
| `subtrackr_db_pool_errors_total` | counter | Query errors |
| `subtrackr_db_pool_avg_latency_ms` | gauge | Average query latency |
| `subtrackr_db_pool_p99_latency_ms` | gauge | P99 query latency |

All metrics include a `pool="primary"` label for multi-pool setups.

## Pool Tuning Recommendations

```typescript
const rec = monitoredPool.getTuningRecommendation();
// { currentMax: 20, recommendedMax: 25, reason: "Peak concurrent connections was 21..." }
```

The recommendation adds 20% headroom above the observed peak checked-out count. Check it periodically after traffic changes.

## Elasticsearch Pool

For Elasticsearch, the same `MonitoredPool` pattern can wrap an ES client proxy. See `backend/elasticsearch/config.ts` for field mappings. The ES index uses `max_results: 100` — paginate with the cursor-based pagination utilities when returning large result sets.
