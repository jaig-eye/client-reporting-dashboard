-- ─────────────────────────────────────────────────────────────────────────────
-- Force a password rotation.
--
-- Every existing user row holds an UNSALTED SHA-256 hash (verified: 4 of 4).
-- That is fast to crack offline if the database is ever dumped, and the move to
-- bcrypt only helps rows that are actually re-hashed.
--
-- The obvious approach — re-hash transparently on next login — was tried on the
-- security branch and did not work: the upgrade write was an un-awaited
-- supabase-js builder, which is a lazy thenable, so it issued no HTTP request at
-- all. (The same bug hides in `last_login_at`, which is why that column is NULL
-- for every user despite people logging in.) Rather than repair an invisible
-- background migration, this makes the rotation explicit and observable.
--
-- must_reset_password blocks session issuance. The user can still authenticate
-- with their current password — that is what proves it is them — but instead of
-- a session they get a reset code by email, and only completing the reset clears
-- the flag and writes a bcrypt hash.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_reset_password  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;

COMMENT ON COLUMN users.must_reset_password IS
  'When true, a correct password grants NO session — only a reset code. Cleared by reset-password.';
COMMENT ON COLUMN users.password_changed_at IS
  'Last successful password change. NULL means the password predates this tracking.';

-- Flag every account still on a legacy unsalted SHA-256 hash (64 hex chars).
-- Scoped by hash shape rather than by "all rows" so re-running this after some
-- users have already rotated does not force them round again.
UPDATE users
   SET must_reset_password = true
 WHERE is_active
   AND password_hash ~ '^[0-9a-f]{64}$';

-- The reset flow is the only way out of the flag, so its lookup must be quick
-- and its cleanup must not seq-scan.
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_active
  ON password_reset_tokens (user_id, expires_at)
  WHERE used_at IS NULL;
