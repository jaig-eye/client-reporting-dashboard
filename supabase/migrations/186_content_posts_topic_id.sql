-- Link content_posts back to the topic that generated them.
-- content_topics.post_id already points forward (topic → post);
-- this reverse column lets the editor load strategy data without a reverse join.
-- Backfilled from content_topics.post_id on first apply.
ALTER TABLE content_posts
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES content_topics(id) ON DELETE SET NULL;

UPDATE content_posts p
SET    topic_id = t.id
FROM   content_topics t
WHERE  t.post_id = p.id
  AND  p.topic_id IS NULL;
