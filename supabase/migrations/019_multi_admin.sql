-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 019: Multi-admin support & logo columns
-- Run after: 018_users.sql
--
-- Changes:
--   1. Add logo_url column to clients table (if not already present)
--   2. Ensure users table password_hash column exists
--   3. Add last_login_at column to users (used to track sign-in activity)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Client logo (displayed on client-facing dashboard)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. Users: ensure password_hash and last_login_at exist
--    (018_users.sql may already have these; ADD COLUMN IF NOT EXISTS is safe)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 3. Remove the old role CHECK constraint and replace with a wider one
--    in case 018 was run with only 'admin' | 'viewer'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'viewer'));

-- Note: 'super_admin' is NOT stored in the DB — the super admin is
-- authenticated via the ADMIN_PASSWORD environment variable only.
-- Regular admin accounts in the users table use role = 'admin'.

-- 4. Index on users.email for fast login lookup
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (LOWER(email));
