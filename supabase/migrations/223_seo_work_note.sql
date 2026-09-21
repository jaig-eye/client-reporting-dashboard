-- ─────────────────────────────────────────────────────────────────────────────
-- 223: SEO work notes — the off-platform work, entered by hand
--
-- The SEO Activity tab is a lifetime log of what we did for a client: the review replies we
-- wrote, the posts we shared, the blog posts we published. All three come from a connector.
--
-- The rest doesn't. Backlinks placed through NicheRanker, directory citations, referral
-- placements — none of it reaches any API we sync, so today it is invisible to the client even
-- though it is a large part of what they pay for. This category is how it gets logged.
--
-- 'seo_work' is the SECOND category a client ever sees, after 'client_update'. Like that one it
-- holds no credential, and the API refuses a secret on any category that doesn't declare one
-- (lib/notes/noteSecrets). The dashboard reads only title, content, the declared fields and
-- created_at — never the author, never other categories, never secret_enc.
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
    'client_update',  -- what we did, shown to the client on their dashboard
    'seo_work'        -- off-platform SEO work, shown on the client's SEO Activity tab
  ));

-- The SEO Activity tab reads one client's seo_work notes, newest first, for all time.
CREATE INDEX IF NOT EXISTS idx_client_notes_client_category_created
  ON public.client_notes (client_id, category, created_at DESC);

COMMENT ON COLUMN client_notes.category IS
  'Template selector (see NOTE_TEMPLATES in src/lib/note-templates.ts). Only client_update and seo_work notes are ever shown to the client.';
