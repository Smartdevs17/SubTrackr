-- Customer tax exemption flags (issue #1740)
-- One row per customer holding their tax-exempt status, exemption
-- certificate metadata, and the jurisdictions the exemption covers
-- (empty list = exempt in every jurisdiction).
--
-- No FK to customers on purpose: the customer key is whatever identifier
-- the caller uses (invoice customer email or an explicit subscriber id),
-- mirroring how invoices are keyed today by email alone.
--
-- Also flags generated invoices as tax-exempt so an exemption applied at
-- invoice time is visible on the persisted document itself.

CREATE TABLE IF NOT EXISTS customer_tax_status (
  customer_id          TEXT        PRIMARY KEY,
  is_exempt            BOOLEAN     NOT NULL DEFAULT false,
  certificate_id       TEXT        NOT NULL DEFAULT '',
  certificate_expiry   BIGINT      NOT NULL DEFAULT 0 CHECK (certificate_expiry >= 0),
  issuing_authority    TEXT        NOT NULL DEFAULT '',
  exempt_jurisdictions TEXT[]      NOT NULL DEFAULT '{}',
  updated_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE customer_tax_status IS 'Per-customer tax exemption flag, certificate metadata, and covered jurisdictions (issue #1740)';
COMMENT ON COLUMN customer_tax_status.certificate_expiry IS 'Exemption certificate expiry as epoch milliseconds; 0 means no expiry';
COMMENT ON COLUMN customer_tax_status.exempt_jurisdictions IS 'Jurisdiction keys the exemption covers; empty array means all jurisdictions';

ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS is_tax_exempt BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN invoices.is_tax_exempt IS 'Whether the customer was tax-exempt when this invoice was generated (issue #1740)';

-- @down
ALTER TABLE IF EXISTS invoices DROP COLUMN IF EXISTS is_tax_exempt;
DROP TABLE IF EXISTS customer_tax_status;
