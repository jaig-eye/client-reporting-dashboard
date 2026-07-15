-- Add blog_url_prefix to content_settings so the AI knows the correct permalink
-- structure when generating internal links (e.g. /blog vs just /).
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS blog_url_prefix TEXT;
