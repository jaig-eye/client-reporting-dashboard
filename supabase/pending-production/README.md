# Pending production migrations

Migrations that exist in `supabase/migrations/` and have **not** been applied to production.
Apply them in numeric order, oldest first: 189, 190, 191, 222, 223, 224.

All six are additive — new tables and columns, no drops, no rewrites of existing rows. Nothing in the
live dashboard reads either until the tables exist, so applying them changes nothing on its own.

| File | What it adds | What stays broken without it |
|---|---|---|
| `189_openseo_connector.sql` | `seo_keywords`, the keyword registry | Research stores nothing; topic selection loses the researched-opportunities section |
| `190_dataforseo_tracking.sql` | `seo_rankings` and the tracking config | No rank history — neither the site-wide snapshot nor the live checks have anywhere to write |
| `191_dataforseo_usage.sql` | `dataforseo_usage`, the spend ledger | Every DataForSEO cost is silently unrecorded: the agency usage panel stays empty and the `$` figures the wizard shows are never kept. Nothing else breaks — the ledger soft-fails by design — which is how this one went unlisted |
| `222_foundational_keywords.sql` | `content_settings.foundational_keywords` + `last_keyword_research_at`; widens `seo_keywords.source` to allow `google_ads` | Seed keywords from the wizard are dropped on save; the 30-day research reuse gate falls back to row ages; database-only research rows fail the `source` check. The code tolerates all three being absent, but each logs a warning naming this file |
| `223_seo_keyword_dismissal.sql` | `seo_keywords.dismissed_at` | The × on a researched keyword in the wizard answers 501, so dismissed keywords cannot be kept out of the pool. Every read tolerates the column being absent |
| `224_research_location.sql` | `content_settings.research_location` | The Research Location picked in Brand DNA or the wizard is dropped on save, so research and rank checks stay country-wide: national volumes, national competitors. Every read tolerates the column being absent |

`190` builds on `seo_keywords`, so `189` has to land first, and `222` after `190` — its `seo_keywords` change is guarded so it cannot fail if run early, but the guard means that part silently does nothing until the table exists. Applying out of order fails loudly
rather than silently, but there is no reason to find that out.

## After applying

Everything stays inert until a client actually has a `dataforseo` connection with a domain in
`external_id`. Until then every path soft-fails to empty: prompts get smaller, the cron reports
`dormant: true`, and nothing is billed.

## Where the DataForSEO spend comes from

Three places, and it is worth knowing which is which when reading `dataforseo_usage`:

**Research, inline at topic selection** — six Labs calls, roughly six cents, at most once every
30 days per client (`RESEARCH_MAX_AGE_DAYS` in `lib/content/clientResearch.ts`). Reuse is the
normal path.

**The site-wide ranking snapshot** — free. It is the same `ranked_keywords` response research
already fetched; every row carries a position, so recording them costs no extra call. Written as
`device: 'desktop'`, `provider: 'dataforseo_labs'`.

**Live checks for recent posts** — `/api/cron/dataforseo-rankings`, daily at 05:00. Only posts
inside the 60-day window, mobile weekly and desktop monthly, at depth 30. A keyword's first
reading goes to depth 100 so a post entering at 67 is recorded as 67 rather than "not found".

Expect roughly $10/month across ten clients publishing twice a week. Watch `dataforseo_usage` for
the first fortnight; the first run after a connection is made reads every eligible keyword at
once, and the per-run cap spreads that over a few days.

## Why the snapshot and the live checks both exist

Labs positions are refreshed weekly against a SERP database that lags 30–90 days on
low-popularity queries — which is most of what a local business ranks for. That is fine for a
baseline across the whole site and useless for "did last week's post move", which is exactly when
someone asks. Hence a cheap broad snapshot, plus live readings for the short window where
freshness is the entire point.

## `is_tracked` defaults to TRUE

`seo_keywords.is_tracked` defaults to `TRUE` in `189`. Research overrides it to `false`
explicitly, because a researched candidate is a suggestion and nobody should be billed to
rank-check a list a tool produced. It flips to `true` when an article is written for that keyword
— that is what promotes a candidate into something worth measuring. Any new code path that
inserts here has to set it the same way; the default is the expensive direction.
