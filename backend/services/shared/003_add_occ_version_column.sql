-- Migration: Add OCC Version Column
-- Description: Adds an integer 'version' column to key entities for Optimistic Concurrency Control.
-- Issue: #613

BEGIN;

-- Add version column to subscriptions
ALTER TABLE subscriptions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Add version column to invoices
ALTER TABLE invoices ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Add version column to plans
ALTER TABLE plans ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

COMMIT;