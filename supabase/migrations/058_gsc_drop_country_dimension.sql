-- Migration 058: Drop country from GSC unique constraint
--
-- The GSC connector was fetching date × query × page × country (4 dimensions),
-- causing row counts of 1M+ on backfills for medium-traffic sites, leading to
-- Vercel 300s timeouts. Country is stored but never displayed in the UI.
--
-- Fix: aggregate across countries at the API level (drop 'country' from dimensions),
-- and change the unique constraint to (connection_id, date, query, page).

-- Step 1: Remove duplicate per-country rows, keeping the row with the most clicks
-- for each (connection_id, date, query, page) group.
DELETE FROM gsc_metrics a
  USING gsc_metrics b
  WHERE a.connection_id = b.connection_id
    AND a.date          = b.date
    AND a.query         = b.query
    AND a.page          = b.page
    AND a.id            < b.id;

-- Step 2: Drop the old unique index (includes country)
DROP INDEX IF EXISTS idx_gsc_unique_row;

-- Step 3: Make country nullable (we stop writing it going forward)
ALTER TABLE gsc_metrics
  ALTER COLUMN country DROP NOT NULL,
  ALTER COLUMN country SET DEFAULT NULL;

-- Step 4: Create new unique index without country
CREATE UNIQUE INDEX idx_gsc_unique_row
  ON gsc_metrics(connection_id, date, query, page);
