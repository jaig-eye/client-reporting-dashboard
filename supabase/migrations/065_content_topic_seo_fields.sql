-- Migration 065: Add SEO brief fields to content_topics
-- Enables SEOContentHero-style topic briefs with keyword research, GSC insights,
-- internal/external link suggestions, and content structure guidance.
ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS target_keyword      TEXT,
  ADD COLUMN IF NOT EXISTS gsc_boost_keyword   TEXT,
  ADD COLUMN IF NOT EXISTS search_volume       INTEGER,
  ADD COLUMN IF NOT EXISTS keyword_difficulty  INTEGER,
  ADD COLUMN IF NOT EXISTS suggested_title     TEXT,
  ADD COLUMN IF NOT EXISTS outgoing_links      TEXT[],
  ADD COLUMN IF NOT EXISTS internal_links      TEXT[],
  ADD COLUMN IF NOT EXISTS word_count_target   INTEGER DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS page_to_support     TEXT;
