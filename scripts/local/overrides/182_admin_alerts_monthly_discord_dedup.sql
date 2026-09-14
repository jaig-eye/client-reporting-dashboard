-- Local override for supabase/migrations/182_admin_alerts_monthly_discord_dedup.sql
--
-- The original indexes date_trunc('month', created_at) on a timestamptz column. For timestamptz
-- that function is only STABLE — the result depends on the session time zone — and Postgres refuses
-- non-IMMUTABLE functions in an index expression, on every version including production's 17. So
-- the original very likely never applied in production either, and the duplicate-Discord protection
-- it describes does not exist there.
--
-- Truncating in UTC is IMMUTABLE and buckets the months the cron means. Production needs the same
-- change as a new migration.
CREATE UNIQUE INDEX IF NOT EXISTS admin_alerts_monthly_discord_dedup_idx
  ON admin_alerts (
    (meta->>'content_type'),
    date_trunc('month', created_at AT TIME ZONE 'UTC')
  )
  WHERE type = 'content'
    AND meta->>'content_type' IN ('monthly_review_ready', 'monthly_mid_check');
