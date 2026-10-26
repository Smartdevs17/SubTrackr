-- ── Migration 009: Index audit — hot query coverage gaps (issue #1798) ────────
--
-- Adds indexes identified by `node scripts/db-index-audit.js` for query patterns
-- in backend/services, backend/graphql, and backend/notification that had no
-- matching index.
--
-- All indexes are created CONCURRENTLY and IF NOT EXISTS so this migration is
-- safe to run online against a populated database without blocking writes.
--
-- Run with:  psql $DATABASE_URL -f 009_index_audit_hot_queries.sql
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Do not
-- wrap this file in BEGIN/COMMIT.

-- ── users ────────────────────────────────────────────────────────────────────
--
-- Query (backend/services/repositories/postgres.ts:382):
--   SELECT ... FROM users WHERE address = $1 LIMIT 1
--
-- Wallet-address lookup for login / identity resolution. No existing index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_address
  ON users (address);

-- Query (backend/services/repositories/postgres.ts:391):
--   SELECT ... FROM users WHERE email = $1 LIMIT 1
--
-- Email lookup for passwordless auth / notification routing. No existing index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email
  ON users (email);

-- ── merchants ────────────────────────────────────────────────────────────────
--
-- Query (backend/services/repositories/postgres.ts:470):
--   SELECT ... FROM merchants WHERE merchant_address = $1 LIMIT 1
--
-- Merchant on-chain address lookup. No existing index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_merchant_address
  ON merchants (merchant_address);

-- Query (backend/services/repositories/postgres.ts:481):
--   SELECT ... FROM merchants WHERE status = $1
--
-- Status filter for admin / verification dashboards. No existing index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_status
  ON merchants (status);

-- ── loyalty ──────────────────────────────────────────────────────────────────
--
-- Query (backend/services/repositories/postgres.ts:570):
--   SELECT ... FROM loyalty WHERE subscriber_id = $1 LIMIT 1
--
-- Per-subscriber loyalty lookup. No existing index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loyalty_subscriber_id
  ON loyalty (subscriber_id);

-- Query (backend/services/repositories/postgres.ts:582):
--   SELECT ... FROM loyalty ORDER BY points DESC LIMIT $1
--
-- Leaderboard top-N query. A DESC index on points avoids a sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loyalty_points_desc
  ON loyalty (points DESC);

-- ── subscriptions ──────────────────────────────────────────────────────────────
--
-- Query (backend/graphql/resolvers.ts:71):
--   SELECT ... FROM subscriptions s
--   WHERE s.user_id = $1 [AND created_at < :sortValue ...]
--   ORDER BY created_at DESC, id LIMIT $n
--
-- Keyset pagination on created_at. The existing idx_subscriptions_status has
-- created_at as the trailing column (behind status), so it cannot serve an
-- ORDER BY created_at without a status filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_created_at
  ON subscriptions (created_at DESC);

-- ── user_devices ──────────────────────────────────────────────────────────────
--
-- Query (backend/notification/NotificationServiceImpl.ts):
--   SELECT ... FROM user_devices WHERE user_id = $1
--
-- Per-user device lookup for push notification targeting. No existing index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_devices_user_id
  ON user_devices (user_id);

-- ── usage_alerts ───────────────────────────────────────────────────────────────
--
-- Query (backend/notification/controller/usageAlertsController.ts:144):
--   SELECT ... FROM usage_alerts
--   WHERE subscription_id = $1 AND created_at > $2
--   ORDER BY created_at DESC LIMIT 100
--
-- The existing idx_alerts_created is a partial index (WHERE cooldown_until > …)
-- that does not cover all created_at range scans. A non-partial index on
-- created_at DESC serves the general range + ORDER BY.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_alerts_created_at
  ON usage_alerts (created_at DESC);

-- ── usage_alert_configs ────────────────────────────────────────────────────────
--
-- Query (backend/notification/controller/usageAlertsController.ts):
--   SELECT ... FROM usage_alert_configs WHERE subscription_id = $1
--
-- The table has a UNIQUE(subscription_id) constraint which creates an implicit
-- index, but we add an explicit one for clarity and to support future
-- multi-column extensions.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_alert_configs_subscription
  ON usage_alert_configs (subscription_id);

-- ── Analyse updated tables ───────────────────────────────────────────────────
ANALYZE users;
ANALYZE merchants;
ANALYZE loyalty;
ANALYZE subscriptions;
ANALYZE user_devices;
ANALYZE usage_alerts;
ANALYZE usage_alert_configs;

-- ── Write-overhead / maintenance notes ──────────────────────────────────────
--
-- * idx_users_address / idx_users_email      — users is low-write (registrations
--   and profile updates). Negligible overhead.
-- * idx_merchants_merchant_address / status  — merchants is low-write. Negligible.
-- * idx_loyalty_subscriber_id / points_desc  — loyalty is updated on each
--   points accrual. Two narrow indexes; monitor write latency.
-- * idx_subscriptions_created_at             — subscriptions is moderate-write
--   (status changes, billing updates). One extra index write per update.
-- * idx_user_devices_user_id                 — user_devices is low-write (device
--   registration). Negligible.
-- * idx_usage_alerts_created_at              — usage_alerts is append-mostly.
--   One extra index write per insert.
-- * idx_usage_alert_configs_subscription     — Low-write config table.
--   Negligible. (Redundant with UNIQUE constraint index but explicit for
--   future composite extensions; safe to drop if storage is a concern.)
--
-- Run `node scripts/db-index-audit.js` after applying to verify zero gaps.

-- @down
DROP INDEX CONCURRENTLY IF EXISTS idx_usage_alert_configs_subscription;
DROP INDEX CONCURRENTLY IF EXISTS idx_usage_alerts_created_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_user_devices_user_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_subscriptions_created_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_loyalty_points_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_loyalty_subscriber_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_merchants_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_merchants_merchant_address;
DROP INDEX CONCURRENTLY IF EXISTS idx_users_email;
DROP INDEX CONCURRENTLY IF EXISTS idx_users_address;
