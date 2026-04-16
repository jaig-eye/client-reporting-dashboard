-- Migration 054: Drop old GA4 unique constraint
--
-- Migration 053 correctly added the (connection_id, date, channel_group) constraint
-- but did NOT drop the old (connection_id, date) constraint that was created by
-- the original table setup. That old constraint blocks upserts when multiple
-- channel_group rows (e.g. "Organic Search", "Direct", "Paid Search") share the
-- same connection_id + date combination.
--
-- Error seen in logs:
--   duplicate key value violates unique constraint "ga4_metrics_connection_id_date_key"

ALTER TABLE ga4_metrics DROP CONSTRAINT IF EXISTS ga4_metrics_connection_id_date_key;
