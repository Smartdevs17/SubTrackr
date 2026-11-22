-- Durable audit records for payment retries and customer prepaid balances.
BEGIN;
CREATE TABLE IF NOT EXISTS payment_retry_attempts (
  id BIGSERIAL PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  failure_type TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  delay_hours NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_retry_subscription ON payment_retry_attempts(subscription_id, created_at);

CREATE TABLE IF NOT EXISTS customer_prepayment_wallets (
  id BIGSERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  balance NUMERIC(20, 8) NOT NULL DEFAULT 0,
  low_balance_threshold NUMERIC(20, 8),
  total_deposited NUMERIC(20, 8) NOT NULL DEFAULT 0,
  total_withdrawn NUMERIC(20, 8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, subscription_id, currency)
);
CREATE TABLE IF NOT EXISTS customer_prepayment_transactions (
  id BIGSERIAL PRIMARY KEY,
  wallet_id BIGINT NOT NULL REFERENCES customer_prepayment_wallets(id),
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdraw', 'drawdown')),
  amount NUMERIC(20, 8) NOT NULL,
  balance_after NUMERIC(20, 8) NOT NULL,
  invoice_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;

-- @down
BEGIN;
DROP TABLE IF EXISTS customer_prepayment_transactions;
DROP TABLE IF EXISTS customer_prepayment_wallets;
DROP TABLE IF EXISTS payment_retry_attempts;
COMMIT;
