-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020: Ad Fuel margin/markup system
-- Run after: 019_multi_admin.sql
--
-- "Ad Fuel" is the agency's marked-up spend figure shown to clients.
-- The agency keeps ad_fuel_cut % for optimization; the rest goes to platforms.
--
-- Formula:
--   ad_fuel_spend = raw_platform_spend / (1 - ad_fuel_cut)
--   Example: $800 raw spend ÷ (1 - 0.20) = $1,000 Ad Fuel Spend
--            → agency keeps $200, client sees $1,000
--
-- A client with ad_fuel_cut = 0 sees raw spend (100% goes to ads).
-- Client-level setting overrides global when set.
-- ─────────────────────────────────────────────────────────────────────────────

-- Global default on agency_settings (default 20%)
ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS ad_fuel_cut NUMERIC(5,4) DEFAULT 0.20;

-- Per-client override (NULL = use agency global)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ad_fuel_cut NUMERIC(5,4);

-- Comment to document the convention
COMMENT ON COLUMN agency_settings.ad_fuel_cut IS
  'Agency margin as a decimal (0.20 = 20%). ad_fuel_spend = raw_spend / (1 - cut).';
COMMENT ON COLUMN clients.ad_fuel_cut IS
  'Per-client Ad Fuel cut override. NULL = use agency_settings.ad_fuel_cut.';
