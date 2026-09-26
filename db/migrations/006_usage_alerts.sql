-- ── Migration: Usage Threshold Alerting Tables ────────────────────────────────
--
-- Tables to support usage-based billing with threshold alerts:
-- - usage_metrics: current usage per meter (denormalized from events)
-- - usage_alert_configs: per-subscription alert thresholds & channels
-- - usage_alerts: audit log of alerts sent
-- - overage_approvals: in-app prompts to auto-enable overage billing
--
-- Run with:  psql $DATABASE_URL -f 006_usage_alerts.sql

-- ── usage_metrics ─────────────────────────────────────────────────────────────
-- Denormalized view of current usage per meter per subscription.
-- Updated incrementally as usage events arrive.

CREATE TABLE IF NOT EXISTS usage_metrics (
  id BIGSERIAL PRIMARY KEY,
  subscription_id UUID NOT NULL,
  user_id UUID NOT NULL,
  meter_id VARCHAR(255) NOT NULL,
  current_usage BIGINT NOT NULL DEFAULT 0,
  plan_limit BIGINT NOT NULL,
  billing_period_start BIGINT NOT NULL,
  billing_period_end BIGINT NOT NULL,
  last_updated_at BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(subscription_id, meter_id),
  CONSTRAINT fk_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_metrics_subscription
  ON usage_metrics(subscription_id)
  WHERE current_usage > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_metrics_updated
  ON usage_metrics(last_updated_at DESC);

-- ── usage_alert_configs ──────────────────────────────────────────────────────
-- Per-subscription threshold and notification channel configuration.

CREATE TABLE IF NOT EXISTS usage_alert_configs (
  id BIGSERIAL PRIMARY KEY,
  subscription_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  meter_id VARCHAR(255) NOT NULL,
  plan_limit BIGINT NOT NULL,
  thresholds JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- thresholds: [{ level: 50|75|90|100, enabled: bool }, ...]
  channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- channels: ['in_app' | 'email' | 'push' | 'sms']
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  CONSTRAINT fk_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alert_configs_enabled
  ON usage_alert_configs(enabled, subscription_id);

-- ── usage_alerts ─────────────────────────────────────────────────────────────
-- Audit log: every time an alert is sent, record it here.
-- Used for cooldown tracking and alert history.

CREATE TABLE IF NOT EXISTS usage_alerts (
  id VARCHAR(255) PRIMARY KEY,
  subscription_id UUID NOT NULL,
  user_id UUID NOT NULL,
  meter_id VARCHAR(255) NOT NULL,
  threshold_level SMALLINT NOT NULL, -- 50, 75, 90, 100
  current_usage BIGINT NOT NULL,
  "limit" BIGINT NOT NULL,
  burned_rate DECIMAL(12, 2) NOT NULL,
  projected_completion BIGINT NOT NULL,
  cooldown_until BIGINT,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_subscription_level
  ON usage_alerts(subscription_id, threshold_level, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_created
  ON usage_alerts(created_at DESC)
  WHERE cooldown_until > EXTRACT(EPOCH FROM now())::BIGINT * 1000;

-- ── overage_approvals ────────────────────────────────────────────────────────
-- Track when users approve or deny in-app prompt to auto-enable overage billing.
-- Used to suppress re-prompting within a time window.

CREATE TABLE IF NOT EXISTS overage_approvals (
  id BIGSERIAL PRIMARY KEY,
  subscription_id UUID NOT NULL,
  user_id UUID NOT NULL,
  approved BOOLEAN NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  expires_at TIMESTAMP DEFAULT (now() + INTERVAL '24 hours'),
  CONSTRAINT fk_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_overage_approvals_user
  ON overage_approvals(user_id, expires_at DESC)
  WHERE expires_at > now();

-- ── Analyze tables ───────────────────────────────────────────────────────────
ANALYZE usage_metrics;
ANALYZE usage_alert_configs;
ANALYZE usage_alerts;
ANALYZE overage_approvals;
