-- Add all_conversions_value to Google Ads metrics tables.
-- This captures all conversion types (primary + secondary), giving more accurate ROAS.
ALTER TABLE google_ads_metrics
  ADD COLUMN IF NOT EXISTS all_conversions_value DECIMAL(14,4);

ALTER TABLE google_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS all_conversions_value DECIMAL(14,4);
