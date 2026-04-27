-- Migration 072: Ad Fuel cutoff date setting
-- Adds the configurable start-of-history date for all Ad Fuel lifetime calculations.
-- Data before this date is excluded from spend totals and balance columns.

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS ad_fuel_cutoff_date DATE DEFAULT '2025-01-01';
