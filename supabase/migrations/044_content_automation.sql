-- ─────────────────────────────────────────────────────────────────────────────
-- 044: Content Automation — scheduled AI post generation queue
-- ─────────────────────────────────────────────────────────────────────────────

-- Global and per-client content settings
-- client_id = NULL means the row is the global default.
CREATE TABLE IF NOT EXISTS content_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  -- Client background context (injected into AI system prompt)
  business_background TEXT,
  services            TEXT,
  target_audience     TEXT,
  geographic_focus    TEXT,
  brand_voice         TEXT,
  sitemap_url         TEXT,   -- for context-aware internal linking hints
  -- Global content structure template (overrides agency global when set per-client)
  post_structure      TEXT,
  -- Scheduling
  auto_generate       BOOLEAN NOT NULL DEFAULT FALSE,
  cron_schedule       TEXT NOT NULL DEFAULT '0 6 * * 1',  -- weekly Monday 6am UTC
  posts_per_run       INT  NOT NULL DEFAULT 1 CHECK (posts_per_run BETWEEN 1 AND 10),
  -- WordPress publishing defaults
  connection_id       UUID REFERENCES client_connections(id) ON DELETE SET NULL,
  default_author_id   INT,    -- WP user ID
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global default row (client_id = NULL)
-- Only one such row may exist; enforced by the UNIQUE(client_id) constraint
-- (NULL is treated as unique in Postgres partial index, handled by app upsert logic).

-- Content post queue
CREATE TABLE IF NOT EXISTS content_posts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  connection_id       UUID REFERENCES client_connections(id) ON DELETE SET NULL,
  -- Workflow status
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','published','draft_saved')),
  -- Topic targeting
  target_keyword      TEXT,
  secondary_keywords  TEXT,
  focus_topic         TEXT,
  -- Generated content
  title               TEXT,
  content             TEXT,   -- HTML body
  meta_description    TEXT,
  slug                TEXT,
  -- SEO signals (computed on save)
  word_count          INT,
  heading_count       INT,    -- number of H2/H3 headings
  internal_links      INT,    -- number of internal <a> tags in content
  -- WordPress publishing
  wp_post_id          INT,
  wp_author_id        INT,
  wp_status           TEXT,   -- draft | publish
  published_url       TEXT,
  -- Generation provenance
  generated_by        TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (generated_by IN ('scheduled','manual')),
  ai_model            TEXT,
  prompt_used         TEXT,
  edit_notes          TEXT,   -- instructions given for AI re-edit
  -- Timestamps
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ,
  published_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_content_posts_client
  ON content_posts(client_id, status);

CREATE INDEX IF NOT EXISTS idx_content_posts_status
  ON content_posts(status, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_posts_client_date
  ON content_posts(client_id, generated_at DESC);
