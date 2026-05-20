-- Migration 119: Add ACH tracking columns to ad_fuel_ledger
-- ach_status tracks whether a pending ACH entry has cleared or is still in-flight.
-- invoice_date is already added by migration 117; ach_status is the remaining column.

ALTER TABLE ad_fuel_ledger
  ADD COLUMN IF NOT EXISTS ach_status TEXT
    CHECK (ach_status IN ('pending', 'cleared'));
