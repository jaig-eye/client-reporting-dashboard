-- Migration 050: Phase 10 — sync schedule, content scheduling, topics status

-- ── content_settings: per-client monthly publish schedule ────────────────────
ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS monthly_publish_day INT
    CHECK (monthly_publish_day BETWEEN 1 AND 28),         -- day of month (1–28) to auto-publish
  ADD COLUMN IF NOT EXISTS topics_per_run      INT NOT NULL DEFAULT 5,  -- how many topics to generate per cycle
  ADD COLUMN IF NOT EXISTS weeks_ahead         INT NOT NULL DEFAULT 4;  -- how far ahead to set target_publish_date

-- ── content_topics: add 'scheduled' status ───────────────────────────────────
-- Drop existing check constraint and recreate with the new status value
ALTER TABLE content_topics
  DROP CONSTRAINT IF EXISTS content_topics_status_check;
ALTER TABLE content_topics
  ADD CONSTRAINT content_topics_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'generating', 'generated', 'scheduled'));

-- ── agency_settings: sync schedule fields ────────────────────────────────────
ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS sync_frequency    TEXT NOT NULL DEFAULT 'daily'
    CHECK (sync_frequency IN ('hourly', 'every6h', 'every12h', 'daily', 'weekly')),
  ADD COLUMN IF NOT EXISTS sync_hour_utc     INT  NOT NULL DEFAULT 6
    CHECK (sync_hour_utc BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS sync_day_of_week  INT
    CHECK (sync_day_of_week BETWEEN 0 AND 6),              -- NULL = not weekly
  ADD COLUMN IF NOT EXISTS notify_schedule_generated BOOLEAN NOT NULL DEFAULT true;
