ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS notify_connector_errors BOOLEAN DEFAULT false;
