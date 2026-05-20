-- Migration 118: Add last_fuel_alert_balance to clients
-- Tracks the balance (rounded to whole dollars) at the time of the last Discord
-- ad fuel alert, so the cron can skip re-alerting when balance hasn't changed.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_fuel_alert_balance INT;
