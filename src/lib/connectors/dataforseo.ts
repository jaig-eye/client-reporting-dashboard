// ─────────────────────────────────────────────────────────────────────────────
// DataForSEO connector — keyword data + SERP rank tracking
//
// "OpenSEO" turned out to be a bring-your-own-DataForSEO-key wrapper, so we integrate
// DataForSEO directly (cheapest, no middleman, matches our ConnectorAdapter pattern).
//
// Auth:   HTTP BASIC — Authorization: Basic base64("login:password").
//         Stored in connector.auth = { dataforseo_login, dataforseo_password }.
//         Falls back to env DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (or a pre-encoded
//         DATAFORSEO_API_KEY = base64("login:password")).
// Base:   https://api.dataforseo.com   — all endpoints POST, body is an array of tasks.
// Target: the client's domain, stored as external_id on client_connections (e.g. "example.com").
//
// This module is the ENGINE; the connector is labelled "DataForSEO" in the UI. Every
// call SOFT-FAILS (returns []/null/false, never throws) so the provider-fallback chain
// (DataForSEO → SerpAPI → GSC) and the dormant-until-connected contract hold.
//
// Cost (raw DataForSEO, per their docs): SERP task Standard ~$0.0006/10 results;
// Labs keyword_overview ~$0.01; Google Ads search_volume ~$0.05/task. Rank depth and
// device coverage are configurable (see SeoTrackingConfig) — the two biggest levers.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const BASE_URL = 'https://api.dataforseo.com'

// ── Tracking configuration (agency default + per-client override) ─────────────

export type SeoDevice = 'desktop' | 'mobile'

export interface SeoTrackingConfig {
  rank_depth:    number       // SERP depth to track (20 = page 1–2 lean, 100 = full)
  devices:       SeoDevice[]  // which devices to rank-check
  location_code: number       // DataForSEO location (2840 = United States)
  language_code: string       // e.g. 'en'
}

export const DEFAULT_SEO_CONFIG: SeoTrackingConfig = {
  rank_depth:    100,
  devices:       ['desktop', 'mobile'],
  location_code: 2840,
  language_code: 'en',
}

/** Merge agency-default config with a per-client override (client wins field-by-field). */
export function resolveSeoConfig(
  agency?: Partial<SeoTrackingConfig> | null,
  client?: Partial<SeoTrackingConfig> | null,
): SeoTrackingConfig {
  const merged = { ...DEFAULT_SEO_CONFIG, ...(agency ?? {}), ...(client ?? {}) }
  // Sanitise
  const depth = Math.max(10, Math.min(100, Math.round(merged.rank_depth || DEFAULT_SEO_CONFIG.rank_depth)))
  const devices = Array.isArray(merged.devices) && merged.devices.length
    ? merged.devices.filter((d): d is SeoDevice => d === 'desktop' || d === 'mobile')
    : DEFAULT_SEO_CONFIG.devices
  return {
    rank_depth:    depth,
    devices:       devices.length ? devices : DEFAULT_SEO_CONFIG.devices,
    location_code: Number(merged.location_code) || DEFAULT_SEO_CONFIG.location_code,
    language_code: String(merged.language_code || DEFAULT_SEO_CONFIG.language_code),
  }
}

// Common country → DataForSEO location_code (extend as needed; unknown → US).
const COUNTRY_LOCATION: Record<string, number> = {
  us: 2840, ca: 2124, gb: 2826, uk: 2826, au: 2036, nz: 2554, ie: 2372, in: 2356,
}
export function countryToLocationCode(country?: string | null): number {
  return COUNTRY_LOCATION[(country ?? 'us').toLowerCase()] ?? 2840
}

// ── Credentials ───────────────────────────────────────────────────────────────

export interface DfsCreds { login: string; password: string }

/** Resolve credentials from connector.auth, then env. Returns null when unconfigured. */
export function resolveDfsCreds(auth?: Record<string, unknown> | null): DfsCreds | null {
  const login    = String(auth?.dataforseo_login ?? process.env.DATAFORSEO_LOGIN ?? '')
  const password = String(auth?.dataforseo_password ?? process.env.DATAFORSEO_PASSWORD ?? '')
  if (login && password) return { login, password }
  // Optional pre-encoded base64("login:password")
  const encoded = String(auth?.dataforseo_api_key ?? process.env.DATAFORSEO_API_KEY ?? '')
  if (encoded) {
    try {
      const [l, p] = Buffer.from(encoded, 'base64').toString('utf8').split(':')
      if (l && p) return { login: l, password: p }
    } catch { /* ignore */ }
  }
  return null
}

function basicAuthHeader(creds: DfsCreds): string {
  return 'Basic ' + Buffer.from(`${creds.login}:${creds.password}`).toString('base64')
}

async function dfsPost(path: string, creds: DfsCreds, task: Record<string, unknown>, timeoutMs = 30_000): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method:  'POST',
      headers: { Authorization: basicAuthHeader(creds), 'Content-Type': 'application/json' },
      body:    JSON.stringify([task]),   // DataForSEO body is always an array of tasks
      signal:  AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) { console.error(`[dataforseo] ${path} HTTP ${res.status}`); return null }
    const json = await res.json() as Record<string, unknown>
    return json
  } catch (e) {
    console.error(`[dataforseo] ${path} failed:`, e)
    return null
  }
}

// Pull tasks[0].result[0].items[] (Labs/SERP shape) defensively.
function firstResultItems(json: Record<string, unknown> | null): Record<string, unknown>[] {
  const tasks = (json?.tasks as Record<string, unknown>[] | undefined) ?? []
  const result = (tasks[0]?.result as Record<string, unknown>[] | undefined) ?? []
  const items = (result[0]?.items as Record<string, unknown>[] | undefined)
  return Array.isArray(items) ? items : []
}
// Pull tasks[0].result[] (Keywords Data shape — result is the array directly).
function firstResultArray(json: Record<string, unknown> | null): Record<string, unknown>[] {
  const tasks = (json?.tasks as Record<string, unknown>[] | undefined) ?? []
  const result = (tasks[0]?.result as Record<string, unknown>[] | undefined)
  return Array.isArray(result) ? result : []
}
function num(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null
}

// ── Shared shapes ─────────────────────────────────────────────────────────────

export interface DfsKeywordData {
  keyword:            string
  search_volume:      number | null
  keyword_difficulty: number | null   // 0–100
  cpc:                number | null
  competition:        number | null   // 0–1
  intent:             string | null
  monthly_searches:   unknown[] | null
}

export interface DfsRankResult {
  keyword:        string
  position:       number | null   // organic rank (rank_group); null = not found within depth
  rank_absolute:  number | null   // position across all SERP elements
  url:            string | null
  serp_features:  string[]
}

// ── Keyword overview (volume + difficulty + intent in one Labs call) ──────────

export async function dfsKeywordOverview(
  keywords: string[],
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string } = {},
): Promise<DfsKeywordData[]> {
  const kws = keywords.map(k => k.trim()).filter(Boolean).slice(0, 700)
  if (!kws.length) return []
  const json = await dfsPost('/v3/dataforseo_labs/google/keyword_overview/live', creds, {
    keywords:      kws,
    location_code: opts.locationCode ?? 2840,
    language_code: opts.languageCode ?? 'en',
  })
  return firstResultItems(json).map(it => {
    const info  = (it.keyword_info as Record<string, unknown>) ?? {}
    const props = (it.keyword_properties as Record<string, unknown>) ?? {}
    const si    = (it.search_intent_info as Record<string, unknown>) ?? {}
    return {
      keyword:            String(it.keyword ?? ''),
      search_volume:      num(info.search_volume),
      keyword_difficulty: num(props.keyword_difficulty),
      cpc:                num(info.cpc),
      competition:        num(info.competition),
      intent:             si.main_intent ? String(si.main_intent) : null,
      monthly_searches:   Array.isArray(info.monthly_searches) ? info.monthly_searches as unknown[] : null,
    }
  }).filter(k => k.keyword)
}

// ── Keyword ideas (discovery) ─────────────────────────────────────────────────

export async function dfsKeywordIdeas(
  seed: string,
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; limit?: number } = {},
): Promise<DfsKeywordData[]> {
  if (!seed.trim()) return []
  const json = await dfsPost('/v3/dataforseo_labs/google/keyword_ideas/live', creds, {
    keywords:      [seed.trim()],
    location_code: opts.locationCode ?? 2840,
    language_code: opts.languageCode ?? 'en',
    limit:         opts.limit ?? 50,
  })
  return firstResultItems(json).map(it => {
    const info  = (it.keyword_info as Record<string, unknown>) ?? {}
    const props = (it.keyword_properties as Record<string, unknown>) ?? {}
    return {
      keyword:            String(it.keyword ?? ''),
      search_volume:      num(info.search_volume),
      keyword_difficulty: num(props.keyword_difficulty),
      cpc:                num(info.cpc),
      competition:        num(info.competition),
      intent:             null,
      monthly_searches:   null,
    }
  }).filter(k => k.keyword)
}

// ── SERP rank check (live/advanced — one call, synchronous) ───────────────────
// For a cost optimisation, this can be switched to task_post/task_get (Standard
// priority) which is ~3.3× cheaper for batch/cron use; kept live here for simplicity
// and correctness while the integration is validated.

function normalizeDomain(input: string): string {
  return input.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
}

export async function dfsSerpRank(
  domain: string,
  keyword: string,
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; device?: SeoDevice; depth?: number } = {},
): Promise<DfsRankResult> {
  const empty: DfsRankResult = { keyword, position: null, rank_absolute: null, url: null, serp_features: [] }
  const target = normalizeDomain(domain)
  if (!target || !keyword.trim()) return empty
  const json = await dfsPost('/v3/serp/google/organic/live/advanced', creds, {
    keyword:       keyword.trim(),
    location_code: opts.locationCode ?? 2840,
    language_code: opts.languageCode ?? 'en',
    device:        opts.device ?? 'desktop',
    depth:         opts.depth ?? 100,
  })
  const items = firstResultItems(json)
  if (!items.length) return empty
  const features = Array.from(new Set(items.map(i => String(i.type ?? '')).filter(t => t && t !== 'organic')))
  // First organic item whose domain/url matches the target.
  const match = items.find(i => {
    if (i.type !== 'organic') return false
    const d = String(i.domain ?? '')
    const u = String(i.url ?? '')
    return normalizeDomain(d || u) === target || u.toLowerCase().includes(target)
  })
  if (!match) return { ...empty, serp_features: features }
  return {
    keyword,
    position:      num(match.rank_group),
    rank_absolute: num(match.rank_absolute),
    url:           match.url ? String(match.url) : null,
    serp_features: features,
  }
}

// ── SERP organic URLs (for competitor-gap research, replacing SerpAPI when connected) ──

export async function dfsSerpTopUrls(
  keyword: string,
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; limit?: number } = {},
): Promise<string[]> {
  if (!keyword.trim()) return []
  const json = await dfsPost('/v3/serp/google/organic/live/advanced', creds, {
    keyword:       keyword.trim(),
    location_code: opts.locationCode ?? 2840,
    language_code: opts.languageCode ?? 'en',
    device:        'desktop',
    depth:         Math.max(10, opts.limit ?? 10),
  }, 12_000)
  return firstResultItems(json)
    .filter(i => i.type === 'organic' && i.url)
    .map(i => String(i.url))
    .filter(u => !u.includes('youtube.com') && !u.includes('wikipedia.org'))
    .slice(0, opts.limit ?? 5)
}

// ── Account balance (free) — used by testConnection ───────────────────────────

export async function dfsAccountBalance(creds: DfsCreds): Promise<number | null> {
  const json = await dfsPost('/v3/appendix/user_data', creds, {}, 8_000)
  const arr = firstResultArray(json)
  const money = (arr[0]?.money as Record<string, unknown>) ?? {}
  return num(money.balance)
}

// ── Connector adapter ─────────────────────────────────────────────────────────
// Like GSC/OpenSEO, rank data is keyword-scoped and synced by a dedicated cron
// (see /api/cron/dataforseo-rankings), not the campaign sync engine — so fetchMetrics
// is a no-op stub.

export const dataForSeoConnector: ConnectorAdapter = {
  type: 'dataforseo',

  refreshAuth: undefined,

  async fetchMetrics(): Promise<SyncResult> {
    return { rows: [] }
  },

  async discoverAccounts(): Promise<DiscoveredAccount[]> {
    return []   // domain-based — the client's domain is entered directly
  },

  async testConnection(auth: Record<string, unknown>): Promise<boolean> {
    const creds = resolveDfsCreds(auth)
    if (!creds) return false
    const balance = await dfsAccountBalance(creds)
    return balance !== null   // a readable balance means the credentials are valid
  },
}
