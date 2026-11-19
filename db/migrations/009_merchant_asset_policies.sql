-- 009_merchant_asset_policies.sql
-- Per-merchant allowlist/denylist for accepted payment assets.
-- Issue #1717: https://github.com/Smartdevs17/SubTrackr/issues/1717

BEGIN;

CREATE TABLE IF NOT EXISTS merchant_asset_policies (
  id           BIGSERIAL PRIMARY KEY,
  merchant_id  TEXT NOT NULL,
  chain        TEXT NOT NULL CHECK (chain IN ('stellar','evm','fiat')),
  asset_code   TEXT NOT NULL,
  asset_issuer TEXT,
  mode         TEXT NOT NULL CHECK (mode IN ('allow','deny')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_merchant_asset UNIQUE (merchant_id, chain, asset_code, asset_issuer, mode)
);

CREATE INDEX IF NOT EXISTS idx_merchant_asset_merchant ON merchant_asset_policies(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_asset_lookup
  ON merchant_asset_policies(merchant_id, chain, upper(asset_code));

COMMIT;
