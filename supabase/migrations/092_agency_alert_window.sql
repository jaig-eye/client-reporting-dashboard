ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS metric_alert_window_days INTEGER DEFAULT 14;
