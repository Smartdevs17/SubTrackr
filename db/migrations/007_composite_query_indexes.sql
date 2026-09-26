-- ── Migration 007: Composite query indexes ────────────────────────────────────
--
-- Adds composite indexes for hot read paths that the existing indexes
-- (001_base_indexes.sql, 006_usage_alerts.sql) do not fully cover. Each index
-- is justified by a concrete query in backend/ — see the comment above it.
--
-- All indexes are created CONCURRENTLY and IF NOT EXISTS so this migration is
-- safe to run online against a populated database without blocking writes.
--
-- Run with:  psql $DATABASE_URL -f 007_composite_query_indexes.sql
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Do not
-- wrap this file in BEGIN/COMMIT.

-- ── usage_alerts ───────────────────────────────────────────────────────────────
--
-- Query (backend/alerting/domain/alertingRepository.ts:57 and
--        backend/notification/controller/usageAlertsController.ts:144):
--
--   SELECT * FROM usage_alerts
--   WHERE subscription_id = $1 AND created_at > $2
--   ORDER BY created_at DESC [LIMIT 100]
--
-- The existing idx_alerts_subscription_level is keyed
-- (subscription_id, threshold_level, created_at). Because threshold_level sits
-- between subscription_id and created_at, this query (which does not filter on
-- threshold_level) cannot use the index for the created_at range + ordering and
-- falls back to a filter/sort. A (subscription_id, created_at DESC) composite
-- serves the range scan and the ORDER BY directly.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_subscription_created
  ON usage_alerts (subscription_id, created_at DESC);

-- ── payment_methods ──────────────────────────────────────────────────────────
--
-- Query (backend/graphql/resolvers.ts:257 — paymentMethods resolver, keyset
-- pagination):
--
--   SELECT ... FROM payment_methods
--   WHERE user_id = $1 [AND id > $cursor]
--   ORDER BY id LIMIT $n
--
-- payment_methods has only the primary key on id, so this filters every row for
-- the user and sorts. A (user_id, id) composite makes the keyset page a single
-- ordered range scan with no sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_methods_user_id
  ON payment_methods (user_id, id);

-- ── usage_metrics ──────────────────────────────────────────────────────────────
--
-- Query (backend/alerting/domain/alertingService.ts:130):
--
--   SELECT ... FROM usage_metrics
--   WHERE subscription_id = $1 AND meter_id = $2
--
-- The existing idx_usage_metrics_subscription is single-column and partial
-- (WHERE current_usage > 0), so it cannot satisfy this exact-match lookup for
-- rows with zero usage. A (subscription_id, meter_id) composite turns this into
-- a point lookup.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_metrics_subscription_meter
  ON usage_metrics (subscription_id, meter_id);

-- ── Refresh planner statistics for the affected tables ─────────────────────────
ANALYZE usage_alerts;
ANALYZE payment_methods;
ANALYZE usage_metrics;

-- ── Write-overhead / maintenance notes (Edge) ──────────────────────────────────
--
-- Each composite index adds one B-tree maintained on every INSERT/UPDATE/DELETE
-- to its table and consumes storage proportional to row count * key width:
--
--   * idx_alerts_subscription_created       — usage_alerts is append-mostly
--     (alerts are inserted, rarely updated). One extra index write per insert.
--   * idx_payment_methods_user_id           — payment_methods is low-write
--     (a user has a handful of methods). Negligible write overhead.
--   * idx_usage_metrics_subscription_meter  — usage_metrics is updated on each
--     metering tick. This is the highest-write table here; the index is narrow
--     (two columns) to keep the per-write cost small. Monitor write latency
--     after deploy and drop if it regresses (see db/QUERY_OPTIMIZATION.md).
--
-- None of these indexes duplicate an existing one; verify with the audit query
-- in db/QUERY_OPTIMIZATION.md before and after applying.
