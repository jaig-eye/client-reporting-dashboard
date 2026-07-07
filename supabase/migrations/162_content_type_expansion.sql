-- Add two new content types to topics and posts
ALTER TABLE content_topics DROP CONSTRAINT IF EXISTS content_topics_content_type_check;
ALTER TABLE content_topics ADD CONSTRAINT content_topics_content_type_check
  CHECK (content_type IN ('blog', 'service_area', 'service_page', 'regular_page'));

ALTER TABLE content_posts DROP CONSTRAINT IF EXISTS content_posts_content_type_check;
ALTER TABLE content_posts ADD CONSTRAINT content_posts_content_type_check
  CHECK (content_type IN ('blog', 'service_area', 'service_page', 'regular_page'));

-- Regular pages need a free-text focus field
ALTER TABLE content_topics ADD COLUMN IF NOT EXISTS custom_focus TEXT;
ALTER TABLE content_posts  ADD COLUMN IF NOT EXISTS custom_focus TEXT;

-- Per-type master prompts on agency_settings
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS service_page_master_prompt TEXT,
  ADD COLUMN IF NOT EXISTS regular_page_master_prompt TEXT;
