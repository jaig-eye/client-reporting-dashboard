-- 018_users.sql
-- Multi-user support for the admin panel.
-- Designed to support full RBAC in the future — for now only 'admin' and 'viewer' roles exist.
-- The current single-password approach (ADMIN_PASSWORD env var) can coexist during migration.

CREATE TABLE IF NOT EXISTS users (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Display name shown in the sidebar user card
  name            TEXT          NOT NULL DEFAULT 'Admin',

  email           TEXT          NOT NULL UNIQUE,

  -- bcrypt hash of the user's password (cost ≥ 12)
  password_hash   TEXT          NOT NULL,

  -- Optional avatar (URL to an image or a data URL for uploaded avatars)
  avatar_url      TEXT,

  -- Role controls what the user can do. 'admin' has full access.
  -- 'viewer' can see client dashboards but cannot modify settings or trigger syncs.
  -- Additional roles can be added here without schema changes.
  role            TEXT          NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),

  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,

  last_login_at   TIMESTAMPTZ,

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Link agency_settings to a primary admin user
-- This is nullable so it remains backward compatible with the env-var auth approach
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS primary_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Version tracking for the admin UI display
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS app_version TEXT NOT NULL DEFAULT '2.0.0';
