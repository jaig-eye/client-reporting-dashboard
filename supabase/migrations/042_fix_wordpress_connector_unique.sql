-- Migration 042: Fix WordPress connector unique constraint
-- The previous UNIQUE(type) constraint on connectors prevented adding multiple
-- WordPress sites (one per client). WordPress and GHL are per-site connectors
-- and need multiple rows. Only OAuth connectors (google_ads, meta_ads, etc.)
-- are truly singletons at the agency level.

-- Drop the overly-broad global unique constraint
ALTER TABLE connectors DROP CONSTRAINT IF EXISTS connectors_type_unique;
DROP INDEX IF EXISTS connectors_type_unique;

-- Re-add uniqueness only for singleton connector types
CREATE UNIQUE INDEX IF NOT EXISTS connectors_singleton_type_unique
  ON connectors (type)
  WHERE type IN ('google_ads', 'meta_ads', 'google_analytics', 'google_search_console');

-- Add impression share columns to google_ads_metrics
ALTER TABLE google_ads_metrics
  ADD COLUMN IF NOT EXISTS search_impression_share         DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS search_abs_top_impression_share DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS search_top_impression_share     DECIMAL(5,4);
