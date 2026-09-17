-- ─────────────────────────────────────────────────────────────────────────────
-- 221: Social Planner posts, one row per post we published for a client
--
-- We publish clients' new reviews to their Facebook page automatically, and until now the
-- dashboard said nothing about it — the work happened and the client never saw it.
--
-- Everything in a client's GHL Social Planner was scheduled by us, which is what makes this
-- reportable at all: reading the Page itself through Meta would hand back the client's own
-- posts mixed in with ours, with nothing in the API to tell them apart. Social Planner only
-- knows about posts Social Planner made, so authorship comes free.
--
--   platforms        which networks one post went to ('facebook', 'instagram', 'google', …)
--   summary          the post copy, as published
--   likes/comments/shares   GHL's own insights, when the network reports them back
--   review_id        the gbp_reviews row this post was sharing, when the text matches one.
--                    Best-effort and nullable: a post that quotes no review just has no link.
--
-- One row per post, never per network, so a post that went to two pages can never double-count
-- its own engagement.
--
-- Content here is the marketing copy we published publicly on the client's behalf. No GHL user
-- records are fetched (the sync never asks for includeUsers), so no staff identities are stored.
--
-- Written best-effort by the GHL sync (lib/sync.ts upsertGhlSocialPosts); read by the Reputation
-- page. A new table only — the GHL sync keeps working before this is applied, and keeps working
-- afterwards for any client whose token lacks the socialplanner/post.readonly scope.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ghl_social_posts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id)            ON DELETE CASCADE,
  location_id    TEXT NOT NULL,
  post_id        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'unknown',
  platforms      TEXT[] NOT NULL DEFAULT '{}',
  account_names  TEXT[] NOT NULL DEFAULT '{}',
  summary        TEXT,
  media_url      TEXT,
  post_url       TEXT,
  created_at     TIMESTAMPTZ,
  published_at   TIMESTAMPTZ,
  likes          INTEGER NOT NULL DEFAULT 0,
  comments       INTEGER NOT NULL DEFAULT 0,
  shares         INTEGER NOT NULL DEFAULT 0,
  review_id      TEXT,
  raw            JSONB,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, post_id)
);

-- The page reads a client's posts newest first, inside a date range.
CREATE INDEX IF NOT EXISTS idx_ghl_social_posts_client_published
  ON public.ghl_social_posts (client_id, published_at DESC);

-- Same lockdown as every other table here: RLS on with zero policies, so anon and
-- authenticated reach nothing and only the service role (createAdminClient) can read or write.
ALTER TABLE public.ghl_social_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ghl_social_posts FROM anon, authenticated;
GRANT ALL ON public.ghl_social_posts TO service_role;

COMMENT ON TABLE public.ghl_social_posts IS
  'One row per GHL Social Planner post published for a client. Our own marketing copy only. Written best-effort by the GHL sync; needs socialplanner/post.readonly on the client token.';
