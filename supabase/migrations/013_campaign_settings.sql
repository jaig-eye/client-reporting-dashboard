-- 013_campaign_settings.sql
-- Per-campaign goal type and conversion action configuration.
-- Allows each campaign to have its own goal (lead_gen, ecommerce, calls, etc.)
-- and its own Meta conversion action override.
--
-- goal_type values:
--   'lead_gen'     — count leads/form fills, show CPL, no ROAS
--   'ecommerce'    — count purchases, show ROAS + Revenue
--   'calls'        — count phone calls, show Cost/Call
--   'appointments' — count appointments/bookings, show Cost/Appt
--   'awareness'    — awareness/reach campaigns, show Impressions/CPM/CTR
--   'other'        — custom goal, show generic conversion count
--   'unset'        — not yet configured, falls back to client/global config

CREATE TABLE IF NOT EXISTS campaign_settings (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform              TEXT          NOT NULL CHECK (platform IN ('google', 'meta')),
  campaign_id           TEXT          NOT NULL,
  campaign_name         TEXT          NOT NULL DEFAULT '',
  goal_type             TEXT          NOT NULL DEFAULT 'unset',
  -- Meta-only: overrides client-level and global meta_conversion_action for this campaign
  meta_conversion_action TEXT,
  -- Display label override (e.g. "Leads", "Purchases", "Phone Calls")
  conversion_label      TEXT,
  -- When true the campaign is excluded from the client dashboard entirely
  hidden                BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, platform, campaign_id)
);

CREATE INDEX IF NOT EXISTS campaign_settings_client_id_idx ON campaign_settings(client_id);
