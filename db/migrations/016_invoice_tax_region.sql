-- Regional tax reporting on invoices (issue #1732).
-- Rates are configured per region in TaxService; invoices record which
-- region/type applied so tax can be reported separately from revenue.
BEGIN;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_region TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_type TEXT;
COMMIT;

-- @down
BEGIN;
ALTER TABLE invoices DROP COLUMN IF EXISTS tax_type;
ALTER TABLE invoices DROP COLUMN IF EXISTS tax_region;
COMMIT;
