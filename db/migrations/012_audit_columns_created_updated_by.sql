-- ── Migration 012: Audit columns — created/updated by (issue #1801) ──────────
--
-- Adds `created_by TEXT` and `updated_by TEXT` columns to core entity tables
-- so every row records who created it and who last modified it.
--
-- All ALTERs are ADD COLUMN … NULL so they are instant on Postgres 11+
-- (no table rewrite, no ACCESS EXCLUSIVE lock on data).
--
-- Run with:  psql $DATABASE_URL -f 012_audit_columns_created_updated_by.sql

SET lock_timeout = '30s';

-- ── Core entity tables ───────────────────────────────────────────────────────

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE users        ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE users        ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE merchants    ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE merchants    ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE loyalty      ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE loyalty      ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE plans        ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE plans        ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- ── Indexes for querying by creator/updater ──────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_created_by
  ON subscriptions (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_updated_by
  ON subscriptions (updated_by) WHERE updated_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_created_by
  ON transactions (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_updated_by
  ON transactions (updated_by) WHERE updated_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_by
  ON users (created_by) WHERE created_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_created_by
  ON merchants (created_by) WHERE created_by IS NOT NULL;

-- ── Trigger function: auto-update updated_at and updated_by ─────────────────
-- This trigger fires on UPDATE and sets updated_at = now() automatically.
-- updated_by must be set by the application; the trigger only updates
-- updated_at so the application doesn't have to manage timestamps manually.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_merchants_updated_at ON merchants;
CREATE TRIGGER trg_merchants_updated_at
  BEFORE UPDATE ON merchants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_loyalty_updated_at ON loyalty;
CREATE TRIGGER trg_loyalty_updated_at
  BEFORE UPDATE ON loyalty
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_payment_methods_updated_at ON payment_methods;
CREATE TRIGGER trg_payment_methods_updated_at
  BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Analyse ──────────────────────────────────────────────────────────────────
ANALYZE subscriptions;
ANALYZE transactions;
ANALYZE users;
ANALYZE merchants;
ANALYZE loyalty;
ANALYZE payment_methods;
ANALYZE plans;

-- @down
DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
DROP TRIGGER IF EXISTS trg_payment_methods_updated_at ON payment_methods;
DROP TRIGGER IF EXISTS trg_loyalty_updated_at ON loyalty;
DROP TRIGGER IF EXISTS trg_merchants_updated_at ON merchants;
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
DROP FUNCTION IF EXISTS set_updated_at();
DROP INDEX CONCURRENTLY IF EXISTS idx_merchants_created_by;
DROP INDEX CONCURRENTLY IF EXISTS idx_users_created_by;
DROP INDEX CONCURRENTLY IF EXISTS idx_transactions_updated_by;
DROP INDEX CONCURRENTLY IF EXISTS idx_transactions_created_by;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_updated_by;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_created_by;
ALTER TABLE plans        DROP COLUMN IF EXISTS updated_by;
ALTER TABLE plans        DROP COLUMN IF EXISTS created_by;
ALTER TABLE payment_methods DROP COLUMN IF EXISTS updated_by;
ALTER TABLE payment_methods DROP COLUMN IF EXISTS created_by;
ALTER TABLE loyalty      DROP COLUMN IF EXISTS updated_by;
ALTER TABLE loyalty      DROP COLUMN IF EXISTS created_by;
ALTER TABLE merchants    DROP COLUMN IF EXISTS updated_by;
ALTER TABLE merchants    DROP COLUMN IF EXISTS created_by;
ALTER TABLE users        DROP COLUMN IF EXISTS updated_by;
ALTER TABLE users        DROP COLUMN IF EXISTS created_by;
ALTER TABLE transactions DROP COLUMN IF EXISTS updated_by;
ALTER TABLE transactions DROP COLUMN IF EXISTS created_by;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS updated_by;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS created_by;
