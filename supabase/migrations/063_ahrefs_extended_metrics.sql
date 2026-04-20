-- Migration 063: Add traffic_value, paid_keywords, paid_traffic to ahrefs_metrics
-- These fields are available via the Ahrefs API v3 metrics-history endpoint
-- (org_cost → traffic_value, paid_keywords, paid_traffic).
ALTER TABLE ahrefs_metrics ADD COLUMN IF NOT EXISTS traffic_value NUMERIC(14,2);
ALTER TABLE ahrefs_metrics ADD COLUMN IF NOT EXISTS paid_keywords  INTEGER;
ALTER TABLE ahrefs_metrics ADD COLUMN IF NOT EXISTS paid_traffic   INTEGER;
