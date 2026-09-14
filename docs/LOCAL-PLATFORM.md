# LOCAL-PLATFORM.md — The Whole Dashboard on Your Machine, With Fake Data

The full app — every admin page and every client dashboard — running locally against a local database full of realistic made-up data. Nothing touches production, and no Docker is needed.

Use it to see a UI change on real pages before it is committed (see `docs/FRONTEND-WORKFLOW.md`).

## Quick start

```bash
npm run local:setup   # once — installs portable Postgres + PostgREST into .local/
npm run local:up      # database, API and the app at http://localhost:3000
npm run local:seed    # in a second terminal — fills the database with fake data
```

Sign in at `http://localhost:3000/admin/login`:

| Account | Email | Password |
|---|---|---|
| Admin | `admin@local.test` | `local-admin-123` |
| Viewer | `viewer@local.test` | `local-viewer-123` |

`local:seed` prints a dashboard link for each client (`/api/auth/access?token=…`) — open one to see that client's dashboard the way the client does.

Ctrl+C in the `local:up` terminal stops everything. The database persists in `.local/pgdata` between runs.

## What's running

| Piece | Port | Stands in for |
|---|---|---|
| Next.js app | 3000 | the Vercel deployment |
| Gateway (`scripts/local/gateway.mjs`) | 54321 | the Supabase URL — `/rest/v1`, `/storage/v1`, `/realtime/v1` |
| PostgREST v12 | 54323 | Supabase's database API |
| Postgres 17 (embedded) | 54322 | the Supabase database |

- **Database.** Every file in `supabase/migrations` is applied in order on `local:up`, each in its own transaction, and recorded in `local_meta.migrations` so it only runs once.
- **Storage.** Uploads and public reads go to `.local/storage/`.
- **Realtime.** Accepts subscriptions so the browser doesn't log connection errors, and never sends events.
- **Auth keys.** `.local/secrets.json` holds a random local JWT secret and service/anon keys signed with it. `.env.local` is written from it.

## Seeded data

`npm run local:seed` is deterministic and re-runnable: it deletes what it seeded before and inserts it again, in one transaction. Around 20,000 rows across 44 tables.

| Client | Shape |
|---|---|
| Ridgeline Auto Performance | Every source: Google Ads, Meta, GA4, Search Console, Business Profile, CRM, WordPress, Ahrefs |
| Summit Home Services | Lead gen without Search Console or Ahrefs |
| Harbor Dental Studio | Google-only, with SEO |
| Oakline Outfitters | E-commerce layout, ROAS benchmarks |

120 days of daily metrics, blog posts in every status, Ad Fuel purchases and ledger, alerts, sync history. Columns are checked against the live schema at insert time, so a seed that references a dropped column fails loudly instead of silently.

After reseeding, restart the dev server (or delete `.next/cache`) if a page still shows old numbers — some queries are cached with `unstable_cache`.

## Screenshots of real pages

```bash
DESIGN_SHOTS_EMAIL=admin@local.test DESIGN_SHOTS_PASSWORD=local-admin-123 \
  npm run design:shots -- admin/dashboard admin/ad-fuel admin/settings

# A client dashboard — token printed by local:seed
DESIGN_SHOTS_CLIENT_TOKEN=... npm run design:shots -- dashboard dashboard/meta-ads
```

## What it can't show

- **Pages that call a third-party API live** — client Search Console pages, Stripe sync, Mailgun, AI generation. They show their empty or error state. Any button that would reach an outside service will fail; that's intended.
- **Row Level Security as production has it.** Migrations only enable RLS on a few tables, and the app uses the service role anyway. Don't use this to test RLS.
- **Email-based flows** — login codes and password resets send email. The seeded accounts don't need a reset.

## Safety

- `.env.local` is only written if it doesn't exist or was written by these scripts. If it points at a non-local Supabase URL, `local:up` refuses to start.
- Everything lives in `.local/` (git-ignored). Deleting that folder resets the whole thing; run `local:setup` again.
- The keys are local-only and random per machine.

## Where schema and production differ

Replaying migrations exposed drift — things production has that no migration creates, or migrations that can't apply. Local fixes are marked so they're easy to find:

| Where | What | Real fix |
|---|---|---|
| `scripts/local/extras/ad_fuel_ach_pending.sql` | Table used by Ad Fuel; no migration creates it. Columns inferred from the code. | A migration generated from production's definition |
| `scripts/local/overrides/182_…sql` | Original index uses a non-IMMUTABLE expression and can't apply on Postgres 17 — production likely lacks the index | A corrected migration |
| (not recreated) | `cron_logs`, `reports`, `client_content_settings` — referenced only by MCP tools | Confirm whether they exist in production |

## Platform

Windows only so far (portable Postgres and the PostgREST Windows build). macOS/Linux would need the matching PostgREST download in `setup.mjs` and its library path in `up.mjs`.
