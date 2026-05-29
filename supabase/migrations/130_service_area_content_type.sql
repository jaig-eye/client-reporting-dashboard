ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS content_type  TEXT NOT NULL DEFAULT 'blog'
    CHECK (content_type IN ('blog', 'service_area')),
  ADD COLUMN IF NOT EXISTS city          TEXT,
  ADD COLUMN IF NOT EXISTS state_abbr    TEXT,
  ADD COLUMN IF NOT EXISTS service_name  TEXT;

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS content_type    TEXT NOT NULL DEFAULT 'blog'
    CHECK (content_type IN ('blog', 'service_area')),
  ADD COLUMN IF NOT EXISTS city            TEXT,
  ADD COLUMN IF NOT EXISTS state_abbr      TEXT,
  ADD COLUMN IF NOT EXISTS service_name    TEXT,
  ADD COLUMN IF NOT EXISTS service_page_url TEXT;
