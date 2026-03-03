-- 005_agency_settings.sql
-- Single-row table for agency-level configuration managed via the admin UI.
-- Benchmarks are used to compute the Marketing Efficiency Score on the dashboard.

CREATE TABLE IF NOT EXISTS agency_settings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_name              TEXT        NOT NULL DEFAULT 'My Agency',
  agency_logo_url          TEXT,
  -- Benchmark targets (used to score client performance 0-100)
  benchmark_roas           DECIMAL(10, 2) NOT NULL DEFAULT 3.00,
  benchmark_ctr            DECIMAL(8, 6)  NOT NULL DEFAULT 0.030000,  -- 3.0%
  benchmark_cpc            DECIMAL(10, 2) NOT NULL DEFAULT 3.00,
  benchmark_conv_rate      DECIMAL(8, 6)  NOT NULL DEFAULT 0.030000,  -- 3.0%
  benchmark_cpm            DECIMAL(10, 2) NOT NULL DEFAULT 15.00,
  -- UX defaults
  default_date_range_days  INTEGER        NOT NULL DEFAULT 30,
  updated_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Exactly one row ever
INSERT INTO agency_settings DEFAULT VALUES
ON CONFLICT DO NOTHING;

CREATE TRIGGER agency_settings_updated_at
  BEFORE UPDATE ON agency_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
