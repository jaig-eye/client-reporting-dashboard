-- ─────────────────────────────────────────────────────────────────────────────
-- Encrypted credential storage on login notes.
--
-- Migration 199 deliberately kept passwords OUT of client_notes and stored a
-- vault pointer instead, because that table is service-role readable, lands in
-- every backup, and is fair game for any future export. That reasoning still
-- holds for high-value credentials.
--
-- This column exists for the cases where the team genuinely needs the value in
-- the dashboard. It stores AES-256-GCM ciphertext ONLY. The key lives in the
-- environment (CREDENTIAL_ENCRYPTION_KEY), never in Postgres, so the properties
-- are:
--
--   A stolen DB backup, a leaked service-role key, or a SQL read of this table
--   yields ciphertext and nothing usable.
--
--   Anyone who can execute code on the server can still decrypt. This is a
--   lockbox, not a vault.
--
-- Plaintext is never written here. The application refuses to store a secret at
-- all when the key is absent, rather than silently falling back to plaintext.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE client_notes
  ADD COLUMN IF NOT EXISTS secret_enc TEXT;

COMMENT ON COLUMN client_notes.secret_enc IS
  'AES-256-GCM ciphertext, format v1.<iv>.<tag>.<ct> (base64url). NEVER plaintext. Decrypted only by an audited reveal; never returned by list endpoints. See src/lib/crypto/secrets.ts.';

-- Guard against a bug or a manual INSERT ever writing a bare password here.
-- Anything that is not in the versioned envelope format is rejected outright.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_notes_secret_enc_format') THEN
    ALTER TABLE client_notes
      ADD CONSTRAINT client_notes_secret_enc_format
      CHECK (
        secret_enc IS NULL
        OR secret_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
      );
  END IF;
END $$;

-- Every decryption is recorded. A credential store without an access trail tells
-- you nothing after an incident.
CREATE TABLE IF NOT EXISTS credential_access_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     UUID REFERENCES client_notes(id) ON DELETE SET NULL,
  client_id   UUID REFERENCES clients(id)      ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id)        ON DELETE SET NULL,
  -- Denormalised so the trail survives the user or note being deleted.
  actor_label TEXT NOT NULL,
  service     TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credential_access_client ON credential_access_log (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credential_access_user   ON credential_access_log (user_id, created_at DESC);

ALTER TABLE credential_access_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE credential_access_log IS
  'Who revealed which stored credential, and when. Append-only in practice; written by the reveal route.';
