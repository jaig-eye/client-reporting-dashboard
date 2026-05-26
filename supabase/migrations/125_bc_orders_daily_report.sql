-- Add BigCommerce daily sales report toggle to clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS bc_daily_report BOOLEAN DEFAULT false;
