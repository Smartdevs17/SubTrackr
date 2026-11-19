-- Persistent idempotency receipts table.
--
-- Replaces the in-memory Map in idempotencyService.ts with a durable store so
-- receipts survive process restarts and work correctly across multiple server
-- instances (horizontal scaling, rolling deploys).
--
-- Retention policy: receipts older than 24 hours are considered expired and
-- may be purged by a nightly job or by the cleanup trigger below.

CREATE TABLE IF NOT EXISTS idempotency_receipts (
  key            VARCHAR(255)    NOT NULL PRIMARY KEY,
  request_hash   VARCHAR(64)     NOT NULL,
  status         VARCHAR(16)     NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  response       JSONB,
  created_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

-- Index for expiry cleanup queries.
CREATE INDEX IF NOT EXISTS idx_idempotency_receipts_created_at
  ON idempotency_receipts (created_at);

-- Index for fast pending-request lookups.
CREATE INDEX IF NOT EXISTS idx_idempotency_receipts_status
  ON idempotency_receipts (status)
  WHERE status = 'pending';
