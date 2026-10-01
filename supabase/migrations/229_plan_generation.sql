-- A plan being generated, so the Pipeline can say so after a refresh.
--
-- "Generate plan" picks topics in the background, and nothing is written until a batch of topics
-- comes back from the AI (up to a few minutes). The toast that said so was the only sign; a reload
-- showed an empty calendar with no hint that topics were on the way.
--
-- { started_at: timestamptz text, dates: ['yyyy-mm-dd', ...] } while a plan runs, NULL otherwise.
-- Cleared when the run ends; the app also ignores a value older than the run's time limit, so a
-- run killed mid-way never leaves it stuck.

ALTER TABLE public.content_settings
  ADD COLUMN IF NOT EXISTS plan_generation JSONB;

COMMENT ON COLUMN public.content_settings.plan_generation IS
  'Set while "Generate plan" picks topics: { started_at, dates }. NULL when none is running. Older than 6 minutes = ignored.';
