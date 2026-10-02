# Pending production migrations

Migrations in `supabase/migrations/` that have **not** been applied to production. Production has
no migration history table — migrations are applied by hand — so this list was checked against the
live schema (columns and tables in `information_schema`), not taken on trust.

**Checked 2026-10-01:** 189, 190, 191 and 222–229 are all in production and none are left in this
folder. The last ones applied by hand were 226 (`agency_settings.dataforseo_monthly_budget`),
227 (`agency_settings.image_model`), 228 (RLS on the SEO tables) and 229
(`content_settings.plan_generation`). Still to apply:

| File | What it adds | What stays broken without it |
|---|---|---|
| `230_schedule_hold.sql` | `content_settings.schedule_hold_since`, and sets it for monthly clients with blog topics planned on a date that isn't the first of their weekday | No schedule hold: a schedule change still plans the new dates on top of the old plan. And Monthly moves to the first of a weekday on deploy, so without the hold the cron plans every monthly client's new dates on top of its current plan within two hours |

Additive and idempotent: one new column, and the UPDATE only touches rows whose hold is empty.

Apply it **before** deploying `fix/hold-plan-on-schedule-change`. The code tolerates the column
being absent, but monthly clients are only protected once it exists.

A new migration goes here as well as in `supabase/migrations/` until it is applied, with a line on
what it adds and what stays broken without it.

## Migration numbers shared with another branch

`feat/ui-overhaul` also has a `222_…` and a `223_…` (`google_ads_conversion_actions`,
`seo_work_note`). Nothing tracks migration numbers here, so nothing breaks — but whichever branch
merges second should renumber its two so "is 222 applied?" has one answer.

## Where the DataForSEO spend comes from

Four places, and it is worth knowing which is which when reading `dataforseo_usage`:

**Research** — `/api/cron/keyword-research`, daily at 04:30 UTC, for clients whose research is 30+
days old (at most three per run), and on an explicit button press in the Keywords tab or the setup
wizard. Labs calls for the site and its competitors, then two per service — a keyword-ideas
expansion and a local-suggestions call, for up to six services, every service treated alike —
roughly 15–25 cents in all; and, when the market resolves, five live SERPs of the services (~2¢)
plus one Google Ads local-volume task (9¢). Each stored keyword records the service it is about. A
forced re-run is refused within an hour of the last one. Topic generation never buys research: it
reads the keywords a person ticked.

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
