-- Theme Storage for SubTrackr Merchant Branding
-- Adds merchant theme configuration support

CREATE TABLE IF NOT EXISTS merchant_themes (
  id            TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  config_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_themes_merchant_id ON merchant_themes(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_themes_active ON merchant_themes(merchant_id, is_active) WHERE is_active = true;

COMMENT ON TABLE merchant_themes IS 'Merchant-branded theme configurations for white-label subscription UI';
COMMENT ON COLUMN merchant_themes.config_json IS 'Full theme config: colors, fonts, logo URLs, CSS variables, accessibility metadata';

CREATE TABLE IF NOT EXISTS theme_variant_pairs (
  id            TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  light_theme_id TEXT NOT NULL REFERENCES merchant_themes(id) ON DELETE CASCADE,
  dark_theme_id  TEXT NOT NULL REFERENCES merchant_themes(id) ON DELETE CASCADE,
  shared_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_theme_variant_pairs_merchant_id ON theme_variant_pairs(merchant_id);

COMMENT ON TABLE theme_variant_pairs IS 'Light/dark theme variant pairs for merchant brand families';

CREATE OR REPLACE FUNCTION ensure_single_active_theme()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active THEN
    UPDATE merchant_themes
    SET is_active = false, updated_at = now()
    WHERE merchant_id = NEW.merchant_id AND id != NEW.id AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_single_active_theme ON merchant_themes;
CREATE TRIGGER trg_single_active_theme
  BEFORE INSERT OR UPDATE OF is_active
  ON merchant_themes
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION ensure_single_active_theme();
