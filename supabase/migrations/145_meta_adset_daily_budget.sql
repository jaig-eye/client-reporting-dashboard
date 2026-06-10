-- Migration 145: Add adset_daily_budget to meta_ads_ad_metrics.
--
-- Meta supports two budget models:
--   CBO (Campaign Budget Optimization): budget set at campaign level
--   ABO (Ad Set Budget Optimization): each ad set has its own daily budget
--
-- Previously, per-adset budgets were fetched during sync but only summed to the
-- campaign-level daily_budget column — individual adset budgets were discarded.
-- This column stores the raw per-adset budget alongside each ad row so the
-- campaign detail page can display per-adset budget in the breakdown table.
--
-- All ad rows for the same adset on the same date will have the same value here.
-- For CBO campaigns, adset_daily_budget will be NULL (budget lives at campaign level).

ALTER TABLE meta_ads_ad_metrics
  ADD COLUMN IF NOT EXISTS adset_daily_budget NUMERIC(12, 4);
