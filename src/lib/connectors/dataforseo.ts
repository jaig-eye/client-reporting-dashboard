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

const DEFAULT_SEO_CONFIG: SeoTrackingConfig = {
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

/** Same as dfsPost but sends the array as given — the task queue accepts up to 100 at a time. */
async function dfsPostMany(path: string, creds: DfsCreds, tasks: Record<string, unknown>[], timeoutMs = 60_000): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method:  'POST',
      headers: { Authorization: basicAuthHeader(creds), 'Content-Type': 'application/json' },
      body:    JSON.stringify(tasks),
      signal:  AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) { console.error(`[dataforseo] ${path} HTTP ${res.status}`); return null }
    return await res.json() as Record<string, unknown>
  } catch (e) {
    console.error(`[dataforseo] ${path} failed:`, e)
    return null
  }
}

/** GET for the task queue's collect half. */
async function dfsGet(path: string, creds: DfsCreds, timeoutMs = 30_000): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: basicAuthHeader(creds) },
      signal:  AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) { console.error(`[dataforseo] ${path} HTTP ${res.status}`); return null }
    return await res.json() as Record<string, unknown>
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

// DataForSEO returns the REAL cost of each request in the top-level `cost` field.
// Read it; fall back to a per-operation estimate when absent so metering still works.
export type CostSink = (cost: number) => void
function readTopCost(json: Record<string, unknown> | null): number {
  const c = json?.cost
  return typeof c === 'number' && c > 0 ? c : 0
}
/** Estimated live/advanced SERP cost (priced per 10 results) when the response omits cost. */
function estimateSerpCost(depth: number): number {
  return Math.max(1, Math.ceil((depth || 100) / 10)) * 0.002
}
const DFS_LABS_COST_ESTIMATE = 0.01

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

interface DfsSerpSource { url: string; domain: string; title: string }
export interface DfsSerpIntel {
  paa:             string[]                                              // People-Also-Ask questions
  related:         string[]                                             // related_searches strings
  aiOverview:      { present: boolean; sources: DfsSerpSource[] } | null // AI Overview citations (text intentionally omitted — untrusted)
  featuredSnippet: DfsSerpSource | null
  organicUrls:     string[]                                             // reused for competitor-heading scrape (avoids a 2nd SERP call)
  features:        string[]                                            // element types present (ai_overview, featured_snippet, …)
}

// ── Keyword overview (volume + difficulty + intent in one Labs call) ──────────

export async function dfsKeywordOverview(
  keywords: string[],
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; onCost?: CostSink } = {},
): Promise<DfsKeywordData[]> {
  const kws = keywords.map(k => k.trim()).filter(Boolean).slice(0, 700)
  if (!kws.length) return []
  const json = await dfsPost('/v3/dataforseo_labs/google/keyword_overview/live', creds, {
    keywords:      kws,
    location_code: opts.locationCode ?? 2840,
    language_code: opts.languageCode ?? 'en',
  })
  if (json) opts.onCost?.(readTopCost(json) || DFS_LABS_COST_ESTIMATE)
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

// ── SERP rank check (live/advanced — one call, synchronous) ───────────────────
// For a cost optimisation, this can be switched to task_post/task_get (Standard
// priority) which is ~3.3× cheaper for batch/cron use; kept live here for simplicity
// and correctness while the integration is validated.

function normalizeDomain(input: string): string {
  return input.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
}

// Live single check. The rankings cron uses the Standard queue instead (3.3x cheaper for the
// same data), so this is kept for on-demand use — a "check this keyword now" action, where a
// person is waiting and one synchronous call is worth the premium.
export async function dfsSerpRank(
  domain: string,
  keyword: string,
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; device?: SeoDevice; depth?: number; onCost?: CostSink } = {},
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
  if (json) opts.onCost?.(readTopCost(json) || estimateSerpCost(opts.depth ?? 100))
  const items = firstResultItems(json)
  if (!items.length) return empty
  const features = Array.from(new Set(items.map(i => String(i.type ?? '')).filter(t => t && t !== 'organic')))
  // First organic item whose HOST is the target or a subdomain of it. Must be a host-
  // boundary match — a raw substring test would let "supercars.com" match target "cars.com".
  const match = items.find(i => {
    if (i.type !== 'organic') return false
    const host = normalizeDomain(String(i.domain ?? '') || String(i.url ?? ''))
    return host === target || host.endsWith('.' + target)
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

// ── Keyword discovery (DataForSEO Labs) ──────────────────────────────────────
//
// Response shapes below are read defensively — every field is optional and coerced — because a
// Labs payload that changes shape must cost a discovery run, never the caller.

/** A discovered keyword candidate, before anyone decides whether it is worth tracking. */
export interface DfsKeywordCandidate {
  keyword:            string
  search_volume:      number | null
  keyword_difficulty: number | null
  cpc:                number | null
  competition:        number | null
  intent:             string | null
  /** Where this came from, so the pool can be weighted and audited. */
  source:             'site' | 'competitor' | 'idea'
  /** Our current position for it, when the source knows. Null means not ranking or not asked. */
  position:           number | null
  /** Only set for 'competitor': the domain that ranks for it. */
  competitor_domain:  string | null
}

/** Pull the common metric block out of a Labs item, wherever the endpoint happens to nest it. */
function readKeywordMetrics(it: Record<string, unknown>) {
  const data  = (it.keyword_data as Record<string, unknown>) ?? it
  const info  = (data.keyword_info as Record<string, unknown>) ?? {}
  const props = (data.keyword_properties as Record<string, unknown>) ?? {}
  const si    = (data.search_intent_info as Record<string, unknown>) ?? {}
  return {
    keyword:            String(data.keyword ?? it.keyword ?? ''),
    search_volume:      num(info.search_volume),
    keyword_difficulty: num(props.keyword_difficulty),
    cpc:                num(info.cpc),
    competition:        num(info.competition),
    intent:             si.main_intent ? String(si.main_intent) : null,
  }
}

/** Rank of the first SERP element in a ranked-keywords item, when present. */
function readSerpPosition(it: Record<string, unknown>): number | null {
  const serp  = (it.ranked_serp_element as Record<string, unknown>) ?? {}
  const el    = (serp.serp_item as Record<string, unknown>) ?? {}
  return num(el.rank_group) ?? num(el.rank_absolute)
}

/**
 * Everything a domain already ranks for.
 *
 * For the client's own domain this is the inventory GSC only partially sees; for a competitor's
 * it is the gap, once our own keywords are subtracted.
 */
export async function dfsKeywordsForSite(
  domain: string,
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; limit?: number; source?: 'site' | 'competitor'; onCost?: CostSink } = {},
): Promise<DfsKeywordCandidate[]> {
  const target = normalizeDomain(domain)
  if (!target) return []
  try {
    const json = await dfsPost('/v3/dataforseo_labs/google/ranked_keywords/live', creds, {
      target,
      location_code: opts.locationCode ?? 2840,
      language_code: opts.languageCode ?? 'en',
      limit:         Math.min(1000, Math.max(1, opts.limit ?? 300)),
      // Ignore the long tail nobody would write for.
      filters:       [['keyword_data.keyword_info.search_volume', '>', 10]],
      order_by:      ['keyword_data.keyword_info.search_volume,desc'],
    })
    if (!json) return []
    opts.onCost?.(readTopCost(json) || DFS_LABS_COST_ESTIMATE)
    const src = opts.source ?? 'site'
    return firstResultItems(json).map(it => ({
      ...readKeywordMetrics(it),
      source:            src,
      position:          readSerpPosition(it),
      competitor_domain: src === 'competitor' ? target : null,
    })).filter(k => k.keyword)
  } catch (e) {
    console.warn('[dataforseo] ranked_keywords failed:', String(e).slice(0, 180))
    return []
  }
}

/** Domains competing for the same keywords, so the gap can be found without anyone listing them. */
export async function dfsCompetitorDomains(
  domain: string,
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; limit?: number; onCost?: CostSink } = {},
): Promise<string[]> {
  const target = normalizeDomain(domain)
  if (!target) return []
  try {
    const json = await dfsPost('/v3/dataforseo_labs/google/competitors_domain/live', creds, {
      target,
      location_code: opts.locationCode ?? 2840,
      language_code: opts.languageCode ?? 'en',
      limit:         Math.min(20, Math.max(1, opts.limit ?? 5)),
    })
    if (!json) return []
    opts.onCost?.(readTopCost(json) || DFS_LABS_COST_ESTIMATE)
    return firstResultItems(json)
      .map(it => normalizeDomain(String(it.domain ?? it.target ?? '')))
      // A domain does not compete with itself, and aggregators outrank everyone without being
      // a competitor anyone can take business from.
      .filter(d => d && d !== target)
      .slice(0, opts.limit ?? 5)
  } catch (e) {
    console.warn('[dataforseo] competitors_domain failed:', String(e).slice(0, 180))
    return []
  }
}

/**
 * Expansions around what the client actually sells.
 *
 * The seeds come from Brand DNA — services and geography — so a client who ranks for nothing yet
 * still produces a list shaped like their business rather than a generic one.
 */
export async function dfsKeywordIdeas(
  seeds: string[],
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; limit?: number; onCost?: CostSink } = {},
): Promise<DfsKeywordCandidate[]> {
  const kws = seeds.map(k => k.trim()).filter(Boolean).slice(0, 200)
  if (!kws.length) return []
  try {
    const json = await dfsPost('/v3/dataforseo_labs/google/keyword_ideas/live', creds, {
      keywords:      kws,
      location_code: opts.locationCode ?? 2840,
      language_code: opts.languageCode ?? 'en',
      limit:         Math.min(1000, Math.max(1, opts.limit ?? 300)),
      filters:       [['keyword_info.search_volume', '>', 10]],
      order_by:      ['keyword_info.search_volume,desc'],
    })
    if (!json) return []
    opts.onCost?.(readTopCost(json) || DFS_LABS_COST_ESTIMATE)
    return firstResultItems(json).map(it => ({
      ...readKeywordMetrics(it),
      source:            'idea' as const,
      position:          null,
      competitor_domain: null,
    })).filter(k => k.keyword)
  } catch (e) {
    console.warn('[dataforseo] keyword_ideas failed:', String(e).slice(0, 180))
    return []
  }
}

// ── SERP rank check, Standard priority (submit now, collect later) ───────────
//
// Same data as live/advanced at roughly a third of the price, in exchange for a queue. The two
// halves are deliberately separate calls so a submit and a collect can happen on different days.

/** Cost of one Standard SERP task, priced per 10 results. */
function estimateStandardSerpCost(depth: number): number {
  return Math.max(1, Math.ceil((depth || 100) / 10)) * 0.0006
}

export interface DfsTaskRequest {
  keyword:       string
  locationCode:  number
  languageCode:  string
  device:        SeoDevice
  depth:         number
  /** Echoed back by DataForSEO on the finished task, so a result can be matched to its row. */
  tag:           string
}

/**
 * Queues rank checks. Returns the task id for each request that was accepted, keyed by tag.
 *
 * Up to 100 tasks per call is DataForSEO's documented limit; callers are expected to chunk.
 * Soft-fails to an empty map, so a queue outage costs a day of freshness rather than the run.
 */
export async function dfsSerpRankSubmit(
  requests: DfsTaskRequest[],
  creds: DfsCreds,
  opts: { onCost?: CostSink } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (requests.length === 0) return out
  try {
    const json = await dfsPostMany('/v3/serp/google/organic/task_post', creds,
      requests.map(r => ({
        keyword:       r.keyword.trim(),
        location_code: r.locationCode,
        language_code: r.languageCode,
        device:        r.device,
        depth:         r.depth,
        priority:      1,          // 1 = Standard queue. 2 would be the priced-up lane.
        tag:           r.tag,
      })))
    if (!json) return out
    opts.onCost?.(readTopCost(json) || requests.reduce((sum, r) => sum + estimateStandardSerpCost(r.depth), 0))
    const tasks = Array.isArray((json as Record<string, unknown>).tasks)
      ? ((json as Record<string, unknown>).tasks as Record<string, unknown>[])
      : []
    for (const t of tasks) {
      // 20000 is DataForSEO's success code; anything else is a rejected task and belongs in the
      // log rather than in the pending table waiting for a result that will never arrive.
      const code = Number(t.status_code ?? 0)
      const id   = t.id ? String(t.id) : ''
      const data = (t.data ?? {}) as Record<string, unknown>
      const tag  = data.tag ? String(data.tag) : ''
      if (code === 20000 && id && tag) out.set(tag, id)
      else console.warn('[dataforseo] task_post rejected:', code, String(t.status_message ?? '').slice(0, 120))
    }
  } catch (e) {
    console.warn('[dataforseo] task_post failed:', String(e).slice(0, 200))
  }
  return out
}

/**
 * Collects one finished task. Returns null while it is still queued, so the caller can leave the
 * row pending and try again next run.
 */
export async function dfsSerpRankCollect(
  taskId: string,
  domain: string,
  keyword: string,
  creds: DfsCreds,
): Promise<DfsRankResult | null> {
  const target = normalizeDomain(domain)
  if (!taskId || !target) return null
  try {
    const json = await dfsGet(`/v3/serp/google/organic/task_get/advanced/${encodeURIComponent(taskId)}`, creds)
    if (!json) return null
    const tasks = Array.isArray((json as Record<string, unknown>).tasks)
      ? ((json as Record<string, unknown>).tasks as Record<string, unknown>[])
      : []
    const task = tasks[0]
    if (!task) return null
    const code = Number(task.status_code ?? 0)
    // 40602 is "task in queue" — not an error, just not ready. Anything else in the 4xx/5xx range
    // is terminal, and the caller should stop waiting for it.
    if (code === 40602) return null
    if (code !== 20000) {
      console.warn('[dataforseo] task_get terminal error:', code, String(task.status_message ?? '').slice(0, 120))
      return { keyword, position: null, rank_absolute: null, url: null, serp_features: [] }
    }
    const items = firstResultItems(json)
    const features = Array.from(new Set(items.map(i => String(i.type ?? '')).filter(t => t && t !== 'organic')))
    const match = items.find(i => {
      if (i.type !== 'organic') return false
      const host = normalizeDomain(String(i.domain ?? '') || String(i.url ?? ''))
      return host === target || host.endsWith('.' + target)
    })
    if (!match) return { keyword, position: null, rank_absolute: null, url: null, serp_features: features }
    return {
      keyword,
      position:      num(match.rank_group),
      rank_absolute: num(match.rank_absolute),
      url:           match.url ? String(match.url) : null,
      serp_features: features,
    }
  } catch (e) {
    console.warn('[dataforseo] task_get failed:', String(e).slice(0, 200))
    return null
  }
}

// ── SERP intelligence (one call → PAA + AI-Overview sources + related + organic) ──
// The creation engine's data source: what real questions searchers ask (PAA) and which
// pages Google's AI Overview cites. `load_async_ai_overview` surfaces the AIO element
// (a small surcharge, refunded when it doesn't fire). Soft-fails to an empty shape.

function toSource(r: Record<string, unknown>): DfsSerpSource | null {
  const url = r.url ? String(r.url) : ''
  if (!url) return null
  return { url, domain: r.domain ? String(r.domain) : normalizeDomain(url), title: String(r.title ?? '') }
}

// Nested DataForSEO arrays (item.items, item.references) may be absent or non-array;
// coerce defensively so extraction can't throw.
function asArr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : []
}

export async function dfsSerpIntel(
  keyword: string,
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; limit?: number; aiOverview?: boolean; onCost?: CostSink; timeoutMs?: number } = {},
): Promise<DfsSerpIntel> {
  const empty: DfsSerpIntel = { paa: [], related: [], aiOverview: null, featuredSnippet: null, organicUrls: [], features: [] }
  if (!keyword.trim()) return empty
  const depth = Math.max(10, opts.limit ?? 10)
  // timeoutMs lets a synchronous caller bound the call so its result is USED (not raced-and-
  // discarded by an outer deadline while the request still completes and bills). On timeout
  // dfsPost returns null → onCost never fires → no wasted spend.
  const json = await dfsPost('/v3/serp/google/organic/live/advanced', creds, {
    keyword:                keyword.trim(),
    location_code:          opts.locationCode ?? 2840,
    language_code:          opts.languageCode ?? 'en',
    device:                 'desktop',
    depth,
    load_async_ai_overview: opts.aiOverview ?? true,
  }, opts.timeoutMs ?? 15_000)
  if (json) opts.onCost?.(readTopCost(json) || estimateSerpCost(depth) + 0.002)
  const items = firstResultItems(json)
  if (!items.length) return empty

  const features = Array.from(new Set(items.map(i => String(i.type ?? '')).filter(t => t && t !== 'organic')))

  // People Also Ask → nested items[].title
  const paa = items
    .filter(i => i.type === 'people_also_ask')
    .flatMap(i => asArr(i.items).map(q => String(q.title ?? '')))
    .filter(Boolean).slice(0, 12)

  // related_searches → nested items[] (plain strings)
  const related = items
    .filter(i => i.type === 'related_searches')
    .flatMap(i => (Array.isArray(i.items) ? i.items : []).map(String))
    .filter(Boolean).slice(0, 12)

  // AI Overview → cited source references (text intentionally NOT extracted — untrusted prose)
  let aiOverview: DfsSerpIntel['aiOverview'] = null
  const ao = items.find(i => i.type === 'ai_overview')
  if (ao) {
    const refs = asArr(ao.references).length
      ? asArr(ao.references)
      : asArr(ao.items).flatMap(it => asArr(it.references))
    const sources = refs.map(toSource).filter((s): s is DfsSerpSource => !!s).slice(0, 8)
    aiOverview = { present: true, sources }
  }

  const fs = items.find(i => i.type === 'featured_snippet')
  const featuredSnippet = fs ? toSource(fs) : null

  const organicUrls = items
    .filter(i => i.type === 'organic' && i.url)
    .map(i => String(i.url))
    .filter(u => !u.includes('youtube.com') && !u.includes('wikipedia.org'))
    .slice(0, opts.limit ?? 5)

  return { paa, related, aiOverview, featuredSnippet, organicUrls, features }
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
