-- Migration: Add API key rotation support (Issue #603)
-- Adds rotation fields to the api_keys table and creates rotation history.

BEGIN;

-- Add rotation fields to api_keys table
ALTER TABLE IF EXISTS api_keys
  ADD COLUMN IF NOT EXISTS key_prefix TEXT,
  ADD COLUMN IF NOT EXISTS key_hash TEXT,
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rotation_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_rotated_by TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked'));

-- API key rotation history table
CREATE TABLE IF NOT EXISTS api_key_rotation_history (
  id              BIGSERIAL PRIMARY KEY,
  key_id          TEXT NOT NULL,
  merchant_id     TEXT NOT NULL,
  previous_key_hash TEXT NOT NULL,
  new_key_hash    TEXT NOT NULL,
  rotation_type   TEXT NOT NULL CHECK (rotation_type IN ('scheduled', 'manual', 'force')),
  rotated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  grace_period_end TIMESTAMPTZ,
  rotated_by      TEXT,
  metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_api_key_rotation_key_id ON api_key_rotation_history(key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_rotation_merchant ON api_key_rotation_history(merchant_id);
CREATE INDEX IF NOT EXISTS idx_api_key_rotation_rotated_at ON api_key_rotation_history(rotated_at);

-- API key rotation policies (per merchant)
CREATE TABLE IF NOT EXISTS api_key_rotation_policies (
  id              BIGSERIAL PRIMARY KEY,
  merchant_id     TEXT NOT NULL UNIQUE,
  interval_days   INTEGER NOT NULL DEFAULT 30 CHECK (interval_days IN (30, 60, 90)),
  grace_period_hours INTEGER NOT NULL DEFAULT 24 CHECK (grace_period_hours BETWEEN 1 AND 72),
  auto_rotate     BOOLEAN NOT NULL DEFAULT true,
  notify_on_rotation BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
