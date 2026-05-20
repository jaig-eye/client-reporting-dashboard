-- Migration 120: Per-client mute flag for ad fuel Discord low-balance alerts.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS ad_fuel_alert_muted BOOLEAN NOT NULL DEFAULT FALSE;
