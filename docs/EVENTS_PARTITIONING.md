# Audit Events Table Partitioning

## Overview

The `audit_events` table is partitioned by month using PostgreSQL native
range partitioning on the `created_at` column. This keeps individual
partitions small, speeds up time-range queries, and allows old partitions
to be detached and archived without affecting active data.

## Partition Strategy

| Setting | Value |
|---|---|
| Partition key | `created_at TIMESTAMPTZ` |
| Partition type | RANGE (monthly) |
| Default partition | `audit_events_default` (catches out-of-range rows) |
| Initial partitions | Current month + next 3 months |
| Naming convention | `audit_events_YYYY_MM` (e.g., `audit_events_2026_10`) |

## Query Compatibility

All existing queries against `audit_events` work unchanged — PostgreSQL
routes inserts and queries to the correct partition automatically.

Time-range queries benefit the most:
```sql
-- This query only scans the relevant partitions, not the entire table
SELECT * FROM audit_events
WHERE created_at >= '2026-10-01' AND created_at < '2026-11-01'
  AND actor_id = 'user-123';
```

## Management Commands

### List partitions
```bash
node scripts/db-partition-manage.js list
```

### Create partitions for the next N months
```bash
node scripts/db-partition-manage.js create --months 6
```

### Detach old partitions for archiving
```bash
node scripts/db-partition-manage.js detach --before 2026-06
```

Detached partitions become standalone tables (e.g., `audit_events_2026_05`)
that can be exported to cold storage and then dropped.

### SQL function
```sql
-- Create a specific month's partition
SELECT create_audit_events_partition(2027, 3);
-- Returns: "Created partition audit_events_2027_03 for 2027-03-01 to 2027-04-01"
```

## Automated Partition Creation

Add a cron job to create partitions ahead of time:

```cron
# Create partitions for the next 3 months, weekly
0 0 * * 0 DATABASE_URL=postgres://... node /app/scripts/db-partition-manage.js create --months 3
```

## Partition Pruning

PostgreSQL automatically prunes partitions that cannot contain matching rows.
To verify pruning is working:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM audit_events
WHERE created_at >= '2026-10-15' AND created_at < '2026-10-20';
-- Should show "Subplans Removed: 3" (the non-matching monthly partitions)
```

## Indexes

Indexes created on the partitioned parent are automatically created on all
existing and future partitions:

- `idx_audit_events_actor_id` — (actor_id)
- `idx_audit_events_action` — (action)
- `idx_audit_events_resource_type` — (resource_type)
- `idx_audit_events_resource_id` — (resource_id)
- `idx_audit_events_timestamp` — (timestamp DESC)
- `idx_audit_events_hash` — (hash)
- `idx_audit_events_created_at` — (created_at DESC)

## Rollback

Rolling back partitioning is a manual operation:

1. Create a non-partitioned copy:
   ```sql
   CREATE TABLE audit_events_unpartitioned AS SELECT * FROM audit_events;
   ```
2. Drop the partitioned table:
   ```sql
   DROP TABLE audit_events CASCADE;
   ```
3. Rename the copy:
   ```sql
   ALTER TABLE audit_events_unpartitioned RENAME TO audit_events;
   ```
4. Recreate indexes.
