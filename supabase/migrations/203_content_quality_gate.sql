-- ─────────────────────────────────────────────────────────────────────────────
-- Pre-publish content quality gate.
--
-- Context: Google's August 2026 spam update was reported to target AI content by
-- what it was created FOR rather than what it was created WITH. Two findings from
-- that reporting drive this migration:
--
--   1. Sites "automatically posting ... are being filtered and dropped across the
--      board", while publications doing "manual visual checks by humans before
--      publishing" were unaffected. Unattended publishing is the risk, so the gate
--      blocks the CRON auto-push path on critical findings and never blocks a human.
--
--   2. Pages sharing the "same AI slop formatting of subheadings and bullets" were
--      called out. That is a corpus-level signal, so the report is stored per post
--      and compares against the client's existing posts.
--
-- The report is advisory data, not a state machine: it never changes `status`.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS quality_report    JSONB,
  ADD COLUMN IF NOT EXISTS quality_score     INT,
  ADD COLUMN IF NOT EXISTS quality_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN content_posts.quality_report IS
  'QualityReport from src/lib/content/qualityGate.ts — findings[], score, blocksAutoPush, wordCount.';
COMMENT ON COLUMN content_posts.quality_score IS
  'Denormalised report score (0-100) so the queue can sort/filter without unpacking JSONB.';

-- The auto-push selector reads this; a partial index keeps that scan cheap.
CREATE INDEX IF NOT EXISTS idx_content_posts_quality_score
  ON content_posts (client_id, quality_score)
  WHERE quality_score IS NOT NULL;

-- Regulated verticals get the invented-figure checks (rates, APRs, credit-score
-- requirements, approval odds) and the stricter claim bans in the writer prompt.
-- NULL = not regulated, which is the correct default for most clients.
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS vertical TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_settings_vertical_check') THEN
    ALTER TABLE content_settings
      ADD CONSTRAINT content_settings_vertical_check
      CHECK (vertical IS NULL OR vertical IN ('finance','medical','legal','insurance'));
  END IF;
END $$;

COMMENT ON COLUMN content_settings.vertical IS
  'Regulated vertical. Adds non-negotiable claim bans to the writer prompt and enables financial-figure detection in the quality gate.';

-- Agency-level switch for the auto-push block, so an agency can opt out of the
-- gate holding posts back if they would rather ship and review after.
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS quality_gate_blocks_autopush BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN agency_settings.quality_gate_blocks_autopush IS
  'When true (default) a critical quality finding holds a post back from the unattended cron push. Manual publishing is never blocked.';

-- Dedup marker for the auto-push hold alert.
--
-- Without this the cron re-raises an identical admin_alerts row on every run
-- (every 2 hours, indefinitely) for any post the gate holds back, because the
-- post legitimately stays 'approved' and keeps matching the selector.
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS quality_hold_alerted_at TIMESTAMPTZ;

COMMENT ON COLUMN content_posts.quality_hold_alerted_at IS
  'Last time the quality gate raised a hold alert for this post. Cleared when the post is regenerated or re-checked so a genuinely new hold alerts again.';
