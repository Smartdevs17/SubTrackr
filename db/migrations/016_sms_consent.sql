-- SMS consent ledger (#1747).
-- One current consent record per phone number plus an append-only audit trail,
-- so we can answer "may we text this number, since when, and why".
BEGIN;
CREATE TABLE IF NOT EXISTS sms_consents (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('opted_in', 'opted_out')),
  source TEXT NOT NULL,
  reason TEXT,
  explicit_opt_in BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (phone)
);
CREATE INDEX IF NOT EXISTS idx_sms_consents_user ON sms_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_consents_status ON sms_consents(status);

CREATE TABLE IF NOT EXISTS sms_consent_events (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('opted_in', 'opted_out')),
  source TEXT NOT NULL,
  reason TEXT,
  message_sid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sms_consent_events_phone ON sms_consent_events(phone, created_at);
COMMIT;

-- @down
BEGIN;
DROP TABLE IF EXISTS sms_consent_events;
DROP TABLE IF EXISTS sms_consents;
COMMIT;
