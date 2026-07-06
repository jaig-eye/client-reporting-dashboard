ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS discord_ops_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS consolidated_email_notifications BOOLEAN NOT NULL DEFAULT TRUE;
