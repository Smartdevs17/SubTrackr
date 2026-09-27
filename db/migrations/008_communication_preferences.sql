-- ── Migration: Communication Preferences, Voice Reminders, Two-Way SMS ─────────
--
-- Tables to support customer communication preferences (#1253), voice call
-- reminders for renewals (#1255) and two-way SMS responses (#1256):
-- - communication_preferences:      per-category, per-channel opt-in/opt-out
-- - communication_preference_events: append-only audit trail of every change
-- - voice_call_reminders:           one row per renewal reminder call attempt
-- - sms_inbound_messages:           inbound SMS webhook log, keyed by MessageSid
--
-- Run with:  psql $DATABASE_URL -f 008_communication_preferences.sql

CREATE TABLE IF NOT EXISTS communication_preferences (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  -- { "billing": { "channels": { "email": { "enabled": true, "fallbackOrder": [] } }, "required": true }, ... }
  categories JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { "enabled": false, "startMinute": 1320, "endMinute": 420, "timezone": "UTC" }
  quiet_hours JSONB NOT NULL DEFAULT '{"enabled": false, "startMinute": 1320, "endMinute": 420, "timezone": "UTC"}'::jsonb,
  -- { "sms": true, "voice": true } — hard per-channel kill switches (STOP / do-not-call)
  global_opt_outs JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE communication_preferences IS 'Per-customer communication preferences: channel opt-in/opt-out, quiet hours and hard opt-outs';
COMMENT ON COLUMN communication_preferences.global_opt_outs IS 'Channels the customer hard-opted out of, e.g. {"sms": true} after replying STOP';

CREATE TABLE IF NOT EXISTS communication_preference_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  category VARCHAR(32) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  enabled BOOLEAN NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'api',
  reason TEXT,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voice_call_reminders (
  id BIGSERIAL PRIMARY KEY,
  subscription_id UUID NOT NULL,
  user_id UUID NOT NULL,
  milestone VARCHAR(16) NOT NULL,        -- 30_day | 7_day | 1_day | expired
  call_id VARCHAR(64),                   -- Twilio call SID (CA...)
  status VARCHAR(16) NOT NULL,           -- placed | skipped | failed
  reason VARCHAR(255) NOT NULL,
  provider VARCHAR(16) NOT NULL DEFAULT 'twilio',
  called_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE voice_call_reminders IS 'Audit trail of voice call renewal reminders, including suppressed attempts';

CREATE TABLE IF NOT EXISTS sms_inbound_messages (
  id BIGSERIAL PRIMARY KEY,
  -- Twilio MessageSid. UNIQUE makes webhook replays a no-op via ON CONFLICT.
  message_sid VARCHAR(64) NOT NULL UNIQUE,
  user_id UUID,
  from_number VARCHAR(32) NOT NULL,
  to_number VARCHAR(32) NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  intent VARCHAR(32) NOT NULL,          -- opt_out | opt_in | help | renew | snooze | status | unknown
  keyword VARCHAR(32) NOT NULL DEFAULT '',
  reply_body TEXT,
  reply_message_id VARCHAR(64),
  error TEXT,
  handled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE sms_inbound_messages IS 'Inbound two-way SMS webhook log, deduplicated on Twilio MessageSid';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comm_pref_events_user
  ON communication_preference_events(user_id, changed_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_voice_reminders_user
  ON voice_call_reminders(user_id, called_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_voice_reminders_subscription
  ON voice_call_reminders(subscription_id, milestone, called_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sms_inbound_user
  ON sms_inbound_messages(user_id, handled_at DESC);

ANALYZE communication_preferences;
ANALYZE communication_preference_events;
ANALYZE voice_call_reminders;
ANALYZE sms_inbound_messages;
