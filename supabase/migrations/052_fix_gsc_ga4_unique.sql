-- Migration 052: Fix unique constraints on gsc_metrics and ga4_metrics
--
-- gsc_metrics: The original unique index used COALESCE expressions which cannot
-- be used as an ON CONFLICT inference target with plain column names. Every
-- upsert was silently failing. Fix: make query/page/country NOT NULL with
-- default '' and replace the expression index with a plain UNIQUE index.
--
-- ga4_metrics: The table was created before channel_group was added to the
-- schema, so CREATE TABLE IF NOT EXISTS silently skipped it. The column is
-- missing, which causes every upsert to fail. Fix: add the column and the
-- UNIQUE constraint if they don't already exist.

-- ── gsc_metrics ───────────────────────────────────────────────────────────────

UPDATE gsc_metrics SET
  query   = COALESCE(query,   ''),
  page    = COALESCE(page,    ''),
  country = COALESCE(country, '')
WHERE query IS NULL OR page IS NULL OR country IS NULL;

ALTER TABLE gsc_metrics
  ALTER COLUMN query   SET DEFAULT '',
  ALTER COLUMN page    SET DEFAULT '',
  ALTER COLUMN country SET DEFAULT '';

ALTER TABLE gsc_metrics
  ALTER COLUMN query   SET NOT NULL,
  ALTER COLUMN page    SET NOT NULL,
  ALTER COLUMN country SET NOT NULL;

DROP INDEX IF EXISTS idx_gsc_unique_row;

CREATE UNIQUE INDEX idx_gsc_unique_row
  ON gsc_metrics(connection_id, date, query, page, country);

-- ── ga4_metrics ───────────────────────────────────────────────────────────────

-- Add channel_group if it was missing (table pre-dated migration 038's full schema)
ALTER TABLE ga4_metrics
  ADD COLUMN IF NOT EXISTS channel_group TEXT NOT NULL DEFAULT 'Direct';

-- Add the UNIQUE constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ga4_metrics'::regclass
      AND contype = 'u'
      AND conname = 'ga4_metrics_connection_id_date_channel_group_key'
  ) THEN
    ALTER TABLE ga4_metrics
      ADD CONSTRAINT ga4_metrics_connection_id_date_channel_group_key
      UNIQUE (connection_id, date, channel_group);
  END IF;
END $$;
