-- ─────────────────────────────────────────────────────────────────────────────
-- AI usage ledger.
--
-- Nothing recorded a single token before this. Every AI call in the app — 13 hand-rolled
-- fetches across topic generation, article generation, both regenerate paths, silo work,
-- brand DNA, service-area routes and image generation — issued its request and discarded the
-- provider's usage block, so "what does a post cost us" had no answer.
--
-- Shape mirrors dataforseo_usage (migration 191) deliberately: one row per call, aggregated
-- for the agency settings panel. Writes are best-effort at the call site, so metering can
-- never fail a generation.
--
-- cost_usd is NULLABLE and that is load-bearing. Provider rates change and new models appear;
-- when lib/ai/pricing.ts has no entry for a model we still record the tokens and leave the
-- cost NULL rather than inventing a number. The panel reports those separately as
-- "unpriced" instead of quietly understating spend.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  provider      text        NOT NULL,             -- 'anthropic' | 'openai'
  model         text        NOT NULL,
  operation     text        NOT NULL,             -- see AiOperation in lib/ai/usage.ts

  -- Token counts for text models. Image models report no tokens, so these stay 0 and
  -- `units` carries the image count instead.
  input_tokens  integer     NOT NULL DEFAULT 0,
  output_tokens integer     NOT NULL DEFAULT 0,
  units         integer     NOT NULL DEFAULT 1,

  cost_usd      numeric(12, 6),                   -- NULL = model not in the pricing table

  client_id     uuid        REFERENCES public.clients(id) ON DELETE SET NULL,
  post_id       uuid,                             -- no FK: posts are hard-deleted, the spend still happened
  date          date        NOT NULL DEFAULT CURRENT_DATE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The panel groups by date, then by model/operation, and filters to a rolling window.
CREATE INDEX IF NOT EXISTS ai_usage_date_idx      ON public.ai_usage (date DESC);
CREATE INDEX IF NOT EXISTS ai_usage_client_idx    ON public.ai_usage (client_id, date DESC);
CREATE INDEX IF NOT EXISTS ai_usage_model_idx     ON public.ai_usage (model, date DESC);
CREATE INDEX IF NOT EXISTS ai_usage_operation_idx ON public.ai_usage (operation, date DESC);

-- Same lockdown as every other table here: RLS on with zero policies, so anon and
-- authenticated reach nothing and only the service role (createAdminClient) can read or write.
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM anon, authenticated;
GRANT ALL ON public.ai_usage TO service_role;

COMMENT ON TABLE  public.ai_usage IS 'Per-call AI spend ledger. Written best-effort by lib/ai/client.ts; aggregated for the agency settings AI tab.';
COMMENT ON COLUMN public.ai_usage.cost_usd IS 'NULL when lib/ai/pricing.ts has no rate for the model — tokens are still recorded.';
