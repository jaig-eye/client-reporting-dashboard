-- ─────────────────────────────────────────────────────────────────────────────
-- Make deleting a scheduled topic/post a FULL STOP for that publish slot.
--
-- THE PROBLEM
-- The content cron decides whether to generate for a slot by asking "does a topic
-- already exist for this client on this date?" (content-topics route, the `existing`
-- guard). That makes deletion self-defeating: removing the row is exactly what frees
-- the slot, so the next run — at most two hours later — generates a replacement, and
-- the thing you deleted reappears. Rejecting did not help either, because 'rejected'
-- was absent from that guard's status list, so a rejected slot was treated as empty
-- and refilled too.
--
-- WHY A SEPARATE TABLE RATHER THAN A SOFT-DELETE FLAG
-- A `deleted_at` column on content_topics/content_posts would work, but every list,
-- count, calendar and pipeline query across the admin UI would then need a
-- `deleted_at IS NULL` filter, and the first one anybody forgot would render deleted
-- content as live. Recording the SUPPRESSION instead keeps deletion a real delete —
-- rows genuinely go away, every existing read query stays correct — and confines the
-- new behaviour to the one place that needs it: the generator's slot check.
--
-- It also keeps the two intents cleanly separated, which is the distinction the app
-- cares about:
--   • the SLOT is suppressed  → nothing regenerates on that date
--   • the SUBJECT is not      → a deleted topic leaves no row, so it is absent from
--                               the avoid-list in lib/content/generateTopics.ts and
--                               is free to be written about again on a future date.
-- Rejection remains the opposite signal: the row stays, so the subject IS in the
-- avoid-list and is never suggested again.
--
-- Suppressions are scoped to (client_id, target_publish_date). Re-suppressing the
-- same slot is idempotent via the unique constraint.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.content_slot_suppressions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  target_publish_date DATE        NOT NULL,
  -- Free text, for the audit trail only: which action created this and why.
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT content_slot_suppressions_unique UNIQUE (client_id, target_publish_date)
);

-- The generator looks up suppressions by client and a batch of candidate dates, so
-- the unique constraint's index already serves the hot path. This one supports the
-- housekeeping sweep below.
CREATE INDEX IF NOT EXISTS idx_content_slot_suppressions_date
  ON public.content_slot_suppressions(target_publish_date);

-- Same posture as every other table in this schema: RLS ENABLED with ZERO policies.
-- The service role bypasses RLS, and anon/authenticated can read nothing. See
-- migration 196 for why that is the correct configuration for this app.
ALTER TABLE public.content_slot_suppressions ENABLE ROW LEVEL SECURITY;

-- Explicit grants rather than relying on the PUBLIC default, which migrations 196
-- and 208 revoke.
REVOKE ALL ON TABLE public.content_slot_suppressions FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_slot_suppressions TO service_role;

COMMENT ON TABLE public.content_slot_suppressions IS
  'A publish date that must NOT be auto-filled by the content generator, because a human deleted what was scheduled there. Deleting a topic/post inserts a row; the content-topics cron and calendar/generate both skip suppressed slots. Removing a row re-opens the slot.';
