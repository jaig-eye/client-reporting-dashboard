-- Add cron_enabled flag to agency_settings.
-- When false, the scheduled /api/cron/sync endpoint is a no-op even if Vercel fires it.
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS cron_enabled BOOLEAN NOT NULL DEFAULT true;
