-- v5.7.0: Topic guidelines, competitor research, cluster grouping, SerpAPI integration

-- Per-client topic content guidelines (what topics/keywords to avoid)
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS topic_guidelines TEXT;

-- Topics: competitor research results, title direction notes, cluster grouping
ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS competitors_researched JSONB,
  ADD COLUMN IF NOT EXISTS edit_notes             TEXT,
  ADD COLUMN IF NOT EXISTS cluster_group          TEXT;

-- Agency settings: SerpAPI integration for competitor research
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS serp_api_key      TEXT,
  ADD COLUMN IF NOT EXISTS serp_api_provider TEXT DEFAULT 'serpapi';
