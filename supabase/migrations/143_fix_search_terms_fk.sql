-- Fix incorrect FK on google_ads_search_terms.
-- Migration 140 referenced connectors(id) but every other metric table
-- references client_connections(id), and the sync code passes connection.id
-- which is a client_connections UUID. This caused FK violations on every
-- Google Ads sync that tried to write search term data.

ALTER TABLE google_ads_search_terms
  DROP CONSTRAINT IF EXISTS google_ads_search_terms_connection_id_fkey;

ALTER TABLE google_ads_search_terms
  ADD CONSTRAINT google_ads_search_terms_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES client_connections(id) ON DELETE CASCADE;
