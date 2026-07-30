-- Track which sub-sitemap each page URL came from (e.g. post-sitemap.xml vs page-sitemap.xml).
-- Used to identify existing blog posts for cannibalization prevention without URL heuristics.
ALTER TABLE content_sitemap_pages ADD COLUMN IF NOT EXISTS source_sitemap text;
