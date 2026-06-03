# CLAUDE.md — Agent Instructions for client-reporting-dashboard

## Package Manager
npm (never use yarn or pnpm)

## Commands
| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Lint | `npm run lint` |
| Type-check | `npx tsc --noEmit` |

## External References
| Topic | File |
|---|---|
| Design system, component props, color tokens | `docs/DESIGN.md` |
| Env vars, DB tables, RPCs, cron jobs, API routes | `docs/SYSTEMS.md` |
| Coding conventions, pitfalls, patterns | `docs/CONVENTIONS.md` |

## Key Conventions (read before editing)

**Data source rules — Meta spend must come from ad-level table.**
Never aggregate Meta spend from `meta_ads_metrics` (campaign-level) for totals; always use `sum_meta_spend_by_client` RPC or `meta_ads_ad_metrics` directly. Campaign-level Meta spend lags. See `docs/CONVENTIONS.md#data-source-rules`.

**Ad Fuel formula is a gross-up, not a markup.**
`applyAdFuel(rawSpend, cutPct)` computes `rawSpend / (1 - cutPct)`. A 20% cut on $1000 raw spend = $1250 AF, not $1200.

**Meta conversions use `resolveMetaConversions`.**
Never sum `actions` arrays directly. Always call `resolveMetaConversions(actions, actionValues, primaryAction, fallbackAction)` from `lib/metrics.ts`. The function tries primary → fallback → `omni_purchase`.

**Admin client uses `createAdminClient()` from `lib/supabase/server.ts`.**
Never use `createClient()` (browser anon key) in API routes or server components.

**Use `.maybeSingle()` not `.single()` for optional DB lookups.**
`.single()` throws a 406 error when no row is found; `.maybeSingle()` returns null safely.

**GBP rows cast through `unknown`.**
`GBPRawRow` does not satisfy `RawMetricRow`, so upsert helpers cast via `row as unknown as ExpectedType`.

**Cron routes auth via `Authorization: Bearer CRON_SECRET`.**
Never use `isAdminAuthed` in cron routes; check the Bearer token directly from the header.

**GSC `fetchMetrics` adapter is a no-op stub.**
All GSC syncing is done by `syncGSCInChunks` in `lib/connectors/sync.ts`, not the adapter method.

**Never auto-push to git.** Stop at commit and wait for an explicit push instruction.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
