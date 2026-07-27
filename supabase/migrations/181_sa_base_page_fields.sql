-- 181: SA scheduling — base page path approach replaces slug_structure dropdown.
-- base_page_path  e.g. /services/rv-detailing  (the WP parent page the SA pages nest under)
-- city_slug_format controls whether the child slug is city-state (melbourne-fl) or city-only (melbourne)
ALTER TABLE service_area_settings
  ADD COLUMN IF NOT EXISTS base_page_path  TEXT,
  ADD COLUMN IF NOT EXISTS city_slug_format TEXT DEFAULT 'city_state';
