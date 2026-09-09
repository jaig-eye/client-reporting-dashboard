-- ─────────────────────────────────────────────────────────────────────────────
-- Remember when a featured image is ALREADY an attachment on the client's site.
--
-- Picking an image from the client's own WordPress media library round-tripped it: the apply
-- path downloaded the file from their site into our storage bucket, and then, at publish,
-- uploadMediaToWordPress downloaded our copy and uploaded it back as a NEW attachment. One
-- picture became three — theirs, ours, and a duplicate of theirs — and their media library
-- grew a near-identical copy every time somebody reused an existing photo.
--
-- The attachment id is the whole fix. WordPress's REST API takes `featured_media` as an id,
-- so when the chosen image is already on the site the correct action is to reference it, not
-- to copy it: no download, no upload, no duplicate.
--
-- Scoped by connection deliberately. An attachment id is only meaningful on the site it lives
-- on, so it must never be used when the post is publishing somewhere else — a stale id from a
-- previous connection would otherwise attach whatever unrelated attachment happens to hold
-- that number on the new site.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS wp_featured_media_id integer,
  ADD COLUMN IF NOT EXISTS wp_featured_media_connection_id uuid;

COMMENT ON COLUMN public.content_posts.wp_featured_media_id IS
  'WordPress attachment id when the featured image is already in the client media library. Use directly as featured_media; do not re-upload.';
COMMENT ON COLUMN public.content_posts.wp_featured_media_connection_id IS
  'The connection wp_featured_media_id belongs to. Attachment ids are per-site, so the id is only valid when publishing through this same connection.';
