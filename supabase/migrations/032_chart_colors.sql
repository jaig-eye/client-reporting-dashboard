-- Chart color customisation columns for agency_settings
-- These control the 4 series colors shown in SpendChart on all dashboards.

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS chart_color_spend             text DEFAULT '#93c5fd',
  ADD COLUMN IF NOT EXISTS chart_color_prior_spend       text DEFAULT '#94a3b8',
  ADD COLUMN IF NOT EXISTS chart_color_conversions       text DEFAULT '#059669',
  ADD COLUMN IF NOT EXISTS chart_color_prior_conversions text DEFAULT '#34d399';
