-- ── Migration 001: Base table indexes (pg_stat_statements optimisation) ────────
--
-- Adds indexes that address the top 5 slowest query patterns identified from
-- pg_stat_statements on the normalised subscription ledger tables.
--
-- Run with:  psql $DATABASE_URL -f 001_base_indexes.sql

-- ── subscriptions ────────────────────────────────────────────────────────────

-- Dashboard query: active subscriptions by user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_user_status
  ON subscriptions (user_id, status)
  WHERE status = 'active';

-- Billing jobs: find all subscriptions due before a date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_next_billing
  ON subscriptions (next_billing_date)
  WHERE status = 'active';

-- Status filter scans
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_status
  ON subscriptions (status, created_at DESC);

-- ── transactions ─────────────────────────────────────────────────────────────

-- Ledger history by subscription (most frequent join pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_subscription_ts
  ON transactions (subscription_id, timestamp DESC);

-- User-level transaction history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_user_ts
  ON transactions (user_id, timestamp DESC);

-- Status scan for dunning jobs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_status
  ON transactions (status, timestamp DESC);

-- ── Analyse updated tables ───────────────────────────────────────────────────
ANALYZE subscriptions;
ANALYZE transactions;
