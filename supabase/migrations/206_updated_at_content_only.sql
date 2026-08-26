-- ─────────────────────────────────────────────────────────────────────────────
-- Make "the live copy is out of date" mean what it says.
--
-- Migration 200 stamped updated_at on EVERY update to content_posts. That is too
-- broad: plenty of writes touch a row without changing anything a visitor sees.
-- The cron writes auto_pushed_at in a second statement right after a successful
-- push; the permalink backfill writes published_url; the quality gate writes
-- quality_hold_alerted_at; 202 rewrote published_url in bulk. Each bumped
-- updated_at past last_pushed_at, so a post that was byte-identical to the live
-- article rendered the amber "Live copy is out of date — the site still shows
-- the previous version" banner permanently.
--
-- 13 rows in production are already in that false state, purely from 202's own
-- UPDATEs. A banner that is always on is worse than no banner: it trains people
-- to ignore the one signal that tells them the client's site is wrong.
--
-- The fix is to define staleness against the columns that actually appear on the
-- published page. Everything else is bookkeeping and leaves updated_at alone.
-- ─────────────────────────────────────────────────────────────────────────────

-- Detach first: the repair below only holds if the trigger is not re-stamping
-- the very column being repaired. (Same reasoning as migration 200.)
DROP TRIGGER IF EXISTS trg_content_posts_updated_at ON content_posts;

CREATE OR REPLACE FUNCTION set_content_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- A push writes last_pushed_at from the app's clock. Snap both to the DB clock
  -- so the comparison comes from one source and reads as exactly in sync.
  IF NEW.last_pushed_at IS DISTINCT FROM OLD.last_pushed_at
     AND NEW.last_pushed_at IS NOT NULL THEN
    NEW.updated_at     = now();
    NEW.last_pushed_at = NEW.updated_at;
    RETURN NEW;
  END IF;

  -- A real edit: the DB copy is genuinely ahead of what the CMS is serving.
  IF NEW.content            IS DISTINCT FROM OLD.content
  OR NEW.title              IS DISTINCT FROM OLD.title
  OR NEW.seo_title          IS DISTINCT FROM OLD.seo_title
  OR NEW.meta_description   IS DISTINCT FROM OLD.meta_description
  OR NEW.slug               IS DISTINCT FROM OLD.slug
  OR NEW.featured_image_url IS DISTINCT FROM OLD.featured_image_url THEN
    NEW.updated_at = now();

    -- The quality report describes the OLD text, so it is now meaningless.
    --
    -- Two ways this bit before: a post held by the gate that a human regenerated
    -- to fix the findings kept its failing report, so every cron run re-held it
    -- while quality_hold_alerted_at suppressed any further alert — it could never
    -- publish and nobody was told. And a clean post hand-edited in the editor kept
    -- its passing report, so pasted-in unverified figures sailed through the
    -- unattended push.
    --
    -- Skipped when the same statement supplies a fresh report (generate and
    -- full-regenerate write content and quality_report together) — otherwise this
    -- would erase the report that was just computed.
    IF NEW.quality_report IS NOT DISTINCT FROM OLD.quality_report THEN
      NEW.quality_report          = NULL;
      NEW.quality_score           = NULL;
      NEW.quality_checked_at      = NULL;
      NEW.quality_hold_alerted_at = NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- Acquiring the regeneration lock IS worth stamping, even though no content
  -- changed. full-regenerate claims a post with status='generating' and the cron
  -- reaper releases claims older than an hour — and it measures that age with
  -- updated_at. If this fell through to the branch below, a post whose last real
  -- edit was days ago would look instantly stale to the reaper and be released
  -- out from under a job that is still running.
  IF NEW.status = 'generating' AND OLD.status IS DISTINCT FROM 'generating' THEN
    NEW.updated_at = now();
    RETURN NEW;
  END IF;

  -- Bookkeeping only (auto_pushed_at, other status moves, quality_*,
  -- archived_at, platform ids, published_url...). Nothing a reader would notice
  -- changed, so the staleness comparison must be left exactly as it was.
  NEW.updated_at = OLD.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Repair the rows that bookkeeping writes already falsely marked stale.
--
-- The predicate matters, because `updated_at > last_pushed_at` on a draft_saved
-- row is ALSO exactly what a genuine pending edit looks like — the editor's PATCH
-- never changes status. Clearing every such row would assert the client's site is
-- in sync while it serves the old paragraphs, and nothing would ever re-raise the
-- flag, so the repair has to identify bookkeeping specifically.
--
-- It can, precisely: a bulk UPDATE stamps every row it touches with one
-- transaction timestamp. The 12 affected rows in production all carry the
-- identical updated_at (2026-08-25 17:27:03.626852) from 202's rewrite, across
-- different clients and last_pushed_at values days apart. Two humans cannot save
-- two different posts in the same microsecond, so a shared exact timestamp is a
-- machine write and a unique one is a person. Elapsed time does NOT separate them
-- — the real gaps here run from 8 to 21 days — which is why this keys on the
-- stamp rather than on a window.
--
-- A bulk statement that happened to touch a single row is left flagged. That is
-- the safe direction to be wrong in: a spurious "out of date" banner costs a
-- needless re-push, a missing one costs a stale page nobody notices.
WITH bulk_stamps AS (
  SELECT updated_at
    FROM content_posts
   WHERE last_pushed_at IS NOT NULL
     AND updated_at > last_pushed_at
     AND status IN ('draft_saved', 'published')
   GROUP BY updated_at
  HAVING count(*) > 1
)
UPDATE content_posts p
   SET updated_at = p.last_pushed_at
  FROM bulk_stamps b
 WHERE p.updated_at = b.updated_at
   AND p.last_pushed_at IS NOT NULL
   AND p.updated_at > p.last_pushed_at
   AND p.status IN ('draft_saved', 'published');

CREATE TRIGGER trg_content_posts_updated_at
  BEFORE UPDATE ON content_posts
  FOR EACH ROW EXECUTE FUNCTION set_content_posts_updated_at();
