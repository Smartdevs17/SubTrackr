-- Migration: Add merchant gateway configuration (Issue #581)
-- Stores per-merchant payment gateway selection and fallback chain.

BEGIN;

-- Merchant gateway configuration table
CREATE TABLE IF NOT EXISTS merchant_gateway_configs (
  id              BIGSERIAL PRIMARY KEY,
  merchant_id     TEXT NOT NULL UNIQUE,
  primary_gateway TEXT NOT NULL CHECK (primary_gateway IN ('stripe', 'circle', 'stellar')),
  secondary_gateway TEXT NOT NULL CHECK (secondary_gateway IN ('stripe', 'circle', 'stellar')),
  tertiary_gateway TEXT CHECK (tertiary_gateway IN ('stripe', 'circle', 'stellar')),
  fallback_on_failure BOOLEAN NOT NULL DEFAULT true,
  retry_attempts  INTEGER NOT NULL DEFAULT 3,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT different_primary_secondary CHECK (primary_gateway != secondary_gateway),
  CONSTRAINT different_tertiary CHECK (
    tertiary_gateway IS NULL OR
    (tertiary_gateway != primary_gateway AND tertiary_gateway != secondary_gateway)
  )
);

CREATE INDEX IF NOT EXISTS idx_merchant_gateway_config_merchant ON merchant_gateway_configs(merchant_id);

-- Transactional outbox for failed gateway attempts (retry queue)
CREATE TABLE IF NOT EXISTS gateway_failed_attempts (
  id              BIGSERIAL PRIMARY KEY,
  merchant_id     TEXT NOT NULL,
  gateway_used    TEXT NOT NULL,
  request_type    TEXT NOT NULL CHECK (request_type IN ('charge', 'refund', 'payout')),
  request_payload JSONB NOT NULL,
  error_message   TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 1,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gateway_failed_status ON gateway_failed_attempts(status);
CREATE INDEX IF NOT EXISTS idx_gateway_failed_next_retry ON gateway_failed_attempts(next_retry_at);

COMMIT;
