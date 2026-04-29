-- Structured rationale fields replacing the single-blob rationale text.
-- generation_error stores the last AI failure message; cleared on retry success.
ALTER TABLE content_topics
  ADD COLUMN IF NOT EXISTS keyword_opportunity TEXT,
  ADD COLUMN IF NOT EXISTS ranking_strategy    TEXT,
  ADD COLUMN IF NOT EXISTS audience_intent     TEXT,
  ADD COLUMN IF NOT EXISTS why_now             TEXT,
  ADD COLUMN IF NOT EXISTS competition_level   TEXT,
  ADD COLUMN IF NOT EXISTS generation_error    TEXT;
