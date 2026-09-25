-- ─────────────────────────────────────────────────────────────────────────────
-- Foundational keywords, and a record of when research last ran.
--
-- FOUNDATIONAL KEYWORDS
--
-- What the operator knows about the business before any data exists: the terms it should be
-- found for. They are SEEDS, not a plan. They are handed to DataForSEO's keyword_ideas call
-- alongside the services already read from content_settings, and then they are done — the
-- opportunities that come back are ranked on their own merits and the seeds carry no special
-- weight afterwards.
--
-- Deliberately NOT a content brief. A seed that became a mandated topic would turn five words
-- typed during onboarding into five months of articles, which is exactly the failure mode this
-- column is shaped to avoid. Terms that must be covered belong on a topic, and terms that must
-- rank belong to a page — both already have homes.
--
-- LAST_KEYWORD_RESEARCH_AT
--
-- getResearchCandidates() decides whether to spend on research by asking whether any
-- seo_keywords row was created in the last 30 days. That reads as "we researched recently" only
-- while the pool is still growing: discoverKeywords() inserts unknown keywords ONLY, so once a
-- client's market is well covered a run stores nothing, no row gets a fresh created_at, and the
-- check reports "stale" forever — six billable Labs calls on every topic generation instead of
-- one run a month.
--
-- A timestamp the run itself sets says what the row ages were being asked to imply. Set on any
-- run that completed, including one that stored nothing, because a run that found no new
-- keywords still answered the question.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.content_settings
  ADD COLUMN IF NOT EXISTS foundational_keywords     text[],
  ADD COLUMN IF NOT EXISTS last_keyword_research_at  timestamptz;

COMMENT ON COLUMN public.content_settings.foundational_keywords IS
  'Operator-supplied seed terms for keyword research. Fed to DataForSEO keyword_ideas alongside services; they do not become required topics and carry no weight in ranking the results.';

COMMENT ON COLUMN public.content_settings.last_keyword_research_at IS
  'When discoverKeywords() last completed for this client. Drives the 30-day reuse gate in getResearchCandidates(); set even when the run stored no new keywords.';
