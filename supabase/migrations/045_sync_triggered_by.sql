-- ─────────────────────────────────────────────────────────────────────────────
-- 045: Add triggered_by to sync_jobs
-- ─────────────────────────────────────────────────────────────────────────────
-- Records who triggered each sync: cron job, admin user, or system backfill.
-- Nullable so existing rows display as '—' without a backfill.

ALTER TABLE sync_jobs
  ADD COLUMN IF NOT EXISTS triggered_by TEXT
  CHECK (triggered_by IN ('cron', 'admin', 'system'));
