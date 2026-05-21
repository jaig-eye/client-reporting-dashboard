-- Store the last auto-push error on content_posts so failures are visible in the UI.

ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS auto_push_error TEXT;
