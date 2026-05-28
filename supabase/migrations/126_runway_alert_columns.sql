-- Migration 126: Add dedup columns for the intelligent budget runway alert cron.
--
-- last_runway_alert_at   — timestamp of the last runway/pace alert sent to Discord;
--                          prevents re-firing within the same 23-hour window.
-- last_runway_alert_days — signed integer: positive = days early the budget/balance
--                          was projected to run out at last alert; negative = buffer days
--                          remaining after rebill. Used to detect meaningful worsening
--                          (≥3 days shift) and re-fire even within the 23h window.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS last_runway_alert_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_runway_alert_days INT;
