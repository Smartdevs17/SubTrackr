-- Pause/resume columns for the subscriptions table (Issue #1723).
-- Tracks per-subscription pause state so the billing engine can skip
-- charges while a subscription is paused and correctly shift the next
-- billing date on resume.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS is_paused         BOOLEAN      NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paused_at         TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pause_duration_days INTEGER;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paused_until       TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_adjustment_amount NUMERIC(12,2);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pause_reason       VARCHAR(64);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pause_note         TEXT;

-- Index used by the auto-resume cron job that selects subscriptions
-- whose pause window has elapsed.
CREATE INDEX IF NOT EXISTS idx_subscriptions_paused_until
    ON subscriptions (paused_until)
    WHERE is_paused = true;

-- Partial index so billing queries can cheaply exclude paused rows.
CREATE INDEX IF NOT EXISTS idx_subscriptions_active_billing
    ON subscriptions (next_billing_date)
    WHERE is_paused = false AND is_active = true;

-- @down
DROP INDEX IF EXISTS idx_subscriptions_active_billing;
DROP INDEX IF EXISTS idx_subscriptions_paused_until;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS pause_note;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS pause_reason;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS billing_adjustment_amount;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS paused_until;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS pause_duration_days;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS paused_at;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS is_paused;
