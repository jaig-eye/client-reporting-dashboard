CREATE TABLE IF NOT EXISTS service_area_settings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              UUID UNIQUE NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  connection_id          UUID REFERENCES client_connections(id) ON DELETE SET NULL,

  slug_structure         TEXT NOT NULL DEFAULT 'service_slash_city_state'
    CHECK (slug_structure IN ('service_slash_city_state','service_dash_city_state','service_slash_city')),

  service_pages          JSONB DEFAULT '[]'::jsonb,
  service_areas          JSONB DEFAULT '[]'::jsonb,
  nearby_areas_template  TEXT,
  primary_service        TEXT,

  auto_generate          BOOLEAN DEFAULT false,
  auto_approve_pages     BOOLEAN DEFAULT false,
  auto_push_pages        BOOLEAN DEFAULT false,

  wp_publish_mode        TEXT NOT NULL DEFAULT 'draft_only'
    CHECK (wp_publish_mode IN ('scheduled_draft', 'draft_only')),

  schedule_frequency     TEXT DEFAULT 'monthly'
    CHECK (schedule_frequency IN ('daily','weekly','biweekly','monthly')),
  schedule_day_of_week   INT  DEFAULT 1,
  pages_per_run          INT  DEFAULT 1 CHECK (pages_per_run BETWEEN 1 AND 10),
  publish_time           TEXT DEFAULT '09:00',

  target_length          INT  DEFAULT 1200 CHECK (target_length BETWEEN 600 AND 3000),
  page_structure         TEXT,
  location_notes         TEXT,
  tone_notes             TEXT,

  use_gsc_discovery      BOOLEAN DEFAULT true,
  min_gsc_impressions    INT DEFAULT 10,
  check_sitemap_overlap  BOOLEAN DEFAULT true,

  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);
