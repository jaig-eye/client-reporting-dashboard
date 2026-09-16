-- ─────────────────────────────────────────────────────────────────────────────
-- 219: Google Business Profile reviews, one row per review
--
-- Until now the sync asked the reviews endpoint for a single review, purely to read the two
-- numbers in the response header (totalReviewCount, averageRating), and threw the rest away.
-- The same response carries every review with its reply, which is everything reputation
-- reporting needs: how many went unanswered, how long a reply takes, where the rating is
-- drifting, and which reviews still need a response today.
--
--   star_rating    1–5, or 0 when Google returns STAR_RATING_UNSPECIFIED
--   comment        the review text. Empty for a rating left without words.
--   reply_comment  the owner's reply, and replied_at when it was posted
--   created_at     when the reviewer posted it — what "reviews this month" counts
--
-- Content here is what Google already publishes on the listing: the reviewer's display name,
-- their words, and the owner's public reply. Nothing private is fetched or kept — no email,
-- no profile URL, no reviewer id.
--
-- Written best-effort by the GBP sync (lib/sync.ts upsertGBPReviews); read by the Reputation
-- page and the Overview. A new table only — the GBP sync keeps working before this is applied.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gbp_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,
  location_id    TEXT NOT NULL,
  review_id      TEXT NOT NULL,
  reviewer_name  TEXT,
  star_rating    SMALLINT NOT NULL DEFAULT 0,
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ,
  reply_comment  TEXT,
  replied_at     TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, review_id)
);

-- The page reads a client's reviews newest first, and counts the ones still unanswered.
CREATE INDEX IF NOT EXISTS idx_gbp_reviews_client_created
  ON public.gbp_reviews (client_id, created_at DESC);

-- Same lockdown as every other table here: RLS on with zero policies, so anon and
-- authenticated reach nothing and only the service role (createAdminClient) can read or write.
ALTER TABLE public.gbp_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gbp_reviews FROM anon, authenticated;
GRANT ALL ON public.gbp_reviews TO service_role;

COMMENT ON TABLE public.gbp_reviews IS
  'One row per Google Business Profile review, with the owner reply when there is one. Public listing content only. Written best-effort by the GBP sync.';
