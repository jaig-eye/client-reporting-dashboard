-- Silo Optimization Engine: keyword maps, planned pages, optimization briefs,
-- content audits, and internal link graph for topical authority clusters.
-- (Ported from feature/silo-optimization-engine migration 153.)

-- ─── 1. Silo keyword map ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_silo_keywords (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id                 UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  silo_id                   UUID        NOT NULL REFERENCES content_silos(id) ON DELETE CASCADE,
  keyword                   TEXT        NOT NULL,
  keyword_type              TEXT        NOT NULL DEFAULT 'supporting'
                              CHECK (keyword_type IN ('top_level', 'secondary_top_level', 'supporting')),
  intent                    TEXT        CHECK (intent IN ('transactional', 'informational', 'commercial', 'navigational', 'local', 'other')),
  monthly_searches_low      INTEGER,
  monthly_searches_high     INTEGER,
  keyword_score             INTEGER,
  trust_authority_score     INTEGER,
  current_ranking_url       TEXT,
  current_ranking_position  NUMERIC,
  selected                  BOOLEAN     NOT NULL DEFAULT false,
  page_category             TEXT,
  target_post_id            UUID        REFERENCES content_posts(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csk_client   ON content_silo_keywords(client_id);
CREATE INDEX IF NOT EXISTS idx_csk_silo     ON content_silo_keywords(silo_id);
CREATE INDEX IF NOT EXISTS idx_csk_type     ON content_silo_keywords(keyword_type);
CREATE INDEX IF NOT EXISTS idx_csk_selected ON content_silo_keywords(selected) WHERE selected = true;

-- ─── 2. Silo planned pages ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_silo_pages (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id            UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  silo_id              UUID        NOT NULL REFERENCES content_silos(id) ON DELETE CASCADE,
  primary_keyword_id   UUID        REFERENCES content_silo_keywords(id) ON DELETE SET NULL,
  title                TEXT        NOT NULL,
  slug                 TEXT,
  page_type            TEXT        NOT NULL DEFAULT 'supporting_article'
                         CHECK (page_type IN ('hub', 'supporting_article', 'service_area', 'comparison', 'guide', 'faq', 'commercial', 'other')),
  status               TEXT        NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned', 'generated', 'for_review', 'published', 'archived')),
  target_url           TEXT,
  content_topic_id     UUID        REFERENCES content_topics(id) ON DELETE SET NULL,
  content_post_id      UUID        REFERENCES content_posts(id) ON DELETE SET NULL,
  priority             INTEGER     NOT NULL DEFAULT 0,
  sort_order           INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csp_client ON content_silo_pages(client_id);
CREATE INDEX IF NOT EXISTS idx_csp_silo   ON content_silo_pages(silo_id);
CREATE INDEX IF NOT EXISTS idx_csp_status ON content_silo_pages(status);

-- ─── 3. Optimization briefs ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_optimization_briefs (
  id                                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id                         UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  silo_id                           UUID        REFERENCES content_silos(id) ON DELETE SET NULL,
  silo_page_id                      UUID        REFERENCES content_silo_pages(id) ON DELETE SET NULL,
  content_topic_id                  UUID        REFERENCES content_topics(id) ON DELETE SET NULL,
  content_post_id                   UUID        REFERENCES content_posts(id) ON DELETE SET NULL,
  target_url                        TEXT,
  primary_keyword                   TEXT        NOT NULL,
  secondary_keywords                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  target_location                   TEXT,
  language                          TEXT        NOT NULL DEFAULT 'en',
  competitor_urls                   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  recommended_word_count_min        INTEGER,
  recommended_word_count_target     INTEGER,
  recommended_word_count_max        INTEGER,
  recommended_headings              JSONB       NOT NULL DEFAULT '[]'::jsonb,
  required_terms                    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  keyword_variations                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  lsi_terms                         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  google_entities                   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  related_questions                 JSONB       NOT NULL DEFAULT '[]'::jsonb,
  schema_recommendations            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  eeat_recommendations              JSONB       NOT NULL DEFAULT '[]'::jsonb,
  page_structure_recommendations    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  internal_link_recommendations     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  raw_analysis                      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at                        TIMESTAMPTZ DEFAULT NOW(),
  updated_at                        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cob_client       ON content_optimization_briefs(client_id);
CREATE INDEX IF NOT EXISTS idx_cob_silo         ON content_optimization_briefs(silo_id) WHERE silo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cob_silo_page    ON content_optimization_briefs(silo_page_id) WHERE silo_page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cob_content_post ON content_optimization_briefs(content_post_id) WHERE content_post_id IS NOT NULL;

-- ─── 4. Optimization audits ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_optimization_audits (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id               UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  silo_id                 UUID        REFERENCES content_silos(id) ON DELETE SET NULL,
  silo_page_id            UUID        REFERENCES content_silo_pages(id) ON DELETE SET NULL,
  content_post_id         UUID        REFERENCES content_posts(id) ON DELETE SET NULL,
  brief_id                UUID        REFERENCES content_optimization_briefs(id) ON DELETE SET NULL,
  target_url              TEXT,
  score_total             INTEGER     NOT NULL DEFAULT 0,
  exact_keyword_score     INTEGER,
  variation_score         INTEGER,
  lsi_score               INTEGER,
  entity_score            INTEGER,
  word_count_score        INTEGER,
  page_structure_score    INTEGER,
  schema_score            INTEGER,
  eeat_score              INTEGER,
  internal_link_score     INTEGER,
  findings                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  term_usage              JSONB       NOT NULL DEFAULT '[]'::jsonb,
  schema_findings         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  eeat_findings           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  page_structure_findings JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coa_client       ON content_optimization_audits(client_id);
CREATE INDEX IF NOT EXISTS idx_coa_silo         ON content_optimization_audits(silo_id) WHERE silo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coa_content_post ON content_optimization_audits(content_post_id) WHERE content_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coa_created      ON content_optimization_audits(created_at DESC);

-- ─── 5. Internal link graph ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_silo_internal_links (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id             UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  silo_id               UUID        NOT NULL REFERENCES content_silos(id) ON DELETE CASCADE,
  source_silo_page_id   UUID        REFERENCES content_silo_pages(id) ON DELETE SET NULL,
  target_silo_page_id   UUID        REFERENCES content_silo_pages(id) ON DELETE SET NULL,
  source_post_id        UUID        REFERENCES content_posts(id) ON DELETE SET NULL,
  target_post_id        UUID        REFERENCES content_posts(id) ON DELETE SET NULL,
  source_url            TEXT,
  target_url            TEXT,
  anchor_text           TEXT        NOT NULL,
  link_type             TEXT        NOT NULL DEFAULT 'supporting_to_hub'
                          CHECK (link_type IN ('hub_to_supporting', 'supporting_to_hub', 'supporting_to_supporting', 'supporting_to_related', 'manual')),
  status                TEXT        NOT NULL DEFAULT 'recommended'
                          CHECK (status IN ('recommended', 'inserted', 'failed', 'ignored')),
  reason                TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csil_client ON content_silo_internal_links(client_id);
CREATE INDEX IF NOT EXISTS idx_csil_silo   ON content_silo_internal_links(silo_id);
CREATE INDEX IF NOT EXISTS idx_csil_status ON content_silo_internal_links(status);
