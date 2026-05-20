-- Migration 117: Add invoice_date to ad_fuel_ledger
-- Stores the original Stripe invoice creation date separately from
-- the payment cleared date (date_of_payment), so both are visible in the ledger.
ALTER TABLE ad_fuel_ledger ADD COLUMN IF NOT EXISTS invoice_date DATE;
