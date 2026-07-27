-- 179: Add 'published' to content_topics status CHECK constraint.
-- Required for the archive flow in dismiss/route.ts which marks a topic as
-- 'published' when its associated post is archived from the dashboard.
ALTER TABLE content_topics
  DROP CONSTRAINT IF EXISTS content_topics_status_check;
ALTER TABLE content_topics
  ADD CONSTRAINT content_topics_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'generating', 'generated', 'scheduled', 'published'));
