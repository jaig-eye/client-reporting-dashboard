-- Migration 055: Metric layout configuration
--
-- Adds JSONB layout columns to store configurable Ecom / Lead Gen dashboard layouts.
-- Each layout defines:
--   kpi_cards      — metric keys shown with sparklines (default 3)
--   top_metrics    — metric keys shown without sparklines below the KPI row (default 4)
--   table_columns  — ordered campaign table column keys
--
-- agency_settings.metric_layouts  — global default for all clients
-- clients.metric_layout_override  — per-client override (null = use agency default)

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS metric_layouts JSONB DEFAULT NULL;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS metric_layout_override JSONB DEFAULT NULL;
