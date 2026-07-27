-- 180: Add service_page_master_prompt and regular_page_master_prompt to agency_settings.
-- These columns are referenced in generate/route.ts and ContentSettingsPanel.tsx
-- but were never added to the DB, causing every agency_settings SELECT in the
-- generate route to fail with Postgres 42703 (column does not exist).
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS service_page_master_prompt TEXT,
  ADD COLUMN IF NOT EXISTS regular_page_master_prompt TEXT;
