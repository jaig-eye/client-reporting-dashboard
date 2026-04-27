-- Migration 069: Add hidden_connector_types to agency_settings
-- Allows agency to globally hide specific connector tabs (GA4, GSC, Ahrefs)
-- from all client dashboards without removing the connection.

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS hidden_connector_types TEXT[] NOT NULL DEFAULT '{}';
