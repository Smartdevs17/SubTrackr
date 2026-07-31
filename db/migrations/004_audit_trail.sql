-- ── Migration 004: Tamper-evident audit trail ──────────────────────────────────
--
-- Creates the audit events table with a linked hash chain for tamper-evident
-- logging. Each entry stores SHA-256(prev_hash + event_data) with the previous
-- entry's hash, forming an immutable chain.
--
-- Periodic anchoring to Stellar blockchain is managed by
-- backend/audit/jobs/blockchainAnchorJob.ts.

CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        VARCHAR(255) NOT NULL,
  action          VARCHAR(255) NOT NULL,
  resource_type   VARCHAR(255) NOT NULL,
  resource_id     VARCHAR(255) NOT NULL,
  old_state       JSONB,
  new_state       JSONB,
  timestamp       BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  prev_hash       VARCHAR(64) NOT NULL,
  hash            VARCHAR(64) NOT NULL,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_id
  ON audit_events (actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_action
  ON audit_events (action);

CREATE INDEX IF NOT EXISTS idx_audit_events_resource_type
  ON audit_events (resource_type);

CREATE INDEX IF NOT EXISTS idx_audit_events_resource_id
  ON audit_events (resource_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp
  ON audit_events (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_hash
  ON audit_events (hash);

-- Blockchain anchor records
CREATE TABLE IF NOT EXISTS audit_anchors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_head_hash VARCHAR(64) NOT NULL,
  chain_length    INTEGER NOT NULL,
  stellar_tx_hash VARCHAR(255) NOT NULL,
  anchored_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_anchors_stellar_tx
  ON audit_anchors (stellar_tx_hash);

-- Quarantine table for mismatched entries
CREATE TABLE IF NOT EXISTS audit_quarantine (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID REFERENCES audit_events(id),
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason          TEXT NOT NULL,
  details         JSONB DEFAULT '{}'::jsonb
);
