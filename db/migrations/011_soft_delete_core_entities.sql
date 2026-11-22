-- ── Migration 011: Soft-delete pattern for core entities (issue #1800) ────────
--
-- Adds a `deleted_at TIMESTAMPTZ` column to core entity tables so deletes
-- are reversible. A NULL value means the row is active; a timestamp means
-- the row has been soft-deleted.
--
-- All ALTERs are ADD COLUMN … NULL DEFAULT NULL so they are instant on
-- Postgres 11+ (no table rewrite, no ACCESS EXCLUSIVE lock on data).
--
-- Run with:  psql $DATABASE_URL -f 011_soft_delete_core_entities.sql

SET lock_timeout = '30s';

-- ── Core entity tables ───────────────────────────────────────────────────────

ALTER TABLE subscriptions  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE transactions  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE merchants     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE loyalty       ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE plans         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ── Partial index: filter active (non-deleted) rows fast ─────────────────────
-- These indexes let queries like `WHERE deleted_at IS NULL AND …` use an
-- index scan instead of filtering after a seq scan.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_active
  ON subscriptions (id) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_active
  ON transactions (id) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active
  ON users (id) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_active
  ON merchants (id) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loyalty_active
  ON loyalty (id) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_methods_active
  ON payment_methods (id) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plans_active
  ON plans (id) WHERE deleted_at IS NULL;

-- ── Index for finding soft-deleted rows (for restore / purge) ────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_deleted_at
  ON subscriptions (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_deleted_at
  ON transactions (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_deleted_at
  ON users (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_deleted_at
  ON merchants (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loyalty_deleted_at
  ON loyalty (deleted_at) WHERE deleted_at IS NOT NULL;

-- ── Analyse ──────────────────────────────────────────────────────────────────
ANALYZE subscriptions;
ANALYZE transactions;
ANALYZE users;
ANALYZE merchants;
ANALYZE loyalty;
ANALYZE payment_methods;
ANALYZE plans;

-- @down
DROP INDEX CONCURRENTLY IF EXISTS idx_loyalty_deleted_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_merchants_deleted_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_users_deleted_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_transactions_deleted_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_deleted_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_plans_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_payment_methods_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_loyalty_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_merchants_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_users_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_transactions_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_active;
ALTER TABLE plans         DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE payment_methods DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE loyalty       DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE merchants     DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE users         DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE transactions  DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS deleted_at;
