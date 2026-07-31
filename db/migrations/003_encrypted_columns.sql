-- Migration: Add encrypted column support for PII fields (Issue #604)
-- Converts plaintext PII columns to bytea for encrypted storage.
-- Uses AES-256-GCM envelope encryption managed by ColumnEncryptionService.

BEGIN;

-- Add encrypted column variants for PII fields in the users table
ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS email_encrypted bytea,
  ADD COLUMN IF NOT EXISTS name_encrypted bytea,
  ADD COLUMN IF NOT EXISTS phone_encrypted bytea,
  ADD COLUMN IF NOT EXISTS address_encrypted bytea;

-- Add encrypted column variants for merchant records
ALTER TABLE IF EXISTS merchant_records
  ADD COLUMN IF NOT EXISTS business_name_encrypted bytea,
  ADD COLUMN IF NOT EXISTS business_address_encrypted bytea,
  ADD COLUMN IF NOT EXISTS contact_email_encrypted bytea,
  ADD COLUMN IF NOT EXISTS contact_phone_encrypted bytea;

-- Add encrypted column variants for subscriptions (subscriber PII)
ALTER TABLE IF EXISTS subscriptions
  ADD COLUMN IF NOT EXISTS subscriber_email_encrypted bytea,
  ADD COLUMN IF NOT EXISTS subscriber_name_encrypted bytea,
  ADD COLUMN IF NOT EXISTS subscriber_phone_encrypted bytea;

-- Encryption key management table
CREATE TABLE IF NOT EXISTS encryption_keys (
  id          TEXT PRIMARY KEY,
  key_type    TEXT NOT NULL CHECK (key_type IN ('kek', 'dek')),
  algorithm   TEXT NOT NULL DEFAULT 'aes-256-gcm',
  provider    TEXT NOT NULL DEFAULT 'kms',
  key_ref     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotating', 'retired', 'compromised')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at  TIMESTAMPTZ,
  retired_at  TIMESTAMPTZ,
  created_by  TEXT
);

-- Encryption audit log
CREATE TABLE IF NOT EXISTS encryption_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  key_id      TEXT REFERENCES encryption_keys(id),
  action      TEXT NOT NULL CHECK (action IN ('encrypt', 'decrypt', 'rotate', 'reencrypt', 'key_create', 'key_retire')),
  status      TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  reason      TEXT,
  row_id      TEXT,
  table_name  TEXT,
  performed_by TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_encryption_audit_key_id ON encryption_audit_log(key_id);
CREATE INDEX IF NOT EXISTS idx_encryption_audit_performed_at ON encryption_audit_log(performed_at);

COMMIT;
