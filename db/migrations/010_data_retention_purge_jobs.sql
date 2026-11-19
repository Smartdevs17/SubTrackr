-- ── Migration 010: Data retention and purge jobs (issue #1799) ────────────────
--
-- Creates tables for persistent retention policy storage and an enforcement
-- audit log. The DataRetentionService and RetentionEnforcementJob already exist
-- in backend/gdpr/; this migration adds the database backing store so policies
-- survive restarts and enforcement runs are auditable.
--
-- Tables:
--   retention_policies       — persistent policy definitions (override defaults)
--   retention_enforcement_log — audit trail of every enforcement run
--   retention_legal_holds    — persistent legal holds
--
-- Run with:  psql $DATABASE_URL -f 010_data_retention_purge_jobs.sql

-- ── retention_policies ───────────────────────────────────────────────────────
-- Persistent retention policy definitions. The application loads these on
-- startup and merges with DEFAULT_RETENTION_POLICIES.

CREATE TABLE IF NOT EXISTS retention_policies (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  description     TEXT,
  retention_days  INTEGER NOT NULL CHECK (retention_days >= 1 AND retention_days <= 3650),
  action          TEXT NOT NULL CHECK (action IN ('delete', 'anonymize', 'archive')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  batch_size      INTEGER NOT NULL DEFAULT 1000 CHECK (batch_size >= 1),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retention_policies_source
  ON retention_policies (source) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_retention_policies_enabled
  ON retention_policies (enabled);

-- ── retention_enforcement_log ─────────────────────────────────────────────────
-- Append-only audit trail of every enforcement run. One row per policy per run.

CREATE TABLE IF NOT EXISTS retention_enforcement_log (
  id                  BIGSERIAL PRIMARY KEY,
  run_id              UUID NOT NULL,
  policy_id           TEXT NOT NULL,
  source              TEXT NOT NULL,
  action              TEXT NOT NULL,
  cutoff              TIMESTAMPTZ NOT NULL,
  expired_found       INTEGER NOT NULL DEFAULT 0,
  skipped_legal_hold  INTEGER NOT NULL DEFAULT 0,
  processed           INTEGER NOT NULL DEFAULT 0,
  error               TEXT,
  dry_run             BOOLEAN NOT NULL DEFAULT false,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_retention_log_run_id
  ON retention_enforcement_log (run_id);

CREATE INDEX IF NOT EXISTS idx_retention_log_policy_id
  ON retention_enforcement_log (policy_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_retention_log_started_at
  ON retention_enforcement_log (started_at DESC);

-- ── retention_legal_holds ─────────────────────────────────────────────────────
-- Persistent legal holds that survive application restarts.

CREATE TABLE IF NOT EXISTS retention_legal_holds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT NOT NULL CHECK (scope IN ('user', 'record')),
  target_id   TEXT NOT NULL,
  source      TEXT,
  reason      TEXT NOT NULL,
  placed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_retention_holds_active
  ON retention_legal_holds (target_id, source) WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_retention_holds_scope
  ON retention_legal_holds (scope, target_id) WHERE released_at IS NULL;

-- ── Seed default policies ─────────────────────────────────────────────────────
-- Insert the application defaults so they are visible in the database. The
-- application's DataRetentionService merges these with any runtime overrides.

INSERT INTO retention_policies (id, source, description, retention_days, action, enabled, batch_size)
VALUES
  ('deactivated-account-logs', 'activity_logs',
   'Activity logs of deactivated accounts', 90, 'delete', true, 1000),
  ('notification-history', 'notifications',
   'Delivered notification history', 180, 'delete', true, 1000),
  ('billing-records', 'billing_records',
   'Invoices and payment records (kept for tax and accounting)', 2555, 'anonymize', true, 500),
  ('audit-logs', 'audit_logs',
   'Security and compliance audit trail', 2555, 'archive', true, 500)
ON CONFLICT (id) DO NOTHING;

-- ── Analyse tables ───────────────────────────────────────────────────────────
ANALYZE retention_policies;
ANALYZE retention_enforcement_log;
ANALYZE retention_legal_holds;

-- @down
DROP TABLE IF EXISTS retention_legal_holds;
DROP TABLE IF EXISTS retention_enforcement_log;
DROP TABLE IF EXISTS retention_policies;
