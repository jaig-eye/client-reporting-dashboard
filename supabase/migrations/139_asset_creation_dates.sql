-- Add campaign/ad creation dates synced from Google Ads and Meta APIs.
-- Google: campaign.start_date (when campaign was first activated)
-- Meta:   created_time field on campaigns, adsets, and ads

ALTER TABLE google_ads_metrics
  ADD COLUMN IF NOT EXISTS campaign_start_date DATE;

ALTER TABLE meta_ads_metrics
  ADD COLUMN IF NOT EXISTS campaign_created_at DATE,
  ADD COLUMN IF NOT EXISTS adset_created_at    DATE;

ALTER TABLE meta_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS ad_created_at       DATE;

ALTER TABLE google_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS ad_created_at       DATE;
