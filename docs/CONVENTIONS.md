# CONVENTIONS.md — Coding Conventions and Pitfalls

## Data Source Rules

### Meta spend: always use the ad-level table or RPC

**The bug:** `meta_ads_metrics` (campaign-level) has reporting lag. Meta's API reports campaign-level impressions/spend with a delay of up to 24–48h, but ad-level data (`meta_ads_ad_metrics`) settles faster. Using campaign-level spend for totals causes the "spend is lower than reality" appearance on the main dashboard and Ad Fuel calculations.

**Rule:** For any total Meta spend calculation, use one of:
1. `sum_meta_spend_by_client` RPC (Supabase function — returns per-client spend from the ad-level table).
2. Direct query on `meta_ads_ad_metrics` (not `meta_ads_metrics`) for totals.

Campaign-level `meta_ads_metrics` is acceptable for campaign names, objective, and `actions`/`action_values` JSONB — it is the only table that carries those fields. But for spend/impressions/clicks totals at the client level, always use the ad-level table.

**In code:** `dashboard/page.tsx` explicitly overrides campaign-level clicks/impressions/spend from `meta_ads_ad_metrics`:
```ts
// DO THIS for Meta totals:
const metaAdLevelRows = await db.from('meta_ads_ad_metrics').select('spend, impressions, clicks')...
// NOT THIS for totals:
const metaCampaignRows = await db.from('meta_ads_metrics').select('spend')...
```

### Google Ads: use campaign-level table for conversions

Google Ads campaign-level (`google_ads_metrics`) is accurate for conversions and conversion value. Use `google_ads_ad_metrics` only for ad-level drill-downs — do not aggregate ad-level rows to get campaign totals (they can have different attribution windows and stub rows).

### GSC: use `gsc_daily_totals` for totals, not `gsc_metrics`

`gsc_metrics` stores raw query+page rows (very large table). For any aggregate view (clicks, impressions, CTR, position), always use the pre-aggregated tables:
- `gsc_daily_totals` — daily click/impression totals
- `gsc_query_totals` — per-query per-day
- `gsc_page_totals` — per-page per-day

The `get_gsc_summary` RPC handles this automatically. Use it instead of querying directly.

### Ahrefs: no `connection_id` filter needed

Ahrefs is keyed on `client_id` only in the metrics tables (one domain per client). Do not add a `connection_id` filter when querying `ahrefs_metrics`, `ahrefs_keywords`, or `ahrefs_pages`.

### Ad Fuel balance calculation: use RPC, not raw table scan

The `sum_google_spend_by_client` and `sum_meta_spend_by_client` RPCs handle the cutoff date and bypass PostgREST's default row limit (1000 rows). Never use `.select().sum()` directly on `google_ads_metrics` for lifetime spend — it will silently return incorrect totals for clients with large datasets.

---

## Supabase Patterns

### Always use `createAdminClient()` in API routes and server components

```ts
import { createAdminClient } from '@/lib/supabase/server'
const db = createAdminClient()
```

The admin client uses `SUPABASE_SECRET_KEY` (service role), which bypasses RLS. Never use `createClient()` (anon key) in server-side code — it will fail on protected tables.

`createClient()` from `lib/supabase/client.ts` is only for the browser, for public read-only queries where the client has already authenticated via token cookie.

### Use `.maybeSingle()` for optional lookups

`.single()` throws a 406 (PGRST116) error when no row is found. This causes uncaught exceptions in server components. Always use `.maybeSingle()` for queries that may return zero rows:

```ts
// CORRECT:
const { data: client } = await db.from('clients').select('*').eq('id', id).maybeSingle()
if (!client) return notFound()

// WRONG — throws 406 if row missing:
const { data: client } = await db.from('clients').select('*').eq('id', id).single()
```

### RPC preference for aggregate queries

Use Supabase RPCs (`db.rpc('function_name', { param })`) when:
- The query would hit PostgREST's 1000-row limit
- You need a cross-table aggregation (e.g., spending across all connections for a client)
- The query involves window functions or complex joins that PostgREST can't express

RPCs run as `SECURITY DEFINER` and bypass RLS, so they're safe for admin-context aggregations.

### Upsert conflict keys

All upsert functions in `sync.ts` use explicit `onConflict` keys. Never use a generic `.upsert()` without specifying the conflict column(s). Batch size is 200 rows per call (1000 for `gsc_metrics`, 500 for keywords/negative keywords).

### GBP row casting

`GBPRawRow` is not part of the `RawMetricRow` union (`GoogleAdsRawRow | MetaAdsRawRow`). The GBP upsert helper casts rows through `unknown`:
```ts
const row = gbpRow as unknown as SomeExpectedShape
```
This is intentional and documented — do not "fix" it.

---

## API Route Structure Template

Every admin API route follows this pattern:

```ts
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { ApiError, parseBody, errorResponse } from '@/lib/apiError'
import { logActivity } from '@/lib/activity'

export async function POST(request: Request) {
  // 1. Auth check
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse body
  const body = await parseBody<{ clientId: string }>(request)
  if (!body?.clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  try {
    const db = createAdminClient()
    // 3. DB operations
    const { data, error } = await db.from('...').insert({...}).select().maybeSingle()
    if (error) throw new ApiError(500, error.message)

    // 4. Log activity
    const session = await getAdminSession()
    logActivity(session, 'create', 'client', { resourceId: data.id })

    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
```

**Rules:**
- All admin routes check `admin_session` cookie via `isAdminAuthed`.
- Cron routes check `Authorization: Bearer ${CRON_SECRET}` directly — do not use `isAdminAuthed`.
- Use `parseBody<T>()` rather than `request.json()` directly — it returns null on parse failure.
- Always use `errorResponse(err)` in the catch block — it handles `ApiError` status codes automatically.
- Fire-and-forget `logActivity()` for all mutations (insert, update, delete).
- Super-admin-only routes use `isSuperAdminAuthed(session)`. Never check for the absence of `admin_user_id` — that cookie is client-editable, so its absence proves nothing.

---

## TypeScript Cast Patterns Unique to This Codebase

### GBP rows
GBP metric rows do not match the `RawMetricRow` union type. Cast via `unknown`:
```ts
await upsertGBPMetrics(db, connectionId, clientId, rows as unknown as GBPMetricInput[])
```

### Meta `actions` / `action_values`
These come from Supabase as `Json` (Supabase's generic type). Cast to `MetaAction[]` when reading:
```ts
const actions = (row.actions as MetaAction[]) ?? []
```

### `AgencySettings` from DB
`agency_settings` columns may be null when the DB row is partial. The `getAgencySettings()` function merges with `DEFAULT_SETTINGS` to fill gaps, so always use `getAgencySettings()` rather than reading the DB row directly.

### Connector `auth` and `config`
These are `JSONB` in the DB, typed as `Record<string, unknown>` in TypeScript. Always use optional chaining and nullish coalescing when reading values:
```ts
const locationId = (connector.config as Record<string, unknown>)?.location_id as string | undefined
```

### `maybeSingle()` return type narrowing
```ts
const { data } = await db.from('clients').select('id, name').eq('id', id).maybeSingle()
// data is Client | null — always null-check before use
if (!data) throw new ApiError(404, 'Client not found')
```

---

## Ad Fuel Calculation Rules

### `applyAdFuel(rawSpend, cutPct)` — gross-up, not markup

The formula is: `rawSpend / (1 - cutPct)`.

With a 20% cut and $1000 raw spend: `1000 / 0.8 = $1250` Ad Fuel billed (not $1200).

Guards:
- `cutPct <= 0` → returns `rawSpend` (no cut applied)
- `cutPct >= 1` → returns `rawSpend` (invalid config guard, prevents division by zero)

### `isAdFuelLine(line)` — Stripe line item detection

A Stripe invoice line is classified as Ad Fuel if (case-insensitive):
- `line.description` contains `"ad fuel"`, OR
- `line.price.product.name` contains `"ad fuel"`, OR
- `line.price.nickname` contains `"ad fuel"`

Never hardcode a Stripe price ID or product ID — use the description heuristic.

### Ad Fuel balance formula

```
afPurchased = sum(ad_fuel_ledger.amount_af WHERE client_id = X AND date_of_payment >= cutoffDate)
rawSpend    = googleLifetimeSpend + metaLifetimeSpend - historicBillDayGapAdjustment
afSpend     = rawSpend / (1 - clientCutPct)
balance     = afPurchased - afSpend
```

A negative balance means the client has overspent their purchased Ad Fuel.

### `historic_bill_day` gap adjustment

For clients who started mid-billing-cycle: subtract spend from `cutoffDate` to `effectiveCutoff - 1 day` so they aren't penalized for spend before their first billing cycle began. `effectiveCutoff` is computed as the first occurrence of `historic_bill_day` on or after `cutoffDate`.

### `split_override` in ledger entries

If `split_override` is set on a ledger entry (between 0 and 1), it overrides the client/agency `ad_fuel_cut` for that specific entry. This allows per-payment fee adjustments. If not set, the client's `ad_fuel_cut` (or agency default) applies.

---

## Auth Patterns

### Client portal auth
Clients access via `client_token` cookie, set by `GET /api/auth/access?token=UUID`. Cookie is HttpOnly, Secure, SameSite=None, 1-year maxAge. All dashboard pages read this cookie in `dashboard/layout.tsx` to load the client row.

### Admin auth — session vs user
`admin_session` holds an **HMAC-signed token** (`lib/session.ts`) carrying `{ isSuperAdmin, userId, role, iat, exp }`. It is NOT the raw `ADMIN_PASSWORD` — that was the old scheme, and it meant cookie theft handed over the password itself.

- **Super admin:** token claims `isSuperAdmin: true`. No `users` row.
- **Regular admin:** token carries `userId` and `role`, looked up from `users`.

| Need | Use |
|---|---|
| "is anyone signed in?" | `isAdminAuthed(session)` — synchronous, no DB |
| "is this the super admin?" | `isSuperAdminAuthed(session)` |
| "which user is acting?" | `getVerifiedUserId(session)` |
| role / name / email | `await getAdminSession()` |

**Never derive identity or privilege from the `admin_user_id` cookie.** It is unsigned and client-editable; it survives only as a non-authoritative display hint. Deleting it used to promote any admin to super admin, and setting it to a colleague's uuid attributed your writes to them.

`SESSION_SECRET` is required in production — there is no `ADMIN_PASSWORD` fallback, because that value was the cookie itself until this change and may sit in request logs.

### Cron auth
Cron routes use `Authorization: Bearer CRON_SECRET`. Never use `isAdminAuthed` in cron routes. Always go through the helper:
```ts
import { verifyCronAuth } from '@/lib/auth'

if (!verifyCronAuth(request.headers.get('authorization'))) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```
Do **not** hand-roll the comparison. Interpolating an unset `CRON_SECRET` into a Bearer template produces the literal string `"Bearer undefined"`, which is truthy — so the old inline check let anyone sending that exact header authenticate as the cron. A bare `===` also short-circuits on the first differing byte, leaking the secret to a timing probe. `verifyCronAuth` fails closed on a missing secret and compares in constant time.

### `cleanup-rejected-topics` cron uses a different auth pattern
```ts
// Supports both header and query param:
const secret = request.headers.get('x-cron-secret') ?? url.searchParams.get('secret')
if (secret !== process.env.CRON_SECRET) { ... }
```
Do not change this — it was set up to support Vercel's cron before Bearer token support.

---

## Component Patterns

### Server components for data display (no `'use client'`)

Connection summary cards (`GA4SummaryCard`, `GSCSummaryCard`, `GBPSummaryCard`, `AhrefsSummaryCard`, `ConnectionSummaryCard`) and dashboard page layouts are server components. They fetch data at render time from Supabase.

**Rules:**
- Do not add `'use client'` to these components.
- Do not use `useEffect` to fetch data — pass it down as props from the server component or fetch directly in the async server component body.
- Use `unstable_cache` (from `next/cache`) for expensive queries that don't need per-request freshness, with appropriate `revalidate` values.

### Client components for interactivity

Components that use `useState`, `useEffect`, `useRouter`, `useSearchParams`, or event handlers must have `'use client'` at the top.

**Pattern for hybrid pages:**
- Server component (`page.tsx`) fetches all data, passes it as props.
- Client component receives initial data as props, handles local state / URL mutations.

Do not fetch in client components with `useEffect` unless the data genuinely depends on client-side state that cannot be computed server-side.

### Keep-alive tab pattern (admin client detail)

`ClientContentTabPanel.tsx` uses a CSS `display:none/block` pattern instead of unmounting inactive tabs, to preserve component state and avoid re-fetching on tab switch:
```ts
const [visited, setVisited] = useState(new Set<string>())
// Lazy-mount: only render panel after first visit to that tab
// Then hide with style={{ display: activeTab === tab ? 'block' : 'none' }}
```
Use this pattern for any tab panel that makes API calls on mount.

---

## Content Generation Patterns

### AI provider routing

The agency can configure `ai_provider` as `'anthropic'` or `'openai'` in `agency_settings`. All content generation code checks `settings.ai_provider` before making API calls:
```ts
if (settings.ai_provider === 'openai') {
  // call OpenAI API with settings.ai_api_key or openai_api_key
} else {
  // default: call Anthropic API with settings.ai_api_key
}
```

### Post generation prompt structure

1. System prompt: master writing prompt + E-E-A-T signals + brand DNA (background, services, audience, geo, voice)
2. User prompt: topic, target keyword, secondary keywords, search intent, word count target, H2 outline (from SEO brief), internal link targets, existing sitemap pages for linking
3. Expected JSON response parsed into content, title, seo_title, meta_description, slug, excerpt, suggested_tags

### Avoid list / deduplication

`generateTopicsForClient` builds an avoid list from:
- Existing `content_topics` (non-rejected) — topic text
- Recent `content_posts` (last 90 days) — title

Topics with keywords that are too similar to existing ones are filtered by the AI via the avoid list injected into the prompt.

### SEO scoring (`scoreSeoPost`)

Pure function — no DB or AI calls. Input: `{ html, title, metaDesc, slug, wordCount, targetLength, brief }`. Returns `SeoScore` with `overall` (0–100), 12 boolean signals, `issues[]`, `warnings[]`. Key penalties: keyword not in title (−10), missing H2s (−15), no internal links (−20), no CTA (−12).

---

## Connector Adapter Pattern

### How to add a new connector

1. Create `src/lib/connectors/your-connector.ts` that exports a `const yourConnector: ConnectorAdapter` object implementing the 4 interface methods:
   - `type: ConnectorType`
   - `fetchMetrics(externalId, auth, config, dateFrom, dateTo, onProgress?)`: returns `Promise<SyncResult>`
   - `discoverAccounts(auth, config)`: returns `Promise<DiscoveredAccount[]>`
   - `testConnection(auth, config)`: returns `Promise<boolean>`
   - `refreshAuth?(auth)`: optional; return updated auth object or null

2. Add the new `ConnectorType` string to the union in `src/lib/types.ts`.

3. Register the connector in `src/lib/connectors/registry.ts`:
   - Add a `ConnectorTypeDef` entry to `CONNECTOR_DEFINITIONS`
   - Add the adapter to `CONNECTOR_ADAPTERS`

4. Add an upsert function to `src/lib/connectors/sync.ts` following the `upsertXxxMetrics(db, connectionId, clientId, rows)` pattern.

5. Create the metrics table migration in `supabase/migrations/`.

6. Add the new `ConnectorType` to the `connectors` table `type` check constraint (migration).

### `SyncResult.extraRows` pattern

Use `extraRows` when a single fetch call returns multiple logically distinct table payloads:
```ts
return {
  rows: primaryRows,  // maps to the main metrics table
  extraRows: {
    ga4_source_metrics: sourceRows,  // maps to secondary table
  }
}
```
`syncClient` in `sync.ts` reads `extraRows` keys and dispatches them to the corresponding upsert functions.

### Stub row pattern

When a platform returns zero-activity rows for PAUSED or ENABLED campaigns with no activity, add $0 stub rows explicitly. This ensures the client's full account setup is visible in the UI even when campaigns have zero spend in the sync window. Both Google Ads and Meta Ads connectors implement this pattern.

---

## Sync Architecture

### `syncClient` orchestration

`syncClient(clientId, jobType, days, connectionId, ...)` in `sync.ts`:
1. Fetches all active `client_connections` for the client (optionally filtered by `connectionId` or `connectorTypes`).
2. For each connection, resolves auth from the connector row and optionally calls `refreshAuth`.
3. Creates a `sync_jobs` row with `status: 'running'`.
4. Dispatches to the correct connector adapter `fetchMetrics` (or `syncGSCInChunks` for GSC).
5. Calls the appropriate upsert function with the result rows.
6. For Google Ads and Meta Ads, also runs ad-level sub-fetches (`fetchGoogleAdMetrics`, `fetchMetaAdMetrics`) in parallel via `Promise.allSettled` (best-effort — does not fail the main sync).
7. Updates the `sync_jobs` row with `status: 'success'` or `'error'`.

### Date window calculation

- `'backfill'` job type: `BACKFILL_DAYS = 730` days from today.
- `'incremental'` job type: `INCREMENTAL_DAYS = 7` days from yesterday.
- `'manual'` job type: uses the `days` parameter or `dateFrom`/`dateTo` if provided.
- `sync_from` on a `client_connection` row overrides the start date (prevents fetching data before the client was active).

### GSC special case

GSC's `fetchMetrics` adapter method is a **no-op stub** that returns `{ rows: [] }`. Do not call it directly for syncing. The actual sync logic is in `syncGSCInChunks` (internal to `sync.ts`), which:
- Splits the date range into 30-day chunks
- Runs 5 concurrent batches per chunk
- Each chunk runs 2D (date+query) and 2D (date+page) fetches in parallel
- Chunks within the last 30 days also get a 3D (date+query+page) fetch
- Results go into `gsc_daily_totals`, `gsc_query_totals`, `gsc_page_totals`, and raw `gsc_metrics`

---

## Security Rules

1. **Never return `auth` column from connectors in API responses.** All `/api/admin/connectors` routes explicitly exclude `auth` before returning. The `auth` JSONB contains access tokens and credentials.

2. **Never return `password_hash` from users.** The `users` table has a `password_hash` column. All queries on `users` must use a specific column list that excludes `password_hash`.

3. **Cookie security flags:** In production, cookies are `Secure: true`, `SameSite: 'none'` (required for cross-domain use). In development, `Secure: false`, `SameSite: 'lax'`. The `NODE_ENV` check in `auth.ts` controls this.

4. **Admin cookie value:** `admin_session` is an HMAC-signed session token (`lib/session.ts`), signed with `SESSION_SECRET`. It is HttpOnly. Cookie theft still grants admin for the token lifetime (14 days) — there is no server-side revocation list — but it no longer discloses `ADMIN_PASSWORD`, and the claims inside it cannot be edited.

5. **`/api/auth/access` does not require auth.** It is the public entry point for clients. The token in the query param is the only validation. Requests with no valid token redirect to `/access`.

6. **CORS on `/api/adfuel`:** The GHL sidebar widget endpoint sets `Access-Control-Allow-Origin: *`. Do not add `*` CORS headers to any other route.

7. **`INGEST_SECRET` for MCC push.** The `/api/ingest/google` and `/api/ingest/meta` routes return **202** (not 401) when the connection is not found, so MCC scripts do not fail — but they still validate the `x-ingest-secret` header first and do return 401 for invalid secrets.

8. **Content Security Policy for admin.** `next.config.mjs` sets `frame-ancestors 'self' golaunchlocal.com *.golaunchlocal.com` on `/admin` routes to prevent clickjacking. Do not remove or loosen this.

---

## What NOT to Do — Past Bug Causes

### 1. Do not use `meta_ads_metrics.spend` for client-level totals
This was the original Ad Fuel balance calculation bug. Campaign-level spend lags ad-level spend by 24–48h. The fix was migration 135 which updated `sum_meta_spend_by_client` and `daily_meta_spend_by_client` RPCs to read from `meta_ads_ad_metrics` instead. All new code must use the RPC or the ad-level table directly.

### 2. Do not use `.single()` where a row might not exist
`.single()` throws a Postgres 406 error when no row is found. This caused crashes in server components before the codebase switched to `.maybeSingle()`.

### 3. Do not add the `country` dimension to GSC queries
The `country` dimension was removed from GSC syncing because it caused 5–20x row inflation (one row per country per query per page per day). `gsc_metrics` still has the column but it defaults to `NULL`. Never re-add `country` as a GSC query dimension.

### 4. Do not call `router.refresh()` inside `DashboardNavigationRefresher`
This was the original implementation and caused a double-render race condition on navigation. The component now returns `null` intentionally. Do not re-add the `router.refresh()` call.

### 5. Do not aggregate Google Ads ad-level rows for campaign totals
`google_ads_ad_metrics` can have different attribution settings and stub rows. For campaign-level totals, always use `google_ads_metrics`.

### 6. Do not use the GSC `fetchMetrics` adapter for syncing
It is a stub that returns `{ rows: [] }`. Calling it and expecting data is a silent failure. Use `syncGSCInChunks` from `sync.ts` for GSC syncing.

### 7. Do not hardcode Stripe price/product IDs for Ad Fuel detection
Use the `isAdFuelLine()` helper which checks description text case-insensitively. Product names and price nicknames can change.

### 8. Do not query `campaign_metrics` (old table) or `ad_accounts` (old table)
These are the migration 001 tables now replaced by `client_connections` and the connector system. The `AdAccount` and `SyncLog` types in `types.ts` are marked as deprecated.

### 9. Do not skip the `historic_bill_day` gap adjustment in Ad Fuel calculations
The gap adjustment prevents clients who joined mid-billing-cycle from being double-charged for spend that happened before their first billing cycle started. Omitting it causes negative balances for new clients. Every Ad Fuel balance calculation must include this adjustment for clients with `historic_bill_day` set.

### 10. Do not call `applyAdFuel` with a per-line-item cutPct from `split_override` on the ledger
`split_override` on `ad_fuel_ledger` rows is the fraction the client KEEPS (not the agency cut), stored as a complement. `applyAdFuel` takes the agency CUT percentage (0.20 for 20%). These are not the same field. Use `1 - split_override` if you need the effective cut from a `split_override` field.

### 11. Do not call `resolveMetaConversions` with `undefined` as the primary action
The function uses a `-1` sentinel to distinguish "action type not found" from "action type found but value is 0". Passing `undefined` as `primaryAction` will try to match the string `"undefined"` in the actions array and always fall through to the fallback. Always pass a real action type string or skip the call.

### 12. Do not use `unstable_cache` with `revalidate: 0`
This defeats the cache entirely. Use `noStore()` from `next/cache` for truly uncacheable queries, or omit the cache wrapper. The router cache is already globally disabled in `next.config.mjs` (`staleTimes: { dynamic: 0, static: 0 }`).
