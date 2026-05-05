-- 094: Add search_intent + secondary_keywords to content_topics,
--      add cta_list to content_settings

ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS search_intent      TEXT,
  ADD COLUMN IF NOT EXISTS secondary_keywords TEXT;

ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS cta_list TEXT;
