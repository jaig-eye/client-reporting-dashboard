-- Migration 057: ahrefs_keywords + ahrefs_pages tables
-- Stores per-snapshot keyword rankings and top organic pages for Ahrefs-connected clients.

CREATE TABLE IF NOT EXISTS ahrefs_keywords (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  keyword       TEXT NOT NULL,
  position      INT,
  volume        INT,
  traffic       INT,
  difficulty    INT,
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, date, keyword)
);
CREATE INDEX IF NOT EXISTS idx_ahrefs_keywords_client_date ON ahrefs_keywords(client_id, date);

CREATE TABLE IF NOT EXISTS ahrefs_pages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  url              TEXT NOT NULL,
  organic_traffic  INT,
  organic_keywords INT,
  synced_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, date, url)
);
CREATE INDEX IF NOT EXISTS idx_ahrefs_pages_client_date ON ahrefs_pages(client_id, date);
