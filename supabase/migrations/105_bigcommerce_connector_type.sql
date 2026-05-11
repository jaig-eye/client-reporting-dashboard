-- ─────────────────────────────────────────────────────────────────────────────
-- 105: BigCommerce connector type
-- Extends type check constraint to include bigcommerce (client-level connector).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE connectors DROP CONSTRAINT IF EXISTS connectors_type_check;
ALTER TABLE connectors ADD CONSTRAINT connectors_type_check
  CHECK (type IN (
    'google_ads',
    'meta_ads',
    'google_analytics',
    'google_search_console',
    'google_business_profile',
    'ghl',
    'wordpress',
    'ahrefs',
    'bigcommerce'
  ));
