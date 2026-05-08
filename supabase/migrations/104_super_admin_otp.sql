ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS super_admin_otp_hash        TEXT;
ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS super_admin_otp_expires_at  TIMESTAMPTZ;
