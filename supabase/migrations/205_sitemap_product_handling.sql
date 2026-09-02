-- ─────────────────────────────────────────────────────────────────────────────
-- Product-sitemap handling for ecommerce clients.
--
-- THE PROBLEM, measured: content_sitemap_pages caps a client at 500 URLs, filled
-- in sitemap-index order. A local-service client never notices. A store with a
-- few thousand SKUs fills all 500 slots with products before page-sitemap.xml or
-- post-sitemap.xml is reached, so the internal-linking candidate list and the
-- cannibalisation avoid-list end up containing products and nothing else — the
-- service pages and articles that actually matter are evicted.
--
-- Cyrious Plasma Tables is a small example of the shape: 102 URLs, of which 37
-- (product + product_cat) are commerce. Scale that catalogue to 5,000 and the
-- cap does the damage.
--
-- WHY THIS IS NOT A BLANKET EXCLUSION.
-- For an ecommerce client, linking an article to the product it discusses is the
-- entire commercial point, so removing products by default would break the most
-- valuable link in the funnel. The fix is proportional representation (a
-- per-sub-sitemap quota in the parser), and this flag exists only for clients
-- where individual SKUs genuinely are not useful link targets.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS exclude_product_sitemaps BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN content_settings.exclude_product_sitemaps IS
  'Skip individual-product sub-sitemaps when caching pages. Category/collection sitemaps are always kept — those are strong link targets. Default false: products are usually the most valuable thing to link to on a store.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 183 dependency
--
-- content_sitemap_pages.source_sitemap (migration 183) is NOT applied on
-- production as of writing, which is what broke sitemap caching entirely: the
-- upsert in /api/admin/content/sitemap-parse writes that column, PostgREST
-- rejected the whole statement, the route's unchecked error meant it returned an
-- empty 200, and the empty cache silently disabled cannibalisation protection.
--
-- Repeated here (idempotently) so applying this migration cannot leave the
-- parser in that state again. The application also degrades gracefully now, but
-- the column is what makes per-sitemap quotas and blog detection exact rather
-- than heuristic.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE content_sitemap_pages
  ADD COLUMN IF NOT EXISTS source_sitemap TEXT;

COMMENT ON COLUMN content_sitemap_pages.source_sitemap IS
  'Which sub-sitemap this URL came from. Drives blog-post detection for the cannibalisation avoid-list and the per-sitemap quota that stops a large catalogue crowding out every other page.';

CREATE INDEX IF NOT EXISTS idx_content_sitemap_pages_source
  ON content_sitemap_pages (client_id, source_sitemap);
