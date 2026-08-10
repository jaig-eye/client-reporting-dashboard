-- Add 'generating' to content_posts.status so in-progress full-regenerate jobs
-- are visible across page refreshes. The PATCH allowlist in post/route.ts already
-- included 'generating' but the DB constraint did not, making it a latent error.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE  conrelid = 'content_posts'::regclass AND contype = 'c' AND conname LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE content_posts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE content_posts
  ADD CONSTRAINT content_posts_status_check
  CHECK (status IN ('pending','approved','rejected','published','draft_saved','for_review','generating'));
