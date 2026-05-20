-- Per-user theme preferences (dark/light/auto + accent color)
-- Agency-level brand_primary color (default accent for all users and client dashboard)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS theme        TEXT DEFAULT 'light'
    CHECK (theme IN ('light', 'dark', 'auto')),
  ADD COLUMN IF NOT EXISTS accent_color TEXT;  -- hex, null = use agency brand_primary

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS brand_primary TEXT DEFAULT '#2563eb';
