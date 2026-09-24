-- ─────────────────────────────────────────────────────────────────────────────
-- 190: DataForSEO-backed rank tracking (upgrades the 189 datastream)
--
-- OpenSEO turned out to be a bring-your-own-DataForSEO-key wrapper, so we integrate
-- DataForSEO directly. That changes the data model:
--   • keywords are scoped by DataForSEO location_code + language_code (not just country)
--   • ranks are per DEVICE (desktop + mobile) per day
--   • the current-rank view exposes movement (up/down/entered/dropped) so a keyword
--     that falls out of the tracked depth is VISIBLE instead of silently disappearing
--   • provider defaults to 'dataforseo' (serpapi/gsc remain valid for the fallback tiers)
--
-- Additive + idempotent; safe to run after 189.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Connector type — add 'dataforseo' (keep 'openseo' from 189 for back-compat).
ALTER TABLE connectors DROP CONSTRAINT IF EXISTS connectors_type_check;
ALTER TABLE connectors ADD CONSTRAINT connectors_type_check
  CHECK (type IN (
    'google_ads','meta_ads','google_analytics','google_search_console',
    'google_business_profile','ghl','wordpress','ahrefs','bigcommerce',
    'openseo','dataforseo'
  ));

-- 2. seo_keywords — DataForSEO scoping + richer enrichment.
ALTER TABLE seo_keywords
  ADD COLUMN IF NOT EXISTS location_code    INT  NOT NULL DEFAULT 2840,  -- DataForSEO location (2840 = United States)
  ADD COLUMN IF NOT EXISTS language_code    TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS competition      NUMERIC(5,4),                -- Google Ads competition 0–1
  ADD COLUMN IF NOT EXISTS monthly_searches JSONB;                       -- 12-month volume trend

-- Allow 'dataforseo' as a keyword source (189 only permitted 'openseo').
ALTER TABLE seo_keywords DROP CONSTRAINT IF EXISTS seo_keywords_source_check;
ALTER TABLE seo_keywords ADD CONSTRAINT seo_keywords_source_check
  CHECK (source IN ('manual','gsc','topic','openseo','dataforseo','ahrefs'));

-- Widen the dedup key to (client, keyword, location, language) so the same term can be
-- tracked in multiple markets. The old (client, keyword, country) key is superseded.
ALTER TABLE seo_keywords DROP CONSTRAINT IF EXISTS seo_keywords_client_id_normalized_keyword_country_key;
ALTER TABLE seo_keywords DROP CONSTRAINT IF EXISTS seo_keywords_client_norm_loc_lang_key;
ALTER TABLE seo_keywords ADD CONSTRAINT seo_keywords_client_norm_loc_lang_key
  UNIQUE (client_id, normalized_keyword, location_code, language_code);

-- 3. seo_rankings — per-device rows + absolute rank.
ALTER TABLE seo_rankings
  ADD COLUMN IF NOT EXISTS device        TEXT NOT NULL DEFAULT 'desktop'
                            CHECK (device IN ('desktop','mobile')),
  ADD COLUMN IF NOT EXISTS rank_absolute INT;   -- position across ALL SERP elements (ads/features included)
ALTER TABLE seo_rankings ALTER COLUMN provider SET DEFAULT 'dataforseo';

-- One row per keyword per day PER DEVICE.
ALTER TABLE seo_rankings DROP CONSTRAINT IF EXISTS seo_rankings_keyword_id_date_key;
ALTER TABLE seo_rankings DROP CONSTRAINT IF EXISTS seo_rankings_keyword_date_device_key;
ALTER TABLE seo_rankings ADD CONSTRAINT seo_rankings_keyword_date_device_key
  UNIQUE (keyword_id, date, device);

-- 4. Rewrite the current-rank view: newest snapshot per keyword (desktop breaks a same-date
--    tie), with previous same-device position and an explicit movement label so the UI can
--    distinguish "never ranked" from "dropped out of the tracked window".
--    DROP first (not CREATE OR REPLACE): 189 created this view with a different column order,
--    and Postgres forbids reordering columns via CREATE OR REPLACE. The view is only read by
--    soft-failing helpers, so a drop/recreate is safe.
DROP VIEW IF EXISTS seo_keyword_current;
CREATE VIEW seo_keyword_current AS
SELECT
  k.id                  AS keyword_id,
  k.client_id,
  k.keyword,
  k.normalized_keyword,
  k.country,
  k.location_code,
  k.language_code,
  k.source,
  k.search_volume,
  k.keyword_difficulty,
  k.cpc,
  k.competition,
  k.intent,
  k.is_tracked,
  k.content_post_id,
  latest.position       AS current_position,
  latest.rank_absolute  AS current_rank_absolute,
  latest.url            AS current_url,
  latest.date           AS current_date,
  latest.device         AS current_device,
  prev.position         AS previous_position,
  CASE
    WHEN latest.position IS NOT NULL AND prev.position IS NOT NULL
      THEN prev.position - latest.position                       -- +ve = improved (moved toward #1)
    ELSE NULL
  END AS position_delta,
  CASE
    WHEN latest.date IS NULL                                          THEN 'none'
    WHEN latest.position IS NULL AND prev.position IS NULL            THEN 'none'
    WHEN latest.position IS NOT NULL AND prev.position IS NULL        THEN 'entered'
    WHEN latest.position IS NULL AND prev.position IS NOT NULL        THEN 'dropped'
    WHEN latest.position <  prev.position                            THEN 'up'
    WHEN latest.position >  prev.position                            THEN 'down'
    ELSE 'flat'
  END AS movement
FROM seo_keywords k
LEFT JOIN LATERAL (
  SELECT r.position, r.rank_absolute, r.url, r.date, r.device
  FROM seo_rankings r
  WHERE r.keyword_id = k.id
  ORDER BY r.date DESC, (r.device = 'desktop') DESC   -- newest first; desktop breaks a same-date tie
  LIMIT 1
) latest ON TRUE
LEFT JOIN LATERAL (
  SELECT r.position
  FROM seo_rankings r
  WHERE r.keyword_id = k.id
    AND r.device = latest.device
    AND r.date  < latest.date
  ORDER BY r.date DESC
  LIMIT 1
) prev ON TRUE;
