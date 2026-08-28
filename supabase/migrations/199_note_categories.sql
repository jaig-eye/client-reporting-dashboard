-- ─────────────────────────────────────────────────────────────────────────────
-- Note categories + per-category structured templates.
--
-- `category` picks the form layout; `fields` holds that layout's answers as JSONB
-- so adding or reshaping a template never needs DDL. `content` stays the freeform
-- body and remains NOT NULL, so every existing note is a valid 'general' note and
-- every category still supports prose underneath its structured fields.
--
-- SECURITY: the 'login' template deliberately stores a POINTER to a credential
-- (vault item, username, MFA method) and never the secret itself. client_notes is
-- a plain table reachable by the service role, included in DB backups, and exposed
-- to any future CSV export — it is not a secrets store. See the CHECK below.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE client_notes
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS fields   JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_notes_category_check'
  ) THEN
    ALTER TABLE client_notes
      ADD CONSTRAINT client_notes_category_check
      CHECK (category IN (
        'general',     -- freeform prose (the pre-existing behaviour)
        'contact',     -- call/email/meeting log; stamps clients.last_contacted_at
        'login',       -- where a credential lives (never the credential)
        'dns',         -- registrar, nameservers, records
        'hosting',     -- host, control panel, PHP/SSL
        'access',      -- platform access granted (GA4/GSC/Ads/Meta/GBP)
        'billing',     -- plan, MRR, contract dates
        'issue',       -- problem report + resolution
        'change',      -- what changed, why, how to roll back
        'preference'   -- brand voice / do-not-mention; feeds content generation
      ));
  END IF;

  -- fields must be a JSON object, never an array or scalar.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_notes_fields_object_check'
  ) THEN
    ALTER TABLE client_notes
      ADD CONSTRAINT client_notes_fields_object_check
      CHECK (jsonb_typeof(fields) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN client_notes.category IS
  'Template selector. Drives which structured form renders; see NOTE_TEMPLATES in src/lib/note-templates.ts.';
COMMENT ON COLUMN client_notes.fields IS
  'Answers to the category template, as {key: string}. Never store secrets here — the login template stores a vault pointer only.';

CREATE INDEX IF NOT EXISTS idx_client_notes_category
  ON client_notes (client_id, category, created_at DESC);

-- Trace which note last stamped clients.last_contacted_at (added in 198).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_last_contact_note_id_fkey'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_last_contact_note_id_fkey
      FOREIGN KEY (last_contact_note_id) REFERENCES client_notes(id) ON DELETE SET NULL;
  END IF;
END $$;
