-- 007_meta_oauth_token.sql
-- Stores the agency-level Meta OAuth token in agency_settings.
-- Replaces the system user token approach with a standard OAuth long-lived token.
-- The agency authenticates once as the Business Manager admin; the token covers
-- all ad accounts they have access to via Business Manager.

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS meta_access_token      TEXT,
  ADD COLUMN IF NOT EXISTS meta_token_expires_at  TIMESTAMPTZ;

-- meta_system_user_token is no longer used (replaced by OAuth flow)
-- Kept in schema for backwards compatibility; safe to leave NULL.
