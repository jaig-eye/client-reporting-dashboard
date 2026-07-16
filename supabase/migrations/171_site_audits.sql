-- Audit toggle + summary columns on the sites table
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS audit_enabled  boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS audit_scope    text         NOT NULL DEFAULT 'key',
  ADD COLUMN IF NOT EXISTS last_audit_at  timestamptz,
  ADD COLUMN IF NOT EXISTS audit_score    integer,
  ADD COLUMN IF NOT EXISTS audit_errors   integer,
  ADD COLUMN IF NOT EXISTS audit_warnings integer;

-- One row per audit run
CREATE TABLE IF NOT EXISTS site_audits (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'running',
  source        text        NOT NULL DEFAULT 'crawler',
  scope         text        NOT NULL DEFAULT 'key',
  pages_crawled integer,
  score         integer,
  errors        integer,
  warnings      integer,
  error_message text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_audits_status_check CHECK (status IN ('running','completed','failed')),
  CONSTRAINT site_audits_source_check CHECK (source IN ('crawler','pagespeed')),
  CONSTRAINT site_audits_scope_check  CHECK (scope   IN ('key','all'))
);

-- One row per page per audit run
CREATE TABLE IF NOT EXISTS site_audit_pages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id         uuid        NOT NULL REFERENCES site_audits(id) ON DELETE CASCADE,
  site_id          uuid        NOT NULL,
  url              text        NOT NULL,
  title            text,
  title_length     integer,
  meta_description text,
  meta_length      integer,
  h1_count         integer     NOT NULL DEFAULT 0,
  h1_text          text,
  word_count       integer,
  imgs_total       integer     NOT NULL DEFAULT 0,
  imgs_no_alt      integer     NOT NULL DEFAULT 0,
  has_schema       boolean     NOT NULL DEFAULT false,
  has_canonical    boolean     NOT NULL DEFAULT false,
  http_status      integer,
  score            integer,
  errors           integer     NOT NULL DEFAULT 0,
  warnings         integer     NOT NULL DEFAULT 0,
  issues           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_audits_site_id_idx       ON site_audits(site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS site_audit_pages_audit_id_idx ON site_audit_pages(audit_id);