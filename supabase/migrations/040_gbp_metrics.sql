-- 040_gbp_metrics.sql
-- Google Business Profile daily performance metrics.
-- Stores views (search + maps), clicks, calls, directions, photos, and
-- review summary per location per day. Supports clients with multiple locations.

CREATE TABLE IF NOT EXISTS gbp_metrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       UUID NOT NULL REFERENCES client_connections(id) ON DELETE CASCADE,
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  location_id         TEXT NOT NULL,      -- GBP location resource name
  location_name       TEXT,               -- human-readable location name
  views_search        INT DEFAULT 0,      -- impressions on Google Search
  views_maps          INT DEFAULT 0,      -- impressions on Google Maps
  website_clicks      INT DEFAULT 0,
  call_clicks         INT DEFAULT 0,
  direction_clicks    INT DEFAULT 0,
  photos_views        INT DEFAULT 0,
  photos_count        INT DEFAULT 0,
  reviews_count       INT DEFAULT 0,
  reviews_avg_rating  NUMERIC(3,2),       -- 1.0 to 5.0
  raw_data            JSONB,
  synced_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, location_id, date)
);

CREATE INDEX IF NOT EXISTS idx_gbp_client_date
  ON gbp_metrics(client_id, date);

CREATE INDEX IF NOT EXISTS idx_gbp_location
  ON gbp_metrics(client_id, location_id, date);
