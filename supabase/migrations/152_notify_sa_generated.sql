ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS notify_sa_generated BOOLEAN DEFAULT TRUE;
