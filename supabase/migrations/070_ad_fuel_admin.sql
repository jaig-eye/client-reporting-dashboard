-- Migration 070: Ad Fuel admin infrastructure
-- Adds billing cycle fields to clients, Discord fields, and the ad_fuel_ledger table.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS bill_day           INT CHECK (bill_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS monthly_budget     DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS discord_channel_id TEXT;

ALTER TABLE agency_settings
  ADD COLUMN IF NOT EXISTS discord_bot_token TEXT;

CREATE TABLE IF NOT EXISTS ad_fuel_ledger (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date_of_payment DATE        NOT NULL,
  amount_af       DECIMAL(12,2) NOT NULL,
  split_override  DECIMAL(5,4),        -- per-entry override; NULL = use client ad_fuel_cut
  invoice_id      TEXT,
  type            TEXT,                -- 'MRR', 'catch up', etc.
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ad_fuel_ledger_client_date
  ON ad_fuel_ledger(client_id, date_of_payment DESC);
