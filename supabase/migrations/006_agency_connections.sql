-- 006_agency_connections.sql
-- Shifts from per-client OAuth to agency-level connections.
-- Ad accounts are now discovered globally and then mapped to clients.

-- 1. Make client_id nullable so accounts can exist before being mapped
ALTER TABLE ad_accounts ALTER COLUMN client_id DROP NOT NULL;

-- 2. Relax unique constraint: an ad account is globally unique per platform,
--    regardless of which client it's mapped to
ALTER TABLE ad_accounts DROP CONSTRAINT IF EXISTS ad_accounts_client_id_platform_account_id_key;
ALTER TABLE ad_accounts ADD CONSTRAINT ad_accounts_platform_account_id_key UNIQUE (platform, account_id);

-- 3. Add Meta System User Token to agency_settings for agency-level connection
--    (never expires, covers all Business Manager ad accounts)
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS meta_system_user_token TEXT;

-- Index to make unlinked account lookup fast
CREATE INDEX IF NOT EXISTS idx_ad_accounts_unlinked
  ON ad_accounts(platform, account_id)
  WHERE client_id IS NULL;
