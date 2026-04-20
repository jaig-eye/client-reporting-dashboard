-- Migration 061: Make clients.email nullable
-- Email was NOT NULL in the initial schema, but the add-client flow only collects name + slug.
ALTER TABLE clients ALTER COLUMN email DROP NOT NULL;
