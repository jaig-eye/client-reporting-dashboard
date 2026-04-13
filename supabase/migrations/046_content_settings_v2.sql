-- ─────────────────────────────────────────────────────────────────────────────
-- 046: Content Settings v2 — flexible scheduling + target length
-- ─────────────────────────────────────────────────────────────────────────────

-- Replace the raw cron_schedule string with user-friendly frequency fields.
-- schedule_frequency: how often to generate
-- schedule_day_of_week: which day (0=Sun … 6=Sat); relevant for weekly/biweekly
-- target_length: approximate word count target for generated posts

ALTER TABLE content_settings
  ADD COLUMN IF NOT EXISTS schedule_frequency    TEXT    NOT NULL DEFAULT 'weekly'
    CHECK (schedule_frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS schedule_day_of_week  INT     DEFAULT 1
    CHECK (schedule_day_of_week BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS target_length         INT     NOT NULL DEFAULT 1500
    CHECK (target_length BETWEEN 300 AND 5000);

-- cron_schedule column is kept for backwards compatibility but no longer used by the app.
