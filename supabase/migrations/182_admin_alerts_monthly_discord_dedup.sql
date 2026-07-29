-- Prevent duplicate monthly Discord notifications from concurrent cron invocations.
-- Two simultaneous runs both passing the read-check would insert two dedup rows
-- and fire Discord twice. This unique index makes the second INSERT fail (23505),
-- which the application already handles by skipping the Discord send.
CREATE UNIQUE INDEX IF NOT EXISTS admin_alerts_monthly_discord_dedup_idx
  ON admin_alerts (
    (meta->>'content_type'),
    date_trunc('month', created_at)
  )
  WHERE type = 'content'
    AND meta->>'content_type' IN ('monthly_review_ready', 'monthly_mid_check');
