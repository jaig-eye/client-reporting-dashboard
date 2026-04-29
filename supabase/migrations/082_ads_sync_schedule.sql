-- Separate sync schedule for paid-ads connectors (google_ads, meta_ads).
-- Default: hourly. Other connectors keep the existing sync_frequency schedule.
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS ads_sync_frequency TEXT NOT NULL DEFAULT 'hourly',
  ADD COLUMN IF NOT EXISTS ads_sync_hour_utc  INT  NOT NULL DEFAULT 0;
