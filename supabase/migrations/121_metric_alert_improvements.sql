-- Add alert_type, platform, and date_label to metric_alerts for the two-phase alert system.
-- Add daily_alert_threshold to agency_settings.

ALTER TABLE metric_alerts
  ADD COLUMN IF NOT EXISTS alert_type  TEXT NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS platform    TEXT,
  ADD COLUMN IF NOT EXISTS date_label  TEXT;

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS daily_alert_threshold NUMERIC DEFAULT 0.50;
