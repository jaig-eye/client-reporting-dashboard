ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS generate_lead_days INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS approval_notify    BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS publish_time       TEXT    DEFAULT '09:00';
