# Read-Replica Routing

## Overview

SubTrackr routes read-only queries (`SELECT`, `WITH ... SELECT`) to PostgreSQL
read replicas and write queries to the primary, with automatic failover when
replication lag exceeds configurable thresholds.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DB_READ_REPLICAS` | (none) | Comma-separated `host:port` pairs |
| `DATABASE_READ_URLS` | (none) | Comma-separated postgres:// URLs |
| `DB_ROUTING_ENABLED` | `true` | Master switch for read-replica routing |
| `DB_ROUTING_STRATEGY` | `round-robin` | Replica selection: `round-robin`, `least-lag`, `random` |
| `DB_ROUTING_MIN_REPLICAS` | `1` | Min healthy replicas before falling back to primary |
| `DB_ROUTING_MAX_LAG_MS` | `5000` | Max replication lag before replica is excluded |
| `DB_ROUTING_DEBUG_HEADERS` | `false` | Include routing debug headers in responses |
| `DB_REPLICATION_LAG_FAILOVER_MS` | `5000` | Global lag failover threshold |
| `DB_REPLICATION_LAG_P99_ALARM_MS` | `1000` | P99 lag alarm threshold |

### Routing Strategy

| Strategy | Description |
|---|---|
| `round-robin` | Distribute reads evenly across healthy replicas (default) |
| `least-lag` | Always select the replica with the lowest lag |
| `random` | Random selection among healthy replicas |

### Primary-Pinned Queries

Some read queries must always go to the primary:
- `SELECT ... FOR UPDATE` — locking reads
- `SELECT NEXTVAL(...)` — sequence generation
- `SELECT pg_advisory_lock(...)` — advisory locks

These patterns are matched automatically. Add custom patterns via
`ReplicaRoutingConfig.primaryPinnedPatterns`.

## Lag Monitoring

The `ReadWritePool` polls each replica's lag every 5 seconds (configurable via
`DB_LAG_POLL_INTERVAL_MS`) using:

```sql
SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 AS lag_ms
```

- Replicas with lag > `maxLagMs` are excluded from routing
- P99 lag is computed from a rolling window of samples
- If all replicas exceed the threshold, reads fall back to primary
- Response headers (`X-DB-Route`, `X-DB-Replication-Lag-Ms`) indicate routing

## Per-Request Override

Use `RoutingOverride` to force all queries in a request to primary:

```typescript
import { mergeRoutingConfig } from './shared/db/replicaRoutingConfig';

// Force primary for a critical read-after-write path
const override = { forcePrimary: true };
```

## Response Headers

| Header | Value | Description |
|---|---|---|
| `X-DB-Route` | `primary` or `replica:name` | Where the query was routed |
| `X-DB-Route-Reason` | `no-replicas`, `lag-or-unavailable` | Why primary was used |
| `X-DB-Replication-Lag-Ms` | (number) | Lag of the selected replica |
| `X-DB-Route-Warning` | (string) | Fallback warning message |
