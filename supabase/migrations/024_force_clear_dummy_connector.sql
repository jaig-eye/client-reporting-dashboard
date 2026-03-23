-- 024_force_clear_dummy_connector.sql
-- Forcefully removes the stale dummy Meta Ads connector (bbbbbbbb-0002-…)
-- that migration 023 may not have cleaned up if it was partially applied.
-- Safe to run even if the row is already gone (DELETE is idempotent).

-- Remove in FK order: metrics → ad metrics → assignments → connections → accounts → connector

DELETE FROM meta_ads_ad_metrics
  WHERE connection_id = 'cccccccc-0002-0000-0000-000000000001';

DELETE FROM meta_ads_metrics
  WHERE connection_id = 'cccccccc-0002-0000-0000-000000000001';

DELETE FROM google_ads_ad_metrics
  WHERE connection_id = 'cccccccc-0001-0000-0000-000000000001';

DELETE FROM google_ads_metrics
  WHERE connection_id = 'cccccccc-0001-0000-0000-000000000001';

DELETE FROM client_campaign_assignments
  WHERE client_id = 'aaaaaaaa-0000-0000-0000-000000000001';

DELETE FROM client_connections
  WHERE id IN (
    'cccccccc-0001-0000-0000-000000000001',
    'cccccccc-0002-0000-0000-000000000001'
  );

DELETE FROM connector_accounts
  WHERE connector_id IN (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'bbbbbbbb-0002-0000-0000-000000000001'
  );

DELETE FROM connectors
  WHERE id IN (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'bbbbbbbb-0002-0000-0000-000000000001'
  );

DELETE FROM clients
  WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Ensure the unique constraint exists (no-op if already added by 023)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connectors_type_unique'
  ) THEN
    ALTER TABLE connectors ADD CONSTRAINT connectors_type_unique UNIQUE (type);
  END IF;
END$$;
