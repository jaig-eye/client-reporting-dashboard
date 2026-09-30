-- 228: Lock down the SEO keyword tables the way every other table here is locked down.
--
-- 189–191 created seo_keywords, seo_rankings and dataforseo_usage without enabling row-level
-- security, and 190 created the seo_keyword_current view without security_invoker, so the view runs
-- with its owner's rights and ignores RLS on the tables beneath it. Production is not exposed —
-- RLS was switched on there by hand and anon/authenticated hold no grants — but a database built
-- from these files (a fresh project, a restore, the local platform) would hand every client's
-- keywords, rankings and spend to anyone holding the public anon key.
--
-- The app reads and writes these only through the service role, which bypasses RLS, so this
-- changes nothing the app does. Same convention as the rest of the schema: RLS on, no policies.
--
-- Idempotent: safe on production, where RLS is already on.

ALTER TABLE public.seo_keywords     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_rankings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dataforseo_usage ENABLE ROW LEVEL SECURITY;

-- The view now checks the caller's rights against the tables' RLS instead of its owner's.
ALTER VIEW public.seo_keyword_current SET (security_invoker = true);

REVOKE ALL ON public.seo_keywords        FROM anon, authenticated;
REVOKE ALL ON public.seo_rankings        FROM anon, authenticated;
REVOKE ALL ON public.dataforseo_usage    FROM anon, authenticated;
REVOKE ALL ON public.seo_keyword_current FROM anon, authenticated;
