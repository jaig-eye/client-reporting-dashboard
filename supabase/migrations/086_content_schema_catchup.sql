-- Migration 086: Content schema catch-up
-- Idempotent (all ADD COLUMN IF NOT EXISTS). Safe to run even if some
-- migrations (048, 049, 050, 064, 065, 066, 067, 084) were already applied.

-- ── content_posts ─────────────────────────────────────────────────────────────
-- 048: SEO fields
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS seo_title      TEXT,
  ADD COLUMN IF NOT EXISTS suggested_tags TEXT[];

-- 049: scheduling columns
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS scheduled_publish_date DATE,
  ADD COLUMN IF NOT EXISTS auto_publish           BOOLEAN NOT NULL DEFAULT false;

-- 064: featured image
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS featured_image_url TEXT;

-- ── content_topics ─────────────────────────────────────────────────────────────
-- 065: SEO brief fields
ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS target_keyword     TEXT,
  ADD COLUMN IF NOT EXISTS page_to_support    TEXT,
  ADD COLUMN IF NOT EXISTS gsc_boost_keyword  TEXT,
  ADD COLUMN IF NOT EXISTS search_volume      INTEGER,
  ADD COLUMN IF NOT EXISTS keyword_difficulty INTEGER,
  ADD COLUMN IF NOT EXISTS suggested_title    TEXT,
  ADD COLUMN IF NOT EXISTS outgoing_links     TEXT[],
  ADD COLUMN IF NOT EXISTS internal_links     TEXT[],
  ADD COLUMN IF NOT EXISTS word_count_target  INTEGER DEFAULT 1500;

-- 084: rationale + error fields
ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS keyword_opportunity TEXT,
  ADD COLUMN IF NOT EXISTS ranking_strategy    TEXT,
  ADD COLUMN IF NOT EXISTS audience_intent     TEXT,
  ADD COLUMN IF NOT EXISTS why_now             TEXT,
  ADD COLUMN IF NOT EXISTS competition_level   TEXT,
  ADD COLUMN IF NOT EXISTS generation_error    TEXT;

-- updated_at for cron stuck-detection (was never in a migration)
ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE content_topics SET updated_at = created_at WHERE updated_at IS NULL;

-- 067: extend status CHECK to include 'scheduled'
ALTER TABLE content_topics
  DROP CONSTRAINT IF EXISTS content_topics_status_check;
ALTER TABLE content_topics
  ADD CONSTRAINT content_topics_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'generating', 'generated', 'scheduled'));

-- ── content_settings ──────────────────────────────────────────────────────────
-- 046: scheduling fields
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS schedule_frequency   TEXT    DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS schedule_day_of_week INT     DEFAULT 1,
  ADD COLUMN IF NOT EXISTS target_length        INT     NOT NULL DEFAULT 1500;

-- 050: per-client topic count + lookahead
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS monthly_publish_day INT,
  ADD COLUMN IF NOT EXISTS topics_per_run      INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS weeks_ahead         INT NOT NULL DEFAULT 4;

-- 062/048: phone number
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- 067: multi-sitemap + manual links
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS sitemap_urls     TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS manual_link_urls TEXT[] DEFAULT '{}';

-- 066: widen schedule_frequency CHECK (drop old constraint, add expanded one)
ALTER TABLE content_settings
  DROP CONSTRAINT IF EXISTS content_settings_schedule_frequency_check;
ALTER TABLE content_settings
  ADD CONSTRAINT content_settings_schedule_frequency_check
  CHECK (
    schedule_frequency IS NULL
    OR schedule_frequency IN (
      'daily', 'weekly', 'biweekly',
      'monthly', 'monthly_first', 'monthly_mid', 'monthly_end'
    )
  );
