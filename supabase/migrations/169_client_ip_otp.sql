-- Client IP verification OTP fields
-- Triggers email OTP when a client's IP changes from last_known_ip.
-- Mirrors the super-admin OTP pattern (agency_settings.super_admin_otp_hash).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS last_known_ip      TEXT,
  ADD COLUMN IF NOT EXISTS client_otp_hash    TEXT,
  ADD COLUMN IF NOT EXISTS client_otp_expires_at TIMESTAMPTZ;
