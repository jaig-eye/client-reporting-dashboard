-- ─────────────────────────────────────────────────────────────────────────────
-- 189: OpenSEO connector + keyword rank tracking
--
-- Adds a new agency-level connector type ('openseo') and the datastream tables it
-- will feed once connected: a per-client tracked-keyword universe (seo_keywords)
-- and a time-series of SERP rank snapshots (seo_rankings). A convenience view
-- (seo_keyword_current) exposes each keyword's latest position + movement so the
-- Analytics tab, pipeline cards, and the post editor can read "current rank" cheaply.
--
-- OpenSEO is pay-as-you-go (keyword search, rank checks, backlinks, brand checks).
-- These tables are provider-agnostic on purpose — `provider` / `source` columns and
-- JSONB `metadata` mean GSC, Ahrefs, or a manual import can populate them today and
-- OpenSEO rank data simply flows into the same shape once the API key is added.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extend the connector type check constraint to include openseo (agency-level,
--    API-key auth like ahrefs; target domain stored as client_connections.external_id).
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
    'bigcommerce',
    'openseo'
  ));

-- 2. Tracked keyword universe (per client). One row per keyword we care about for a
--    client, regardless of who sourced it (manual, GSC query, a content topic, or an
--    OpenSEO keyword search). Enrichment columns (volume/difficulty/cpc/intent) are
--    filled in by OpenSEO once connected; nullable so non-OpenSEO sources still work.
CREATE TABLE IF NOT EXISTS seo_keywords (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  connection_id       UUID REFERENCES client_connections(id) ON DELETE SET NULL,  -- SEO connector that sourced it (nullable)
  keyword             TEXT NOT NULL,
  normalized_keyword  TEXT NOT NULL,                      -- lowercased/trimmed, for dedup
  country             TEXT NOT NULL DEFAULT 'us',
  source              TEXT NOT NULL DEFAULT 'manual'      -- manual | gsc | topic | openseo
                        CHECK (source IN ('manual','gsc','topic','openseo','ahrefs')),
  search_volume       INT,                                -- monthly searches (OpenSEO keyword search)
  keyword_difficulty  NUMERIC(5,2),                       -- 0–100
  cpc                 NUMERIC(10,2),                      -- estimated cost-per-click (USD)
  intent              TEXT,                               -- informational | commercial | transactional | navigational
  is_tracked          BOOLEAN NOT NULL DEFAULT TRUE,      -- run rank checks for this keyword
  content_post_id     UUID REFERENCES content_posts(id) ON DELETE SET NULL,  -- post targeting this keyword, if any
  last_checked_at     TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, normalized_keyword, country)
);

CREATE INDEX IF NOT EXISTS idx_seo_keywords_client        ON seo_keywords(client_id);
CREATE INDEX IF NOT EXISTS idx_seo_keywords_tracked       ON seo_keywords(client_id, is_tracked);
CREATE INDEX IF NOT EXISTS idx_seo_keywords_content_post  ON seo_keywords(content_post_id);

-- 3. Rank snapshots (time series). One row per keyword per check date.
CREATE TABLE IF NOT EXISTS seo_rankings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id        UUID NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,   -- denormalized for fast per-client reads
  date              DATE NOT NULL,
  position          INT,                 -- SERP position (NULL = not found in top 100)
  url               TEXT,                -- the ranking URL for this client's domain
  search_volume     INT,                 -- volume snapshot at check time
  serp_features     JSONB,               -- featured snippet / PAA / local pack presence (forward-looking)
  provider          TEXT NOT NULL DEFAULT 'openseo',
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (keyword_id, date)
);

CREATE INDEX IF NOT EXISTS idx_seo_rankings_client_date  ON seo_rankings(client_id, date);
CREATE INDEX IF NOT EXISTS idx_seo_rankings_keyword_date ON seo_rankings(keyword_id, date DESC);

-- 4. Convenience view: latest position + movement per tracked keyword.
--    position_delta is positive when the keyword IMPROVED (moved toward #1) since the
--    previous check. NULL current_position = not currently ranking in the top 100.
CREATE OR REPLACE VIEW seo_keyword_current AS
SELECT
  k.id                 AS keyword_id,
  k.client_id,
  k.keyword,
  k.normalized_keyword,
  k.country,
  k.source,
  k.search_volume,
  k.keyword_difficulty,
  k.cpc,
  k.intent,
  k.is_tracked,
  k.content_post_id,
  latest.position      AS current_position,
  latest.url           AS current_url,
  latest.date          AS current_date,
  prev.position        AS previous_position,
  (prev.position - latest.position) AS position_delta  -- +ve = improved (moved up)
FROM seo_keywords k
LEFT JOIN LATERAL (
  SELECT r.position, r.url, r.date
  FROM seo_rankings r
  WHERE r.keyword_id = k.id
  ORDER BY r.date DESC
  LIMIT 1
) latest ON TRUE
LEFT JOIN LATERAL (
  SELECT r.position
  FROM seo_rankings r
  WHERE r.keyword_id = k.id AND r.date < latest.date
  ORDER BY r.date DESC
  LIMIT 1
) prev ON TRUE;
