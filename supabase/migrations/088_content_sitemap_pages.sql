CREATE TABLE IF NOT EXISTS content_sitemap_pages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  title       TEXT,
  is_priority BOOLEAN NOT NULL DEFAULT false,
  is_excluded BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, url)
);
CREATE INDEX IF NOT EXISTS idx_sitemap_pages_client ON content_sitemap_pages(client_id);
