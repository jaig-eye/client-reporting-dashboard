-- ─────────────────────────────────────────────────────────────────────────────
-- Per-token guess budget for password-reset codes.
--
-- The code is six digits (~9x10^5) with a ten-minute life, and a correct guess
-- rewrites the account password outright. The only throttle was a per-IP,
-- in-memory (per-serverless-instance) rate limit — which a distributed guesser or
-- a wide lambda fan-out sidesteps entirely, since each instance starts with an
-- empty counter. That is a straight path to account takeover.
--
-- Binding the budget to the TOKEN ROW instead of to an IP fixes it: every wrong
-- guess against a user's live code increments this counter no matter where it
-- comes from, and reset-password burns the token once the cap is reached, so the
-- attacker must trigger a brand-new (randomly different) code to keep going — and
-- code ISSUANCE is itself rate-limited per IP on forgot-password.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN password_reset_tokens.attempts IS
  'Failed verification attempts against this code. The token is burned once it reaches the cap enforced in reset-password, defeating brute force independent of IP.';
