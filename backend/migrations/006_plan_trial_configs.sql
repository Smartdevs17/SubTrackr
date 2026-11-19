-- Per-plan trial configuration for configurable trial periods (Issue #1722).
--
-- Each row describes the trial policy for a specific subscription plan:
-- how long the trial lasts and whether it auto-converts to a paid
-- subscription on expiry.

CREATE TABLE IF NOT EXISTS plan_trial_configs (
  plan_id                 TEXT        PRIMARY KEY REFERENCES plans (id) ON DELETE CASCADE,
  trial_duration_days     INTEGER     NOT NULL CHECK (trial_duration_days > 0),
  auto_convert_on_expiry  BOOLEAN     NOT NULL DEFAULT false,
  description             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE plan_trial_configs IS
  'Per-plan trial configuration: duration in days and auto-conversion policy (Issue #1722).';

COMMENT ON COLUMN plan_trial_configs.trial_duration_days IS
  'Number of days the trial period lasts for this plan. Must be a positive integer.';

COMMENT ON COLUMN plan_trial_configs.auto_convert_on_expiry IS
  'When true the trial is automatically converted to a paid subscription at expiry '
  'rather than being marked expired.';

-- Automatically update updated_at on row changes.
CREATE OR REPLACE FUNCTION update_plan_trial_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_trial_configs_updated_at ON plan_trial_configs;
CREATE TRIGGER trg_plan_trial_configs_updated_at
  BEFORE UPDATE ON plan_trial_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_plan_trial_configs_updated_at();

-- @down
DROP TRIGGER IF EXISTS trg_plan_trial_configs_updated_at ON plan_trial_configs;
DROP FUNCTION IF EXISTS update_plan_trial_configs_updated_at();
DROP TABLE IF EXISTS plan_trial_configs;
