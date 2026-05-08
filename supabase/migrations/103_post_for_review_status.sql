-- Add 'for_review' to the content_posts status enum.
-- Posts land here after generation instead of being auto-uploaded to WordPress.
ALTER TABLE content_posts DROP CONSTRAINT IF EXISTS content_posts_status_check;
ALTER TABLE content_posts ADD CONSTRAINT content_posts_status_check
  CHECK (status IN ('pending','approved','rejected','published','draft_saved','for_review'));
