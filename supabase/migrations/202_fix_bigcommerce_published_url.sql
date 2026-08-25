-- ─────────────────────────────────────────────────────────────────────────────
-- Separate "where a human edits this post" from "where the public reads it".
--
-- Every BigCommerce push wrote a hardcoded admin URL into published_url:
--   https://store-{hash}.mybigcommerce.com/manage/content/blog
-- identical for every post, and a 404 for anyone not logged into the store admin.
-- publishBCPage (lib/connectors/bigcommerce.ts:115) already returns the real
-- permalink; both call sites discarded it.
--
-- Consequence: injectNearbyLinks filters on `published_url` truthiness
-- (injectNearbyLinks.ts:65) and then emits it as an href (:116-120), so every
-- internal link pointing at a BigCommerce sibling pointed at the store admin.
--
-- This migration moves the admin URL to its own column and NULLs the bogus
-- published_url values, which immediately stops the link injector from emitting
-- them. The real permalinks are restored by the backfill route:
--   POST /api/admin/content/backfill-bc-urls
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS platform_edit_url TEXT;

COMMENT ON COLUMN content_posts.platform_edit_url IS
  'Admin/CMS edit link (wp-admin or BigCommerce /manage/...). Never a public URL — do not emit in content.';
COMMENT ON COLUMN content_posts.published_url IS
  'PUBLIC permalink only. Must satisfy isPublicPermalink(); internal-link injection reads this.';

-- Preserve the admin URL, then clear it out of the public field.
UPDATE content_posts
   SET platform_edit_url = COALESCE(platform_edit_url, published_url)
 WHERE published_url IS NOT NULL
   AND (published_url LIKE '%/manage/%' OR published_url LIKE '%/wp-admin/%');

UPDATE content_posts
   SET published_url = NULL
 WHERE published_url IS NOT NULL
   AND (published_url LIKE '%/manage/%' OR published_url LIKE '%/wp-admin/%');
