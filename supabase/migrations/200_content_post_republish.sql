-- ─────────────────────────────────────────────────────────────────────────────
-- Make "regenerate a post that is already live" a real, supported route.
--
-- Before this, regenerating a pushed post left wp_post_id/bc_post_id and
-- admin_approved_at intact while flipping status back to 'for_review'. The new
-- content never reached the CMS, and /approve refused the row forever because of
-- its `if (p.wp_post_id) return 400` guard — permanently wedged.
--
-- The supported route is now: regenerate keeps the platform id, and a re-push
-- UPDATES the existing CMS post instead of creating a second one.
--
-- `last_pushed_at` is what makes staleness computable: updated_at > last_pushed_at
-- means the DB copy is newer than what the client's site is serving.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_pushed_at TIMESTAMPTZ;

-- IMPORTANT: staleness compares two clocks. updated_at is written by the trigger
-- below using the DATABASE clock; last_pushed_at is written by the application in
-- the same UPDATE using the NODE clock. Those differ by at least the round-trip,
-- so a naive comparison marks every post stale the instant it is pushed. The
-- trigger therefore snaps last_pushed_at to the same now() whenever a push writes
-- it, which makes the two exactly equal on a push and keeps the comparison honest.

COMMENT ON COLUMN content_posts.updated_at IS
  'Maintained by trg_content_posts_updated_at. posts/[id]/restore already wrote this column before it existed.';
COMMENT ON COLUMN content_posts.last_pushed_at IS
  'When the CMS copy was last written. updated_at > last_pushed_at => the live post is stale.';

-- Keep updated_at honest without touching ~20 call sites that hand-write updates.
CREATE OR REPLACE FUNCTION set_content_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  -- A push writes last_pushed_at in the same statement, from the app's clock.
  -- Snap it to the DB clock so "is the live copy older than the DB copy?" is a
  -- comparison of two values from the same source.
  IF NEW.last_pushed_at IS DISTINCT FROM OLD.last_pushed_at
     AND NEW.last_pushed_at IS NOT NULL THEN
    NEW.last_pushed_at = NEW.updated_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ORDER MATTERS: both backfills below run with the trigger DETACHED.
-- The trigger forces updated_at = now() on every UPDATE, so running the second
-- backfill while it is attached would stamp the migration time straight back in —
-- reintroducing exactly the day-one staleness this is fixing. Dropping it up
-- front (rather than only before the CREATE) also makes re-running this whole
-- migration safe, since the trigger is already attached from the first run.
DROP TRIGGER IF EXISTS trg_content_posts_updated_at ON content_posts;

-- Backfill 1: anything already on a CMS was last pushed when it was approved.
UPDATE content_posts
   SET last_pushed_at = COALESCE(admin_approved_at, now())
 WHERE last_pushed_at IS NULL
   AND (wp_post_id IS NOT NULL OR bc_post_id IS NOT NULL);

-- Backfill 2: ADD COLUMN ... DEFAULT now() stamped every existing row with the
-- migration time, which is newer than the admin_approved_at just backfilled
-- above. At migration time there is no evidence any live copy is out of date,
-- so assert the two are in sync rather than flagging the whole table stale.
UPDATE content_posts
   SET updated_at = last_pushed_at
 WHERE last_pushed_at IS NOT NULL
   AND updated_at > last_pushed_at;

DROP TRIGGER IF EXISTS trg_content_posts_updated_at ON content_posts;
CREATE TRIGGER trg_content_posts_updated_at
  BEFORE UPDATE ON content_posts
  FOR EACH ROW EXECUTE FUNCTION set_content_posts_updated_at();

-- NOTE ON THE STATE MODEL
--
-- Migration 156 declared "admin_approved_at IS NOT NULL <-> status = 'approved'".
-- That invariant is too strict once regenerate-while-live is a supported route,
-- and it is already false for every normally-published post (they carry an
-- approval timestamp at status 'draft_saved'). The four columns are independent
-- facts, and the useful states are derived from them rather than crammed into
-- `status`:
--
--   admin_approved_at   a human approved this at some point (historical; never cleared)
--   wp/bc_post_id       a CMS copy exists
--   last_pushed_at      when that CMS copy was last written
--   updated_at          when the DB copy last changed
--   status              where it sits in the review workflow
--
-- So "approved, pushed, then regenerated" is legitimately:
--   status='for_review' + bc_post_id set + updated_at > last_pushed_at
-- i.e. "live, the live copy is now stale, and a replacement is awaiting review".
-- That is a real state a human needs to see, not a corruption to normalise away.
-- The backfill above is what makes it computable; no status rewrite is needed.
