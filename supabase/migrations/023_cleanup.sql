-- 023_cleanup.sql
-- 1. Remove all dummy data from migration 022 (Apex Roofing demo).
-- 2. Add a UNIQUE constraint on connectors(type) so only one connector per
--    platform exists and the OAuth upserts work correctly.

-- ── Remove dummy metrics (must go first due to FKs) ─────────────────────────
DELETE FROM google_ads_ad_metrics
  WHERE connection_id = 'cccccccc-0001-0000-0000-000000000001';

DELETE FROM meta_ads_ad_metrics
  WHERE connection_id = 'cccccccc-0002-0000-0000-000000000001';

DELETE FROM google_ads_metrics
  WHERE connection_id = 'cccccccc-0001-0000-0000-000000000001';

DELETE FROM meta_ads_metrics
  WHERE connection_id = 'cccccccc-0002-0000-0000-000000000001';

-- ── Remove dummy campaign assignments ────────────────────────────────────────
DELETE FROM client_campaign_assignments
  WHERE client_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ── Remove dummy client connections ─────────────────────────────────────────
DELETE FROM client_connections
  WHERE id IN (
    'cccccccc-0001-0000-0000-000000000001',
    'cccccccc-0002-0000-0000-000000000001'
  );

-- ── Remove cached connector accounts for dummy connectors ────────────────────
DELETE FROM connector_accounts
  WHERE connector_id IN (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'bbbbbbbb-0002-0000-0000-000000000001'
  );

-- ── Remove dummy connectors ──────────────────────────────────────────────────
DELETE FROM connectors
  WHERE id IN (
    'bbbbbbbb-0001-0000-0000-000000000001',
    'bbbbbbbb-0002-0000-0000-000000000001'
  );

-- ── Remove demo client ───────────────────────────────────────────────────────
DELETE FROM clients
  WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ── Remove any other duplicate connectors per type (keep the most recent) ────
-- This handles the case where multiple connectors of the same type were
-- accidentally created before the unique constraint existed.
DELETE FROM connectors
  WHERE id NOT IN (
    SELECT DISTINCT ON (type) id
    FROM connectors
    ORDER BY type, created_at DESC
  );

-- ── Add unique constraint so each platform type can only have one connector ──
-- This makes the OAuth upsert (onConflict: 'type') work correctly.
ALTER TABLE connectors
  ADD CONSTRAINT connectors_type_unique UNIQUE (type);
