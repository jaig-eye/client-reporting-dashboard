# Pending production migrations

Migrations that exist in `supabase/migrations/` and have **not** been applied to production.
Apply them in numeric order, oldest first.

Everything here is additive — new tables and columns, no drops, no rewrites of existing rows.
Nothing in the live dashboard reads any of it until the tables exist, so applying these changes
nothing on its own.

| File | What it adds | What stays broken without it |
|---|---|---|
| `189_openseo_connector.sql` | `seo_keywords`, the keyword registry | Keyword discovery stores nothing; topic selection loses the discovered-opportunity and tracked-rank sections |
| `190_dataforseo_tracking.sql` | `seo_rankings` and the tracking config | No rank history; the rankings cron is a no-op |
| `215_dfs_pending_tasks.sql` | The Standard-queue task ledger | Rank checks cannot use the cheap queue — the cron stays dormant rather than falling back to the 3.3× more expensive live endpoint |

## Order matters

`215` has a foreign key to `seo_keywords(id)`, so `189` has to land first. `190` references the
same table. Applying out of order fails loudly rather than silently, but there is no reason to
find that out.

## After applying

The DataForSEO work stays inert until a client actually has a `dataforseo` connection with a
domain in `external_id`. Until then every path soft-fails to empty: prompts get smaller, crons
report `dormant: true`, and nothing is billed.

Two crons start doing real work once a connection exists:

- `/api/cron/dataforseo-rankings` (daily, 05:00) — submits and collects rank checks
- `/api/cron/keyword-discovery` (weekly, Monday 04:00) — refills a client's candidate pool when
  it drops below 40 unclaimed keywords

Watch `dataforseo_usage` for the first week. The first run after a connection is made checks every
tracked keyword at once — the per-run cap spreads that over several days, and steady state is far
lower than that first week suggests.

## `is_tracked` defaults to TRUE

`seo_keywords.is_tracked` defaults to `TRUE` in `189`. Keyword discovery overrides it to `false`
explicitly, because a discovered candidate is a suggestion and nobody should be billed for
rank-checking a list a tool produced. Any new code path that inserts into this table has to set it
the same way — the default is the expensive direction.
