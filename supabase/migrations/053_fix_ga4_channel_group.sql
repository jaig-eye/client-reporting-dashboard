-- Migration 053: Robustly fix ga4_metrics channel_group constraint
--
-- Problem: Migration 052 used ADD COLUMN IF NOT EXISTS which is a no-op when
-- the column already existed (from migration 038) as a nullable TEXT column.
-- The column stays nullable, potentially has NULL rows, and the upsert's
-- onConflict: 'connection_id,date,channel_group' fails because the existing
-- UNIQUE constraint may not have the expected name.
--
-- This migration handles all cases regardless of current DB state:
--   Case A: column was added by migration 052 (NOT NULL, DEFAULT 'Direct')
--   Case B: column existed from migration 038 (nullable TEXT, no default)

-- Backfill any NULL channel_group values to 'Direct'
UPDATE ga4_metrics SET channel_group = 'Direct' WHERE channel_group IS NULL;

-- Ensure column has NOT NULL constraint and DEFAULT (safe no-op if already set)
ALTER TABLE ga4_metrics ALTER COLUMN channel_group SET DEFAULT 'Direct';
ALTER TABLE ga4_metrics ALTER COLUMN channel_group SET NOT NULL;

-- Drop the UNIQUE constraint (whichever name it has) and recreate with the
-- exact name that the upsert's onConflict: 'connection_id,date,channel_group' targets.
ALTER TABLE ga4_metrics
  DROP CONSTRAINT IF EXISTS ga4_metrics_connection_id_date_channel_group_key;

ALTER TABLE ga4_metrics
  ADD CONSTRAINT ga4_metrics_connection_id_date_channel_group_key
  UNIQUE (connection_id, date, channel_group);
