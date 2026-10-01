-- A hard monthly ceiling on DataForSEO spend.
--
-- The usage ledger (191) records what was spent and the agency panel displays it, but nothing ever
-- stopped. Cadence tuning changes how fast the bill grows; it cannot stop a bill that grows for a
-- reason nobody predicted — a client added in bulk, a cron that retries, a schedule change.
--
-- Defaulted rather than left null, so protection exists without anyone opting in. 100 is generous
-- against a real bill of about $1.25 per client per month: invisible at today's scale, and it
-- starts refusing somewhere past a hundred clients, which is exactly when someone should be asked.
-- Set it to NULL to spend without a ceiling.

ALTER TABLE public.agency_settings
  ADD COLUMN IF NOT EXISTS dataforseo_monthly_budget NUMERIC DEFAULT 100;

COMMENT ON COLUMN public.agency_settings.dataforseo_monthly_budget IS
  'Hard ceiling on DataForSEO spend per calendar month, in dollars. NULL means no limit. Checked before every paid call; once month-to-date spend reaches it, paid paths skip rather than fail.';

-- The budget check sums the month to date on every paid path, so it must be cheap.
CREATE INDEX IF NOT EXISTS idx_dataforseo_usage_date ON public.dataforseo_usage (date);
