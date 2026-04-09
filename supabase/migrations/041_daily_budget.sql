-- 041_daily_budget.sql
-- Add daily_budget column to google_ads_metrics and meta_ads_metrics.
-- Stores the campaign's daily budget at the time of sync (in account currency).
-- Google Ads: campaign.campaign_budget.amount_micros / 1_000_000
-- Meta Ads:   daily_budget field from Campaigns API (in account currency cents / 100)

ALTER TABLE google_ads_metrics
  ADD COLUMN IF NOT EXISTS daily_budget DECIMAL(12,4);

ALTER TABLE meta_ads_metrics
  ADD COLUMN IF NOT EXISTS daily_budget DECIMAL(12,4);
