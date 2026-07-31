# Database Read Replicas & Failover

SubTrackr routes read-heavy SQL to PostgreSQL read replicas and writes to the
primary. Replica lag is monitored continuously; when lag or availability crosses
thresholds, reads automatically fail over to the primary.

## Architecture

```
Application / DatabaseService
        │
        ├── WRITE (INSERT/UPDATE/DELETE/DDL) ──► Primary
        │
        └── READ  (SELECT / WITH) ──► Replica round-robin
                                      │
                                      ├─ lag OK ──► replica-N
                                      └─ lag / down ──► Primary (failover)
```

Elasticsearch follows the same pattern when remote nodes are configured:
writes → `ES_PRIMARY_URL`, reads → `ES_READ_REPLICA_URLS`, with failover to
primary when replicas are marked failed.

## Files

| File | Purpose |
|---|---|
| `backend/config/database.ts` | Primary + replica endpoint config |
| `backend/shared/db/readWriteRouter.ts` | Read/write splitting + lag failover |
| `backend/shared/db/connectionStringRotation.ts` | Connection string parse / rotate |
| `backend/shared/db/queryClassifier.ts` | SELECT vs write classification |
| `backend/services/shared/databaseService.ts` | Service-layer facade |
| `backend/monitoring/replicationLagExporter.ts` | Prometheus lag metrics |
| `backend/elasticsearch/config.ts` | ES replica node configuration |
| `backend/elasticsearch/replicaRouter.ts` | ES read/write + failover routing |

## Configuration

### Discrete host variables

```bash
DB_HOST=primary.internal
DB_PORT=5432
DB_NAME=subtrackr
DB_USER=app
DB_PASSWORD=secret
DB_READ_REPLICAS=replica-1.internal:6432,replica-2.internal:6433
DB_REPLICA_POOL_SIZE=25
DB_REPLICATION_LAG_P99_ALARM_MS=1000
DB_REPLICATION_LAG_FAILOVER_MS=5000
DB_STALE_READ_DEFAULT_SECONDS=30
DB_LAG_POLL_INTERVAL_MS=5000
```

### Connection string style (supports rotation)

```bash
DATABASE_URL=postgresql://app:secret@primary.internal:5432/subtrackr
DATABASE_READ_URLS=postgresql://app:secret@r1:5432/subtrackr,postgresql://app:secret@r2:5432/subtrackr
```

### Elasticsearch replicas

```bash
ES_PRIMARY_URL=https://es-primary:9200
ES_READ_REPLICA_URLS=https://es-r1:9200,https://es-r2:9200
ES_READ_WRITE_SPLITTING=true
ES_AUTOMATIC_FAILOVER=true
```

## Read / write splitting

`ReadWritePool` (and `DatabaseService.query`) classifies SQL:

- **Read** — `SELECT` / non-mutating `WITH` → healthy replica (round-robin)
- **Write** — `INSERT` / `UPDATE` / `DELETE` / DDL / `SELECT … FOR UPDATE` → primary
- **Transactions** — `connect()` always uses the primary

Response headers (when routing context is attached):

| Header | Example |
|---|---|
| `X-DB-Route` | `replica:replica-1` or `primary` |
| `X-DB-Route-Reason` | `no-replicas` / `lag-or-unavailable` |
| `X-DB-Route-Warning` | `replication-lag-fallback-primary` |
| `X-DB-Replication-Lag-Ms` | `240` |

Analytics may raise the lag budget via `X-Stale-Accept: <seconds>`.

## Automatic failover

Failover triggers (reads move to primary):

1. **Replica lag** above `DB_REPLICATION_LAG_FAILOVER_MS` (default 5s)
2. **Replica query error** — replica marked unavailable, next read uses primary
3. **Operator / service failover** — `databaseService.failoverToPrimary(reason)`

Recovery:

```ts
import { getDatabaseService } from '../backend/services/shared/databaseService';

const db = getDatabaseService();
await db.failoverToPrimary('replica-lag-p99-alarm');
// … investigate / repair replicas …
await db.recoverFromFailover();
```

Status snapshot:

```ts
const status = db.getFailoverStatus();
// { mode: 'failover-primary' | 'replicas-active' | 'primary-only',
//   healthyReplicas, totalReplicas, lagStates, connectionGeneration }
```

## Replica lag monitoring

Background polling (`DB_LAG_POLL_INTERVAL_MS`) runs:

```sql
SELECT COALESCE(
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000,
  0
)::float AS lag_ms
```

Prometheus metrics (via `replicationLagExporter`):

- `subtrackr_replication_lag_ms{replica=…}`
- `subtrackr_replication_lag_p99_ms{replica=…}`
- `subtrackr_replication_lag_p99_alarm_ms`
- `subtrackr_replication_lag_failover_ms`
- `subtrackr_replica_available{replica=…}`
- `subtrackr_replica_pool_*` / `subtrackr_replica_query_*`

Alert when P99 lag exceeds `DB_REPLICATION_LAG_P99_ALARM_MS` (default 1s).

## Connection string rotation

Rotate credentials or endpoints without process restart:

```ts
await db.rotateConnectionStrings({
  primaryUrl: 'postgresql://app:new-secret@primary:5432/subtrackr',
  replicaUrls: [
    'postgresql://app:new-secret@r1:5432/subtrackr',
    'postgresql://app:new-secret@r2:5432/subtrackr',
  ],
});
```

Effects:

1. Parses and stores the new URLs (`ConnectionStringRotator`)
2. Rebuilds replica pools against the new hosts
3. Clears failure state and bumps `connectionGeneration`
4. Safe snapshot via `db.getConnectionSnapshot()` (passwords redacted)

For Elasticsearch node URL rotation use `ElasticsearchReplicaRouter.rotateNodes()`.

## Failover testing

Backend Jest suite covers:

| Test | Location |
|---|---|
| Lag-based failover to primary | `backend/shared/db/__tests__/readWriteRouter.test.ts` |
| Replica query failure fallback | same |
| Connection string parse / rotate | `backend/shared/db/__tests__/connectionStringRotation.test.ts` |
| Service failover + recovery | `backend/services/shared/__tests__/databaseService.test.ts` |
| ES replica failover + rotation | `backend/elasticsearch/__tests__/replicaRouter.test.ts` |

Run:

```bash
npx jest -c jest.backend.config.js \
  backend/shared/db/__tests__/ \
  backend/services/shared/__tests__/databaseService.test.ts \
  backend/elasticsearch/__tests__/replicaRouter.test.ts \
  backend/config/__tests__/database.test.ts \
  backend/monitoring/__tests__/replicationLagExporter.test.ts
```

Manual checklist:

1. Start primary + two replicas; set `DB_READ_REPLICAS` / `DATABASE_READ_URLS`
2. Confirm `X-DB-Route` shows `replica:*` on a SELECT endpoint
3. Stop one replica — traffic moves to the healthy replica / primary
4. Inject lag (pause WAL replay) above 5s — confirm primary fallback header
5. Rotate `DATABASE_URL` credentials via `rotateConnectionStrings` — generation increments, queries succeed
6. Call `failoverToPrimary` then `recoverFromFailover` — mode flips correctly

## Operational runbook

| Symptom | Action |
|---|---|
| P99 lag alarm | Check replica apply rate / network; raise stale budget only for analytics |
| All replicas unavailable | Automatic primary failover; page on-call if sustained |
| Credential rotation | Call `rotateConnectionStrings` then verify `connectionGeneration` |
| Split-brain risk | Never promote a replica from the app layer — use your cloud/DB provider promote flow, then rotate URLs |
