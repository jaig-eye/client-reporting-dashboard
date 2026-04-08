-- 037_meta_campaign_status.sql
-- Add campaign_status column to meta_ads_metrics.
-- Meta campaigns have statuses (ACTIVE, PAUSED, ARCHIVED, DELETED) but the field
-- was previously not requested from the API. This migration adds the column so
-- the sync engine can persist it and the UI can show status badges for Meta campaigns.

ALTER TABLE meta_ads_metrics
  ADD COLUMN IF NOT EXISTS campaign_status TEXT;

-- Partial index for active/paused filtering queries
CREATE INDEX IF NOT EXISTS idx_meta_metrics_campaign_status
  ON meta_ads_metrics(client_id, campaign_status)
  WHERE campaign_status IS NOT NULL;
