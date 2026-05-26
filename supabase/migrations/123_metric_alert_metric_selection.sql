ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS daily_alert_metrics  JSONB DEFAULT '["spend","conversions","cpa"]'::jsonb,
  ADD COLUMN IF NOT EXISTS weekly_alert_metrics JSONB DEFAULT '["spend","conversions","cpa","roas","ctr"]'::jsonb;
