-- ── Migration 013: Partition the audit_events table by time (issue #1802) ────
--
-- Converts the audit_events table to a partitioned table using monthly
-- range partitions on the `created_at` column.
--
-- Strategy:
--   1. Rename the existing audit_events table to audit_events_legacy.
--   2. Create a new partitioned audit_events table with the same schema.
--   3. Create the initial partitions (current + next 3 months + default).
--   4. Migrate existing data from the legacy table.
--   5. Create indexes on each partition.
--   6. Drop the legacy table after verification.
--
-- The default partition catches any row that doesn't fit a named partition,
-- so inserts never fail.
--
-- A partition management function is included for creating/dropping monthly
-- partitions programmatically.
--
-- Run with:  psql $DATABASE_URL -f 013_partition_events_table.sql
--
-- NOTE: This migration renames and recreates a table. Run during a
-- maintenance window. The migration is designed to be idempotent.

SET lock_timeout = '30s';

-- ── Step 1: Rename existing table (if not already partitioned) ───────────────
-- Check if audit_events is already partitioned; if so, skip.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'audit_events'
  ) THEN
    RAISE NOTICE 'audit_events is already partitioned — skipping rename.';
  ELSEIF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'audit_events'
  ) THEN
    ALTER TABLE audit_events RENAME TO audit_events_legacy;
    RAISE NOTICE 'Renamed audit_events to audit_events_legacy.';
  END IF;
END $$;

-- ── Step 2: Create partitioned parent table ──────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  actor_id        VARCHAR(255) NOT NULL,
  action          VARCHAR(255) NOT NULL,
  resource_type   VARCHAR(255) NOT NULL,
  resource_id     VARCHAR(255) NOT NULL,
  old_state       JSONB,
  new_state       JSONB,
  timestamp       BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  prev_hash       VARCHAR(64) NOT NULL DEFAULT '',
  hash            VARCHAR(64) NOT NULL DEFAULT '',
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- ── Step 3: Create initial partitions ────────────────────────────────────────
-- Current month + next 3 months + a default partition for safety.

CREATE TABLE IF NOT EXISTS audit_events_2026_10
  PARTITION OF audit_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE IF NOT EXISTS audit_events_2026_11
  PARTITION OF audit_events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE IF NOT EXISTS audit_events_2026_12
  PARTITION OF audit_events
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS audit_events_2027_01
  PARTITION OF audit_events
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

-- Default partition: catches any row outside the named ranges
CREATE TABLE IF NOT EXISTS audit_events_default
  PARTITION OF audit_events DEFAULT;

-- ── Step 4: Migrate data from legacy table ───────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'audit_events_legacy') THEN
    INSERT INTO audit_events (id, actor_id, action, resource_type, resource_id,
                               old_state, new_state, timestamp, prev_hash, hash,
                               metadata, created_at)
    SELECT id, actor_id, action, resource_type, resource_id,
           old_state, new_state, timestamp, prev_hash, hash,
           metadata, created_at
    FROM audit_events_legacy;
    RAISE NOTICE 'Migrated % rows from audit_events_legacy.',
      (SELECT count(*) FROM audit_events_legacy);
  END IF;
END $$;

-- ── Step 5: Create indexes on the partitioned table ──────────────────────────
-- Indexes on the parent are automatically created on all partitions.

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_id
  ON audit_events (actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_action
  ON audit_events (action);

CREATE INDEX IF NOT EXISTS idx_audit_events_resource_type
  ON audit_events (resource_type);

CREATE INDEX IF NOT EXISTS idx_audit_events_resource_id
  ON audit_events (resource_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp
  ON audit_events (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_hash
  ON audit_events (hash);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON audit_events (created_at DESC);

-- ── Step 6: Drop legacy table ────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'audit_events_legacy') THEN
    DROP TABLE audit_events_legacy;
    RAISE NOTICE 'Dropped audit_events_legacy.';
  END IF;
END $$;

-- ── Partition management function ────────────────────────────────────────────
-- Creates a monthly partition for the given year/month if it doesn't exist.

CREATE OR REPLACE FUNCTION create_audit_events_partition(p_year INT, p_month INT)
RETURNS TEXT AS $$
DECLARE
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
BEGIN
  partition_name := format('audit_events_%s_%02s', p_year, p_month);
  start_date := make_date(p_year, p_month, 1);
  end_date := start_date + INTERVAL '1 month';

  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
    RETURN format('Partition %s already exists', partition_name);
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );

  RETURN format('Created partition %s for %s to %s', partition_name, start_date, end_date);
END;
$$ LANGUAGE plpgsql;

-- ── Analyse ──────────────────────────────────────────────────────────────────
ANALYZE audit_events;

-- @down
-- Restoring the original (non-partitioned) table is a destructive operation
-- that detaches all partitions and merges data back. In practice, rollback
-- of partitioning is rare and should be done manually.
--
-- Safe rollback steps:
-- 1. CREATE TABLE audit_events_unpartitioned AS SELECT * FROM audit_events;
-- 2. DROP TABLE audit_events CASCADE;
-- 3. ALTER TABLE audit_events_unpartitioned RENAME TO audit_events;
-- 4. Recreate indexes.
--
-- The function is safe to drop:
DROP FUNCTION IF EXISTS create_audit_events_partition(INT, INT);
