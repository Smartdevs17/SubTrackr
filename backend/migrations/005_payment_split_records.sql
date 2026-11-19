-- Payment Split Records for cross-account payment splitting (Issue #1720).
--
-- Stores the outcome of each individual charge within a split payment
-- for audit, revenue reconciliation, and dispute investigation.

CREATE TABLE IF NOT EXISTS payment_split_records (
  id                    TEXT        PRIMARY KEY,
  -- The idempotency key of the parent split request.
  idempotency_key       TEXT        NOT NULL,
  -- Total amount of the parent split request, in smallest currency unit.
  total_amount          NUMERIC(20, 8) NOT NULL,
  currency              TEXT        NOT NULL,
  -- Whether every individual split charge succeeded.
  all_succeeded         BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psr_idempotency_key ON payment_split_records (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_psr_created_at      ON payment_split_records (created_at);

COMMENT ON TABLE payment_split_records IS
  'Top-level record for a cross-account split payment (Issue #1720). '
  'Each row groups the per-destination entries in payment_split_entries.';

-- ─── Per-entry detail ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_split_entries (
  id                      TEXT        PRIMARY KEY,
  split_record_id         TEXT        NOT NULL REFERENCES payment_split_records (id) ON DELETE CASCADE,
  destination_account_id  TEXT        NOT NULL,
  percentage              NUMERIC(7, 4) NOT NULL,
  amount                  NUMERIC(20, 8) NOT NULL,
  status                  TEXT        NOT NULL CHECK (status IN ('succeeded', 'failed', 'pending')),
  charge_id               TEXT,
  gateway_used            TEXT,
  error_message           TEXT,
  processed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pse_split_record_id       ON payment_split_entries (split_record_id);
CREATE INDEX IF NOT EXISTS idx_pse_destination_account   ON payment_split_entries (destination_account_id);
CREATE INDEX IF NOT EXISTS idx_pse_status                ON payment_split_entries (status);

COMMENT ON TABLE payment_split_entries IS
  'Per-destination charge result within a split payment. '
  'One row per PaymentSplitEntry in the original request.';

COMMENT ON COLUMN payment_split_entries.percentage    IS 'Percentage of the total amount directed to this destination (0–100).';
COMMENT ON COLUMN payment_split_entries.amount        IS 'Actual amount charged to this destination, in smallest currency unit.';
COMMENT ON COLUMN payment_split_entries.charge_id     IS 'Gateway-returned charge/transaction identifier.';
COMMENT ON COLUMN payment_split_entries.error_message IS 'Non-null only when status = ''failed''.';

-- @down
DROP TABLE IF EXISTS payment_split_entries;
DROP TABLE IF EXISTS payment_split_records;
