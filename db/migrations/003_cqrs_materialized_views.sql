-- ── Migration 003: CQRS materialized views ─────────────────────────────────────
--
-- Denormalized materialized views for the CQRS query model.
-- Reads from these views; writes go to normalized base tables.
--
-- Views:
--   1. mrr_mv                – Monthly Recurring Revenue breakdown
--   2. cohort_retention_mv   – Cohort-based retention analysis
--   3. ltv_mv                – Lifetime Value percentiles
--
-- Refresh managed by backend/analytics/jobs/mvRefreshJob.ts with per-view
-- scheduling (5 min for real-time, 1h for daily, 24h for monthly).

-- ── 1. mrr_mv ──────────────────────────────────────────────────────────────────
-- Monthly Recurring Revenue with churn, upgrades, downgrades.

CREATE MATERIALIZED VIEW IF NOT EXISTS mrr_mv AS
WITH monthly_data AS (
  SELECT
    DATE_TRUNC('month', s.created_at)::DATE AS month,
    SUM(CASE WHEN s.status = 'active' THEN s.amount ELSE 0 END) AS mrr,
    COUNT(DISTINCT CASE WHEN DATE_TRUNC('month', s.created_at) = DATE_TRUNC('month', s.updated_at)
      THEN s.id END) AS new_subs
  FROM subscriptions s
  GROUP BY DATE_TRUNC('month', s.created_at)
),
up_down AS (
  SELECT
    DATE_TRUNC('month', s.updated_at)::DATE AS month,
    SUM(CASE WHEN s.amount > lag(s.amount) OVER (PARTITION BY s.id ORDER BY s.updated_at)
      THEN s.amount - lag(s.amount) OVER (PARTITION BY s.id ORDER BY s.updated_at) ELSE 0 END) AS upgrades,
    SUM(CASE WHEN s.amount < lag(s.amount) OVER (PARTITION BY s.id ORDER BY s.updated_at)
      THEN lag(s.amount) OVER (PARTITION BY s.id ORDER BY s.updated_at) - s.amount ELSE 0 END) AS downgrades
  FROM subscriptions s
  WHERE s.status = 'active'
  GROUP BY DATE_TRUNC('month', s.updated_at)
)
SELECT
  md.month,
  md.mrr,
  md.new_subs AS new_subscriptions,
  COALESCE(ud.upgrades, 0) AS upgrades,
  COALESCE(ud.downgrades, 0) AS downgrades,
  COALESCE(c.cancelled_count, 0) AS churn,
  NOW() AS refreshed_at
FROM monthly_data md
LEFT JOIN up_down ud ON ud.month = md.month
LEFT JOIN (
  SELECT
    DATE_TRUNC('month', cancelled_at)::DATE AS month,
    COUNT(*) AS cancelled_count
  FROM subscriptions
  WHERE status = 'cancelled'
  GROUP BY DATE_TRUNC('month', cancelled_at)
) c ON c.month = md.month
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mrr_mv_month
  ON mrr_mv (month);


-- ── 2. cohort_retention_mv ─────────────────────────────────────────────────────
-- Period-over-period retention per subscription cohort.

CREATE MATERIALIZED VIEW IF NOT EXISTS cohort_retention_mv AS
WITH cohorts AS (
  SELECT
    id,
    user_id,
    DATE_TRUNC('month', created_at)::DATE AS cohort_month
  FROM subscriptions
),
periods AS (
  SELECT
    c.cohort_month AS cohort,
    FLOOR(EXTRACT(DAY FROM (s.updated_at - c.cohort_month)) / 30)::INTEGER AS period,
    COUNT(DISTINCT s.id) AS retained
  FROM subscriptions s
  JOIN cohorts c ON c.id = s.id
  WHERE s.status IN ('active', 'cancelled')
    AND s.updated_at >= c.cohort_month
  GROUP BY c.cohort_month, period
)
SELECT
  cohort,
  period,
  retained,
  FIRST_VALUE(retained) OVER (PARTITION BY cohort ORDER BY period) AS cohort_size,
  ROUND(
    retained::NUMERIC / NULLIF(FIRST_VALUE(retained) OVER (PARTITION BY cohort ORDER BY period), 0) * 100,
    2
  ) AS retention_pct,
  NOW() AS refreshed_at
FROM periods
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_cohort_period
  ON cohort_retention_mv (cohort, period);


-- ── 3. ltv_mv ──────────────────────────────────────────────────────────────────
-- Lifetime Value percentiles per monthly cohort.

CREATE MATERIALIZED VIEW IF NOT EXISTS ltv_mv AS
SELECT
  DATE_TRUNC('month', s.created_at)::DATE AS month,
  ROUND(AVG(s.total_paid), 2) AS average_ltv,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.total_paid), 2) AS median_ltv,
  ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY s.total_paid), 2) AS p25_ltv,
  ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY s.total_paid), 2) AS p75_ltv,
  NOW() AS refreshed_at
FROM (
  SELECT
    s.id,
    s.created_at,
    COALESCE(SUM(t.amount), 0) AS total_paid
  FROM subscriptions s
  LEFT JOIN transactions t ON t.subscription_id = s.id AND t.status = 'success'
  GROUP BY s.id, s.created_at
) s
GROUP BY DATE_TRUNC('month', s.created_at)
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ltv_mv_month
  ON ltv_mv (month);


-- ── Per-view freshness tracking ────────────────────────────────────────────────
-- Configurable refresh intervals used by the MVRefreshJob scheduler.
-- Refresh frequency: 5 min for real-time, 1h for daily, 24h for monthly.

COMMENT ON MATERIALIZED VIEW mrr_mv IS 'MRR view - refresh every 5 minutes';
COMMENT ON MATERIALIZED VIEW cohort_retention_mv IS 'Cohort retention view - refresh every 1 hour';
COMMENT ON MATERIALIZED VIEW ltv_mv IS 'LTV view - refresh every 24 hours';
