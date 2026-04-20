-- Migration 062: Ensure phone_number column exists on content_settings
-- Migration 048 was supposed to add this but may not have been applied.
-- Using IF NOT EXISTS makes this idempotent.
ALTER TABLE content_settings ADD COLUMN IF NOT EXISTS phone_number TEXT;
