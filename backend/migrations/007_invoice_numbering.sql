-- Invoice numbering schemes (issue #1738)
-- One row per merchant: the merchant's numbering scheme (prefix, sequence
-- padding, year segment, yearly reset) plus the running sequence used to
-- allocate invoice numbers.
--
-- No FK to merchants on purpose: numbering is configured before (and
-- independently of) merchant records, mirroring how invoices are keyed today
-- by invoice_number alone.

CREATE TABLE IF NOT EXISTS invoice_numbering (
  merchant_id   TEXT PRIMARY KEY,
  prefix        TEXT        NOT NULL DEFAULT 'INV',
  padding       INTEGER     NOT NULL DEFAULT 6 CHECK (padding BETWEEN 1 AND 12),
  include_year  BOOLEAN     NOT NULL DEFAULT true,
  yearly_reset  BOOLEAN     NOT NULL DEFAULT true,
  sequence      INTEGER     NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  period        TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE invoice_numbering IS 'Per-merchant invoice numbering scheme and running sequence (issue #1738)';
COMMENT ON COLUMN invoice_numbering.period IS 'Active sequence period (UTC year when yearly_reset, otherwise empty); a period change resets the sequence to 1';
COMMENT ON COLUMN invoice_numbering.sequence IS 'Last allocated sequence within the active period';

-- @down
DROP TABLE IF EXISTS invoice_numbering;
