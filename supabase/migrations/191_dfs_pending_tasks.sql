-- ─────────────────────────────────────────────────────────────────────────────
-- 191: queued DataForSEO rank checks awaiting collection
--
-- Rank checks move from the live/advanced endpoint to the Standard task queue, which is ~3.3x
-- cheaper for identical data. Simulated against the real book that is the difference between
-- $102/month and $31/month.
--
-- The queue is asynchronous, so a submitted task and its result belong to different runs. Polling
-- inside one invocation was the alternative and is worse: a Standard task can outlast the 300
-- second function, and a run that dies waiting has already been BILLED for results it never
-- collected. This table is what makes losing a paid task impossible — every submission is
-- recorded, and the next run collects whatever has finished.
--
-- Rows are short-lived: written on submit, deleted on collect. A task DataForSEO never finishes is
-- swept after a few days rather than being retried forever.
--
-- Additive. Nothing reads or writes it until the rankings cron ships.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dfs_pending_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id)      ON DELETE CASCADE,
  keyword_id      UUID NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  -- DataForSEO's id for the queued task; the collect call addresses it directly.
  task_id         TEXT NOT NULL,
  keyword         TEXT NOT NULL,
  -- Kept alongside the task because matching a SERP result to a client needs the domain, and
  -- re-reading the connection at collect time would couple the two halves unnecessarily.
  domain          TEXT NOT NULL,
  device          TEXT NOT NULL CHECK (device IN ('desktop','mobile')),
  depth           INT  NOT NULL DEFAULT 100,
  -- The date the check belongs to, not the date it was collected. A task submitted at 23:50 and
  -- collected the next morning is still that day's reading.
  check_date      DATE NOT NULL,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Counted so a task that never finishes is abandoned rather than polled forever.
  collect_attempts INT NOT NULL DEFAULT 0,
  UNIQUE (task_id)
);

-- The collect half reads oldest-first; the sweep reads by age. Both are covered by this.
CREATE INDEX IF NOT EXISTS idx_dfs_pending_submitted
  ON public.dfs_pending_tasks (submitted_at);

-- One in-flight task per keyword/device/day, so a re-run can't queue the same check twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dfs_pending_unique_check
  ON public.dfs_pending_tasks (keyword_id, device, check_date);

-- Same lockdown as every other table here: RLS on with zero policies, so anon and authenticated
-- reach nothing and only the service role (createAdminClient) can read or write.
ALTER TABLE public.dfs_pending_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dfs_pending_tasks FROM anon, authenticated;
GRANT ALL ON public.dfs_pending_tasks TO service_role;

COMMENT ON TABLE public.dfs_pending_tasks IS
  'DataForSEO Standard-queue rank checks submitted but not yet collected. Written on submit, deleted on collect, swept if never finished.';
