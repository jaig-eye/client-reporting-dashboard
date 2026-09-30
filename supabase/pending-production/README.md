# Pending production migrations

Migrations in `supabase/migrations/` that have **not** been applied to production. Production has
no migration history table — migrations are applied by hand — so this list was checked against the
live schema (columns and tables in `information_schema`), not taken on trust.

**Checked 2026-09-30.** Already in production, and removed from this folder: 189, 190, 191, 222,
223, 224, 225. Still to apply, in this order:

| File | What it adds | What stays broken without it |
|---|---|---|
| `226_dataforseo_budget.sql` | `agency_settings.dataforseo_monthly_budget` (default 100) + an index on the usage ledger's date | No monthly ceiling: spend is recorded and displayed but never stopped. Reads treat the missing column as no limit, and the limit cannot be saved (the panel answers 501) |
| `227_image_model.sql` | `agency_settings.image_model` (no default — empty means the code's default model) | The model picker in Settings → Image Generation cannot save a choice (the key still saves, with a warning). Generation keeps working on the default model |
| `228_seo_tables_rls.sql` | RLS on `seo_keywords`, `seo_rankings`, `dataforseo_usage`; `security_invoker` on the `seo_keyword_current` view; revokes anon/authenticated | Nothing visible — production already has RLS on these tables and no public grants. This puts that in the migration files, so a database built from them is not exposed |

All three are additive and idempotent: no drops, no rewrites of existing rows, safe to re-run.

Apply them **before** deploying the branch. The code tolerates each column being absent, but the
ceiling and the image model only take effect once they exist.

## Migration numbers shared with another branch

`feat/ui-overhaul` also has a `222_…` and a `223_…` (`google_ads_conversion_actions`,
`seo_work_note`). Nothing tracks migration numbers here, so nothing breaks — but whichever branch
merges second should renumber its two so "is 222 applied?" has one answer.

## Where the DataForSEO spend comes from

Four places, and it is worth knowing which is which when reading `dataforseo_usage`:

**Research** — `/api/cron/keyword-research`, daily at 04:30 UTC, for clients whose research is 30+
days old (at most three per run), and on an explicit button press in the Keywords tab or the setup
wizard. Around ten Labs calls (roughly ten cents) and, when a research location is set, five live
SERPs of the starting keywords (~2¢) plus one Google Ads local-volume task (9¢). A forced re-run is
refused within an hour of the last one. Topic generation never buys research: it reads the
keywords a person ticked.

**One live SERP per generated post** — `gatherCompetitorGap` in `lib/content/competitiveIntel.ts`,
for the post's target keyword, in the research location when set: the talking points the writer is
handed and the Keywords tab's "What Google shows" card. Under a cent each. Skipped for a supporting
article whose topic collided exactly with a page the client already ranks for.

**The site-wide ranking snapshot** — free. It is the same `ranked_keywords` response research
already fetched; every row carries a position, so recording them costs no extra call. Written as
`device: 'desktop'`, `provider: 'dataforseo_labs'`, and never over a same-day live reading.

**Live checks for published posts** — `/api/cron/dataforseo-rankings`, daily at 05:00. Nothing in a
post's first 14 days (still indexing). Days 14–60: mobile every 14 days, desktop every 30. Then
mobile only, every 60 days to a year and every 182 after, and no paid checks past two years. Depth
30; a keyword's first reading goes to depth 100 so a post entering at 67 is recorded as 67 rather
than "not found". A check missed on its day is picked up the next run; a run is sized to the money
left under the monthly ceiling.

Watch `dataforseo_usage` for the first fortnight after connecting a client: the first run reads
every eligible keyword at once, and the per-run cap spreads that over a few days.

## Why the snapshot and the live checks both exist

Labs positions are refreshed weekly against a SERP database that lags 30–90 days on
low-popularity queries — which is most of what a local business ranks for. That is fine for a
baseline across the whole site and useless for "did last week's post move", which is exactly when
someone asks. Hence a cheap broad snapshot, plus live readings for the window where freshness is
the entire point.

## `is_tracked` defaults to TRUE

`seo_keywords.is_tracked` defaults to `TRUE` in `189`. Research overrides it to `false`
explicitly, because a researched candidate is a suggestion and nobody should be billed to
rank-check a list a tool produced. It flips to `true` when an article is written for that keyword
— that is what promotes a candidate into something worth measuring. Any new code path that
inserts here has to set it the same way; the default is the expensive direction.
