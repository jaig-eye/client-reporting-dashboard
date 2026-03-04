-- 011_metric_config.sql
-- Adds flexible per-client and global metric configuration.
--
-- metric_config JSONB shape:
--   {
--     "meta_conversion_action": "lead",   -- which Meta action_type counts as conversions
--     "conversion_label": "Leads"         -- display name override for the conversions metric
--   }
--
-- available_meta_actions JSONB on ad_accounts:
--   Populated during Meta syncs with all unique action_type strings returned by the API.
--   Used to populate the metric mapping dropdown in the admin UI.

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS metric_config JSONB NOT NULL DEFAULT '{}';

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS metric_config JSONB NOT NULL DEFAULT '{}';

ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS available_meta_actions JSONB;
