-- ad_fuel_ach_pending — used by the app, created by no migration.
--
-- Production has this table; supabase/migrations does not. So any fresh database — this one, a
-- staging project, a restore from migrations — is missing it, and every "pending ACH" Ad Fuel
-- figure silently reads as 0 because the callers ignore the error.
--
-- The columns are INFERRED from how the code uses the table, not copied from production:
--   api/admin/ad-fuel/pending-ach/route.ts   selects client_id, amount_af; inserts client_id,
--                                            invoice_id, invoice_date, amount_af, note
--   api/admin/ad-fuel/ledger/route.ts        selects id, client_id, invoice_id, invoice_date,
--                                            amount_af, note, created_at
--   api/cron/ad-fuel-ach-clear/route.ts      deletes by id
--
-- The real fix is a migration generated from production's definition of this table.
-- Idempotent: runs after the migrations on every local migrate.

CREATE TABLE IF NOT EXISTS public.ad_fuel_ach_pending (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid        NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  invoice_id   text,
  invoice_date date,
  amount_af    numeric(12, 2) NOT NULL DEFAULT 0,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ad_fuel_ach_pending_client_idx ON public.ad_fuel_ach_pending (client_id);
