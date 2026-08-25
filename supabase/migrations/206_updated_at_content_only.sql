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
-- Only touches rows that ARE on a CMS and have no evidence of a real edit
-- pending; a post genuinely awaiting a re-push is left flagged.
UPDATE content_posts
   SET updated_at = last_pushed_at
 WHERE last_pushed_at IS NOT NULL
   AND updated_at > last_pushed_at
   AND status IN ('draft_saved', 'published');

CREATE TRIGGER trg_content_posts_updated_at
  BEFORE UPDATE ON content_posts
  FOR EACH ROW EXECUTE FUNCTION set_content_posts_updated_at();
