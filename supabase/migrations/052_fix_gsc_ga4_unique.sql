-- Migration 052: Fix unique constraints on gsc_metrics and ga4_metrics
--
-- gsc_metrics: The original unique index used COALESCE expressions
-- (COALESCE(query,''), COALESCE(page,''), COALESCE(country,'')) which cannot be
-- used as an ON CONFLICT inference target with plain column names. This caused
-- every upsert to silently fail. Fix: convert query/page/country to NOT NULL with
-- default '' so a plain column-based UNIQUE index works.
--
-- ga4_metrics: channel_group is nullable, but a nullable column in a UNIQUE
-- constraint causes ON CONFLICT to use IS NOT DISTINCT FROM semantics — which
-- works in PostgreSQL but is fragile. Fix: make channel_group NOT NULL with a
-- safe default so the plain UNIQUE constraint works reliably.

-- ── gsc_metrics ───────────────────────────────────────────────────────────────

-- Coerce any existing NULLs to '' before adding NOT NULL
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

-- Drop the expression-based unique index and replace with a plain one
DROP INDEX IF EXISTS idx_gsc_unique_row;

CREATE UNIQUE INDEX idx_gsc_unique_row
  ON gsc_metrics(connection_id, date, query, page, country);

-- ── ga4_metrics ───────────────────────────────────────────────────────────────

-- Coerce any existing NULLs to 'Direct' before adding NOT NULL
UPDATE ga4_metrics SET channel_group = 'Direct'
WHERE channel_group IS NULL;

ALTER TABLE ga4_metrics
  ALTER COLUMN channel_group SET DEFAULT 'Direct';

ALTER TABLE ga4_metrics
  ALTER COLUMN channel_group SET NOT NULL;
