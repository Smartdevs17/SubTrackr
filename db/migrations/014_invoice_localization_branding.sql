-- Invoice presentation is immutable per invoice so historical PDFs remain stable.
BEGIN;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en-US';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS branding JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMIT;

-- @down
BEGIN;
ALTER TABLE invoices DROP COLUMN IF EXISTS branding;
ALTER TABLE invoices DROP COLUMN IF EXISTS locale;
COMMIT;
