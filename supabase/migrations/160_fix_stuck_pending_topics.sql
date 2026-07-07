-- Reset old pending topics with no post to approved so the cron picks them up
UPDATE content_topics
SET status = 'approved'
WHERE status = 'pending'
  AND post_id IS NULL
  AND created_at < NOW() - INTERVAL '1 day';

-- Reset topics stuck in 'generated' whose linked post is rejected
UPDATE content_topics ct
SET status = 'approved', post_id = NULL
FROM content_posts cp
WHERE ct.post_id = cp.id
  AND ct.status = 'generated'
  AND cp.status = 'rejected';
