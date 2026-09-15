-- ─────────────────────────────────────────────────────────────────────────────
-- Client update notes: "what we did" written by the team and shown to the client.
--
-- Adds one note category, 'client_update'. It is the ONLY category the client dashboard ever
-- reads, and it reads only title, content, the 'next_up' field and created_at, never the
-- author, other fields, other categories or secret_enc. The template holds no credential,
-- and the API refuses a secret on any category that doesn't declare one (lib/notes/noteSecrets).
--
-- Default and existing rows are unaffected: this only widens the allowed values.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE client_notes DROP CONSTRAINT IF EXISTS client_notes_category_check;

ALTER TABLE client_notes
  ADD CONSTRAINT client_notes_category_check
  CHECK (category IN (
    'general',        -- freeform prose (the pre-existing behaviour)
    'contact',        -- call/email/meeting log; stamps clients.last_contacted_at
    'login',          -- where a credential lives; password encrypted in secret_enc
    'dns',            -- registrar, nameservers, records
    'hosting',        -- host, control panel, PHP/SSL
    'access',         -- platform access granted (GA4/GSC/Ads/Meta/GBP)
    'billing',        -- plan, MRR, contract dates
    'issue',          -- problem report + resolution
    'change',         -- what changed, why, how to roll back
    'preference',     -- brand voice / do-not-mention; feeds content generation
    'client_update'   -- what we did, shown to the client on their dashboard
  ));

COMMENT ON COLUMN client_notes.category IS
  'Template selector (see NOTE_TEMPLATES in src/lib/note-templates.ts). Only client_update notes are ever shown to the client.';
