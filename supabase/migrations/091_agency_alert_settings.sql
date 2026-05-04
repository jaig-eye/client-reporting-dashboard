ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS notify_metric_alerts   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS metric_alert_threshold NUMERIC  DEFAULT 0.40,
  ADD COLUMN IF NOT EXISTS notify_topic_ready     BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_post_uploaded   BOOLEAN DEFAULT true;
