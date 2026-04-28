ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS local_dominator_url TEXT;
