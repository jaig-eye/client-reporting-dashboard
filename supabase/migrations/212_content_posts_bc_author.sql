-- ─────────────────────────────────────────────────────────────────────────────
-- Per-post BigCommerce byline.
--
-- The review drawer has always had a "BigCommerce author" input, and it has always been
-- discarded: ContentPostEditor sends bcAuthorName on save, but PATCH /api/admin/content/
-- posts/[id] has no such field, so the value never reached the database. The reviewer typed
-- a byline, the drawer went dirty, Save flashed "Saved" and the published article still went
-- out under content_settings.bc_author or the literal 'Admin'.
--
-- Nullable with no default: NULL keeps the existing behaviour exactly, so every post written
-- before this migration continues to fall back to the client-level bc_author. Only a post a
-- human explicitly gave a byline to overrides it.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS bc_author_name text;

COMMENT ON COLUMN public.content_posts.bc_author_name IS
  'Per-post BigCommerce byline set in the review drawer. NULL falls back to content_settings.bc_author, then to ''Admin''.';
