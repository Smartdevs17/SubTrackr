-- ── Migration 010: trigram GIN indexes for subscription search (Issue #2087) ──
--
-- Subscription search currently scans the table with `%term%` ILIKE predicates
-- (backend/elasticsearch/config.ts searchFields) whenever the in-process
-- index is cold or being rebuilt. A B-tree cannot accelerate a leading wildcard,
-- so the tail latency grows linearly with the number of subscriptions.
--
-- pg_trgm GIN indexes turn each ILIKE filter into an index scan. All indexes
-- are created CONCURRENTLY and IF NOT EXISTS so this is safe to apply online.
--
-- Run with (autocommit only):
--   psql $DATABASE_URL -f 010_subscription_search_trigram_gin.sql
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Do not
-- wrap this file in BEGIN/COMMIT and do not apply it through db-migrate-run.js,
-- which wraps every migration in a transaction. pg_trgm is a trusted extension
-- on PostgreSQL 13+, so the database owner may install it; on older servers a
-- superuser must run the CREATE EXTENSION statement once.
--
-- This file lives in backend/prisma/migrations/ per the issue's technical
-- scope and is intentionally not part of the backend/migrations ledger.

SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Ensure the search columns exist ─────────────────────────────────────────────
-- Some deployments store these fields on the subscription row, others derive
-- them from the plan/customer tables. Adding them IF NOT EXISTS keeps the GIN
-- indexes below applicable in both cases without changing existing columns.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS name           TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS description    TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS category       TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS currency       TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS customer_name  TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_name      TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS notes          TEXT;

-- ── subscriptions: free-text search fields ─────────────────────────────────────
--
-- Mapping from the search configuration to snake_case columns:
--   name          -> name           (primary subscription name)
--   description   -> description    (free-text notes)
--   category      -> category       (category filter / fuzzy match)
--   currency      -> currency       (currency filter / fuzzy match)
--   customerName  -> customer_name
--   customerEmail -> customer_email
--   planName      -> plan_name
--   notes         -> notes
--
-- A single-column GIN trigram index supports both `LIKE '%term%'` and
-- `ILIKE '%term%'`; no expression index is required for case-insensitive
-- matching because pg_trgm stores lower-cased trigrams alongside raw ones.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_name_trgm
  ON subscriptions USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_description_trgm
  ON subscriptions USING gin (description gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_category_trgm
  ON subscriptions USING gin (category gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_currency_trgm
  ON subscriptions USING gin (currency gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_customer_name_trgm
  ON subscriptions USING gin (customer_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_customer_email_trgm
  ON subscriptions USING gin (customer_email gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_plan_name_trgm
  ON subscriptions USING gin (plan_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_notes_trgm
  ON subscriptions USING gin (notes gin_trgm_ops);

-- Refresh planner statistics so the new indexes are selected immediately.
ANALYZE subscriptions;

-- ── Write-overhead / maintenance notes ────────────────────────────────────────
--
-- subscriptions is a moderate-write table. Trigram indexes are larger than
-- B-trees (roughly 3 bytes per 3-character sequence) and add work on UPDATE of
-- the indexed columns. Only the eight columns listed in the search config are
-- indexed; do not add more without a corresponding query pattern.
--
-- Verify an ILIKE query uses the index with:
--   EXPLAIN ANALYZE SELECT * FROM subscriptions WHERE name ILIKE '%netflix%';
--
-- @down
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_notes_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_plan_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_customer_email_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_customer_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_currency_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_category_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_description_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_name_trgm;
-- pg_trgm and the search columns are intentionally left in place: other
-- objects may depend on the extension and dropping columns would be a
-- destructive, cross-cutting change. Only the indexes are rolled back.
