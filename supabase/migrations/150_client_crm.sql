-- CRM fields on clients table
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS address            TEXT,
  ADD COLUMN IF NOT EXISTS phone              TEXT,
  ADD COLUMN IF NOT EXISTS website            TEXT,
  ADD COLUMN IF NOT EXISTS account_manager_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Per-client contacts (primary, billing, or general)
CREATE TABLE IF NOT EXISTS client_contacts (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  role       TEXT DEFAULT 'contact' CHECK (role IN ('primary', 'billing', 'contact')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_contacts_client_id_idx ON client_contacts(client_id);
