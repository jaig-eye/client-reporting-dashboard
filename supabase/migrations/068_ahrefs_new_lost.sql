-- Migration 068: Add new/lost backlinks and referring domain columns to ahrefs_metrics
-- These fields are available via the Ahrefs API v3 metrics-history endpoint and represent
-- link velocity — how many backlinks and referring domains were gained or lost in a period.
ALTER TABLE ahrefs_metrics ADD COLUMN IF NOT EXISTS new_backlinks          INTEGER;
ALTER TABLE ahrefs_metrics ADD COLUMN IF NOT EXISTS lost_backlinks         INTEGER;
ALTER TABLE ahrefs_metrics ADD COLUMN IF NOT EXISTS new_referring_domains  INTEGER;
ALTER TABLE ahrefs_metrics ADD COLUMN IF NOT EXISTS lost_referring_domains INTEGER;
