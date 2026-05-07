-- 098: Content tool — SEO brief, E-E-A-T, schedule start date, SEO score
--
-- Adds columns needed for the full content tool architecture:
--   content_settings  → schedule_start_date, topics_per_run, weeks_ahead,
--                        monthly_publish_day, eeat_data
--   content_topics    → keyword_opportunity, ranking_strategy, audience_intent,
--                        why_now, competition_level, seo_brief
--   content_posts     → seo_score, schema_type, image_alt_text, image_concept, excerpt

-- ── content_settings ─────────────────────────────────────────────────────────

ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS schedule_start_date  DATE    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS topics_per_run       INT     NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS weeks_ahead          INT     NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS monthly_publish_day  INT     CHECK (monthly_publish_day BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS eeat_data            JSONB   DEFAULT NULL;

-- ── content_topics ────────────────────────────────────────────────────────────
-- Fields below may already exist from migration 094 — IF NOT EXISTS is safe.

ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS keyword_opportunity  TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ranking_strategy     TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS audience_intent      TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS why_now              TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS competition_level    TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS seo_brief            JSONB   DEFAULT NULL;

-- ── content_posts ─────────────────────────────────────────────────────────────

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS seo_score      JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS schema_type    TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS image_alt_text TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS image_concept  TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS excerpt        TEXT    DEFAULT NULL;
