-- ─────────────────────────────────────────────────────────────────────────────
-- 225: which researched keywords a person actually chose
--
-- Research returns a few hundred candidates. Until now every one of them fed topic selection and
-- the only control was dismissing the bad ones — which, at 240 a run, means policing a list nobody
-- has time to police, and one saturated theme ("christmas lights", eight ways) quietly crowding out
-- the rest.
--
-- So selection inverts: nothing a research run finds is used until somebody picks it. chosen_at
-- records that pick. A candidate with no chosen_at is still stored, still browsable, still there to
-- come back to — it simply does not reach the writer.
--
-- Deliberately NOT backfilled. Setting it on the rows that already exist would quietly re-approve
-- every keyword the old behaviour let through, which is the thing being fixed. Existing clients
-- start with an empty selection and the wizard says so.
--
-- Additive and nullable. Every read tolerates the column being absent — the code falls back to
-- treating the pool as unfiltered, which is the pre-225 behaviour — so applying this is safe in
-- either order with the deploy.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.seo_keywords
  ADD COLUMN IF NOT EXISTS chosen_at TIMESTAMPTZ;

COMMENT ON COLUMN public.seo_keywords.chosen_at IS
  'When a person chose this researched keyword for use. NULL means researched but not chosen: stored and browsable, but it does not feed topic selection.';

-- The pool read is "this client, untracked, unclaimed, chosen" — ordered by when it was picked so
-- the newest selections surface first.
CREATE INDEX IF NOT EXISTS idx_seo_keywords_chosen
  ON public.seo_keywords (client_id, chosen_at DESC)
  WHERE chosen_at IS NOT NULL;
