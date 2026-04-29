ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
