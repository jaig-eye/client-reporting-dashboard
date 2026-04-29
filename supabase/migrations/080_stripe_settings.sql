ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS stripe_api_key       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_webhook_secret TEXT;
