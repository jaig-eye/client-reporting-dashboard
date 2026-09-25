-- ─────────────────────────────────────────────────────────────────────────────
-- Let an operator say "not this one" about a researched keyword.
--
-- Research builds a candidate pool a person is meant to choose from, and until now the only
-- thing a person could do with a bad candidate was look at it. A keyword that is obviously
-- wrong for the business — the first real run for a lighting installer surfaced "macbook stage
-- light effect" and "govee lights" — stayed in the pool, fed topic selection's "researched
-- opportunities" section, and came back on every re-run because discovery skips keywords it
-- already holds.
--
-- dismissed_at is the answer. A dismissed row is excluded from every read that builds the pool
-- (topic selection, the wizard, the Analytics tab) and is NOT deleted, so discovery still sees
-- it as known and does not re-insert it. Clearing the timestamp un-dismisses. Rebuilding the
-- pool (a forced re-run) removes untracked, unclaimed candidates and leaves dismissed rows
-- alone for the same reason.
--
-- Additive. Nullable, no default, no rewrite of existing rows. Code tolerates its absence.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.seo_keywords
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_seo_keywords_client_dismissed
  ON public.seo_keywords (client_id, dismissed_at);

COMMENT ON COLUMN public.seo_keywords.dismissed_at IS
  'Set when an operator marks a researched candidate irrelevant. Excluded from the candidate pool but kept so discovery does not re-insert it; null means live.';
