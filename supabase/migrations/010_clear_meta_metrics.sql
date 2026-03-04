-- 010_clear_meta_metrics.sql
-- Clears all Meta campaign_metrics rows so the corrected sync logic
-- (using Meta's "results" field instead of summing all offsite_conversion.* subtypes)
-- can backfill clean data.
--
-- Run this ONCE in Supabase SQL editor, then use the Backfill All button
-- in Agency Settings to re-pull Meta historical data.

DELETE FROM campaign_metrics
WHERE platform = 'meta';
