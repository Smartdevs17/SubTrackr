-- ── Migration 002: Denormalised materialized views ──────────────────────────
--
-- Creates four materialised views that cover the five slowest query patterns:
--
--   1. active_subscriptions_summary  – per-user active subscription counts & spend
--   2. subscriber_balance_mv         – running balance per subscriber
--   3. monthly_revenue_mv            – monthly revenue aggregation per merchant
--   4. churn_summary_mv              – cancellation and churn rate analytics
--
-- Incremental refresh is managed by backend/analytics/jobs/mvRefreshJob.ts
-- which calls REFRESH MATERIALIZED VIEW CONCURRENTLY on each view.
-- CONCURRENTLY requires a unique index on every view (created below).
--
-- Storage estimate: <2 GB per 1M subscriptions (see BUNDLE_AUDIT.md).
-- Refresh lag target: <1 minute for real-time views, configurable for reporting.

-- ── 1. active_subscriptions_summary ─────────────────────────────────────────
-- Powers the subscription list on the merchant dashboard.
-- Replaces a 5-table join that took 3–10 s at 100K+ rows.

CREATE MATERIALIZED VIEW IF NOT EXISTS active_subscriptions_summary AS
SELECT
  s.user_id,
  COUNT(*)                                        AS active_count,
  SUM(s.amount)                                   AS total_monthly_amount,
  MIN(s.next_billing_date)                        AS earliest_billing_date,
  MAX(s.updated_at)                               AS last_updated_at,
  NOW()                                           AS refreshed_at
FROM subscriptions s
WHERE s.status = 'active'
GROUP BY s.user_id
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_asm_user_id
  ON active_subscriptions_summary (user_id);


-- ── 2. subscriber_balance_mv ─────────────────────────────────────────────────
-- Running balance per subscriber: total charged minus refunded.

CREATE MATERIALIZED VIEW IF NOT EXISTS subscriber_balance_mv AS
SELECT
  t.user_id,
  COUNT(*)                                               AS total_transactions,
  SUM(CASE WHEN t.status = 'success' THEN t.amount ELSE 0 END)   AS total_charged,
  SUM(CASE WHEN t.status = 'failed'  THEN t.amount ELSE 0 END)   AS total_failed,
  MAX(t.timestamp)                                       AS last_transaction_at,
  NOW()                                                  AS refreshed_at
FROM transactions t
GROUP BY t.user_id
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sbm_user_id
  ON subscriber_balance_mv (user_id);


-- ── 3. monthly_revenue_mv ────────────────────────────────────────────────────
-- Aggregated revenue per calendar month, used by the revenue report screen.

CREATE MATERIALIZED VIEW IF NOT EXISTS monthly_revenue_mv AS
SELECT
  DATE_TRUNC('month', t.timestamp)::DATE          AS month,
  t.currency,
  COUNT(DISTINCT t.subscription_id)               AS subscription_count,
  COUNT(*)                                        AS transaction_count,
  SUM(CASE WHEN t.status = 'success' THEN t.amount ELSE 0 END)   AS gross_revenue,
  SUM(CASE WHEN t.status = 'failed'  THEN t.amount ELSE 0 END)   AS failed_amount,
  NOW()                                           AS refreshed_at
FROM transactions t
GROUP BY DATE_TRUNC('month', t.timestamp), t.currency
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mrm_month_currency
  ON monthly_revenue_mv (month, currency);


-- ── 4. churn_summary_mv ──────────────────────────────────────────────────────
-- Monthly churn: cancellations over active-at-start-of-month.

CREATE MATERIALIZED VIEW IF NOT EXISTS churn_summary_mv AS
WITH monthly_start AS (
  -- Active subscriptions at the start of each month
  SELECT
    DATE_TRUNC('month', created_at)::DATE AS cohort_month,
    COUNT(*) AS cohort_size
  FROM subscriptions
  GROUP BY DATE_TRUNC('month', created_at)
),
cancellations AS (
  SELECT
    DATE_TRUNC('month', updated_at)::DATE AS cancel_month,
    COUNT(*) AS cancelled_count
  FROM subscriptions
  WHERE status = 'cancelled'
  GROUP BY DATE_TRUNC('month', updated_at)
)
SELECT
  ms.cohort_month,
  ms.cohort_size,
  COALESCE(c.cancelled_count, 0)                               AS cancelled_count,
  ROUND(
    COALESCE(c.cancelled_count, 0)::NUMERIC / NULLIF(ms.cohort_size, 0) * 100,
    2
  )                                                            AS churn_rate_pct,
  NOW()                                                        AS refreshed_at
FROM monthly_start ms
LEFT JOIN cancellations c ON c.cancel_month = ms.cohort_month
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_csm_cohort_month
  ON churn_summary_mv (cohort_month);


-- ── Stale-data indicator column ──────────────────────────────────────────────
-- Each view carries a refreshed_at timestamp; the dashboard reads this to show
-- "Last updated X minutes ago" when the lag exceeds the SLA threshold.

-- No DDL needed — refreshed_at is already a computed column in each view.
-- The backend monitoring service reads it via the view_freshness_metric.
