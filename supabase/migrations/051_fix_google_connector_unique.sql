-- Migration 051: Extend singleton-type unique index to cover google_business_profile and ahrefs
--
-- Migration 042 created a partial unique index for singleton connector types but omitted
-- google_business_profile and ahrefs (added later in migrations 043+). Without this index
-- entry, the uniqueness constraint is not enforced for those types, which could lead to
-- duplicate connector rows.
--
-- Note: application code in /api/auth/google/callback uses explicit UPDATE/INSERT by PK
-- rather than ON CONFLICT (type), so this index is only for data-integrity enforcement —
-- it does not need to be used as an ON CONFLICT inference target.

DROP INDEX IF EXISTS connectors_singleton_type_unique;

CREATE UNIQUE INDEX IF NOT EXISTS connectors_singleton_type_unique
  ON connectors (type)
  WHERE type IN (
    'google_ads',
    'meta_ads',
    'google_analytics',
    'google_search_console',
    'google_business_profile',
    'ahrefs'
  );
