-- Store all raw Meta action types per campaign-day row.
-- This allows the admin to change the conversion mapping at any time
-- without needing to re-sync historical data — the dashboard re-computes
-- conversions from raw_meta_actions using the current metric_config.
ALTER TABLE campaign_metrics ADD COLUMN IF NOT EXISTS raw_meta_actions JSONB;
