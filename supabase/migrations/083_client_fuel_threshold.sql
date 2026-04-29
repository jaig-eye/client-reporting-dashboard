-- Optional per-client Ad Fuel balance threshold for Discord early-warning alerts.
-- When set, a Discord message fires whenever balance drops below this amount.
-- last_fuel_alert_at prevents alert spam (one alert per day per client).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS ad_fuel_alert_threshold NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS last_fuel_alert_at       TIMESTAMPTZ;
