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

/** GET, for the free list endpoints (locations, languages). Null on any failure, like dfsPost. */
async function dfsGet(path: string, creds: DfsCreds, timeoutMs = 30_000): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method:  'GET',
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
// DataForSEO answers HTTP 200 with a per-task status when the task itself was refused (an
// unknown location, a keyword it will not accept). Silent, unless someone looks.
function firstTaskError(json: Record<string, unknown> | null): string | null {
  const tasks = (json?.tasks as Record<string, unknown>[] | undefined) ?? []
  const code = num(tasks[0]?.status_code)
  return code != null && code !== 20000 ? `${code} ${String(tasks[0]?.status_message ?? '')}`.trim() : null
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

export interface DfsSerpSource { url: string; domain: string; title: string }

/** Everything worth keeping from one SERP page: what Google shows for the search, and to whom. */
export interface DfsSerpSnapshot {
  /** Element types present: ai_overview, featured_snippet, local_pack, people_also_ask, video, … */
  features:        string[]
  organic:         Array<{ domain: string; url: string; title: string; rank: number }>
  /** The map pack — where a service business's real rivals are listed. Domain is often absent. */
  localPack:       Array<{ title: string; domain: string | null; rating: number | null; votes: number | null; rank: number }>
  paa:             string[]                                              // People-Also-Ask questions
  related:         string[]                                              // related_searches strings
  aiOverview:      { present: boolean; sources: DfsSerpSource[] } | null // AI Overview citations (text intentionally omitted — untrusted)
  featuredSnippet: DfsSerpSource | null
}

/** The snapshot plus the organic URLs the competitor-heading scrape reads (avoids a 2nd SERP call). */
export interface DfsSerpIntel extends DfsSerpSnapshot {
  organicUrls: string[]
  /** False when DataForSEO did not answer (timeout, refusal, empty page) — nothing here is a reading. */
  answered:    boolean
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

export function normalizeDomain(input: string): string {
  return input.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
}

// Live single check, billed at live rates. This IS what the rankings cron calls — there is no
// task_post/task_get (Standard queue) code in this repo, whatever older comments claimed.
//
// Returns null when DataForSEO did not answer (HTTP error, timeout, dead credential). That is
// distinct from the empty result for "answered, and the domain is not in the top N": the
// first is not a reading and must not be recorded as one. The cron used to treat both as
// "not ranking", so one rate-limited morning wrote a false drop-out for every keyword touched
// and burned each keyword's one depth-100 baseline read on nothing.
export async function dfsSerpRank(
  domain: string,
  keyword: string,
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; device?: SeoDevice; depth?: number; onCost?: CostSink } = {},
): Promise<DfsRankResult | null> {
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
  if (!json) return null   // no answer — not a reading
  opts.onCost?.(readTopCost(json) || estimateSerpCost(opts.depth ?? 100))
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
/**
 * Domains that rank for everything and compete with nobody.
 *
 * competitors_domain ranks by keyword overlap, and a directory, marketplace or encyclopedia
 * overlaps with every local business in its category — so left alone it routinely returns Yelp
 * ahead of the actual competitor down the road. That matters beyond a tidy list: research then
 * mines 200 keywords from each competitor, and the scorer weights a directory's terms exactly
 * like a real rival's, so one aggregator can swamp the candidate pool with keywords no small
 * business can win.
 *
 * Matched on the registrable domain and any subdomain of it, never as a substring: a client
 * genuinely called "yelpconsulting.com" is not Yelp. Deliberately a small, obvious list rather
 * than an attempt at completeness — a real competitor wrongly excluded is a worse error than an
 * aggregator that slips through, and the list is cheap to extend.
 */
const AGGREGATOR_DOMAINS = new Set([
  // Search, social and video
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'youtube.com',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
  'pinterest.com', 'tiktok.com', 'reddit.com', 'quora.com', 'nextdoor.com',
  // Reference
  'wikipedia.org', 'wikihow.com', 'britannica.com',
  // Directories and review sites
  'yelp.com', 'yellowpages.com', 'bbb.org', 'angi.com', 'angieslist.com',
  'thumbtack.com', 'homeadvisor.com', 'houzz.com', 'porch.com', 'manta.com',
  'mapquest.com', 'foursquare.com', 'trustpilot.com', 'glassdoor.com',
  'tripadvisor.com', 'yellowbook.com', 'superpages.com', 'chamberofcommerce.com',
  // Marketplaces and classifieds
  'amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'craigslist.org',
  'alibaba.com', 'wayfair.com', 'homedepot.com', 'lowes.com',
  // Jobs and listings
  'indeed.com', 'ziprecruiter.com', 'zillow.com', 'realtor.com', 'redfin.com',
])

/** True when `domain` is an aggregator or a subdomain of one. Never a substring match. */
export function isAggregatorDomain(domain: string): boolean {
  const d = normalizeDomain(domain)
  if (!d) return false
  if (AGGREGATOR_DOMAINS.has(d)) return true
  return Array.from(AGGREGATOR_DOMAINS).some(agg => {
    // A subdomain of one: maps.google.com, business.yelp.com.
    if (d.endsWith('.' + agg)) return true
    // A country variant: google.co.uk, amazon.ca, yelp.fr. The trailing dot is what keeps a
    // real business out of it — "lowesplumbing.com" does not start with "lowes.".
    const stem = agg.slice(0, agg.indexOf('.'))
    return stem.length > 3 && d.startsWith(stem + '.')
  })
}

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
      // Ask for more than we will keep. The aggregator filter below runs AFTER the API answers,
      // and for a local trade the top few by keyword overlap are routinely Yelp, Houzz and Angi
      // — so requesting exactly opts.limit let the filter remove every one of them and return
      // nothing. That is what "DataForSEO named no competing domains" was.
      limit:         Math.min(20, Math.max(10, (opts.limit ?? 5) * 4)),
    })
    if (!json) return []
    opts.onCost?.(readTopCost(json) || DFS_LABS_COST_ESTIMATE)
    return firstResultItems(json)
      .map(it => normalizeDomain(String(it.domain ?? it.target ?? '')))
      // A domain does not compete with itself, and aggregators outrank everyone without being
      // a competitor anyone can take business from.
      .filter(d => d && d !== target && !isAggregatorDomain(d))
      .slice(0, opts.limit ?? 5)
  } catch (e) {
    console.warn('[dataforseo] competitors_domain failed:', String(e).slice(0, 180))
    return []
  }
}

/** A domain that ranks for the keywords a business wants, and how strongly. */
export interface DfsSerpCompetitor {
  domain:         string
  keywords_count: number | null
  avg_position:   number | null
  visibility:     number | null
}

/**
 * Who ranks for THESE keywords — competitors defined by the market, not by the client's footprint.
 *
 * competitors_domain answers "who ranks for what this domain already ranks for", which is empty
 * by construction for a new site, and a new site is exactly who needs a competitor list. This
 * asks the other question: given the seed searches (which carry the client's geography), which
 * domains keep appearing in the results. It works on day one and it describes the actual field.
 *
 * Labs endpoint, one task for up to 200 keywords. Organic only — a paid placement is a budget,
 * not a rival. Ordered by DataForSEO's rating (sum of 100 - position over the set), so a site on
 * page one for many of the seeds outranks one on page five for all of them. Aggregators and
 * the client's own domain are dropped here so callers get competitors, not a directory list.
 */
export async function dfsSerpCompetitors(
  keywords: string[],
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; limit?: number; exclude?: string; onCost?: CostSink } = {},
): Promise<DfsSerpCompetitor[]> {
  const kws = Array.from(new Set(keywords.map(k => k.trim()).filter(Boolean))).slice(0, 200)
  if (kws.length === 0) return []
  const self = normalizeDomain(opts.exclude ?? '')
  try {
    const json = await dfsPost('/v3/dataforseo_labs/google/serp_competitors/live', creds, {
      keywords:      kws,
      location_code: opts.locationCode ?? 2840,
      language_code: opts.languageCode ?? 'en',
      item_types:    ['organic'],
      // Over-fetch: aggregators and the client itself are removed after the answer arrives.
      limit:         Math.min(100, Math.max(20, (opts.limit ?? 10) * 3)),
      order_by:      ['rating,desc'],
    })
    if (!json) return []
    opts.onCost?.(readTopCost(json) || DFS_LABS_COST_ESTIMATE)
    return firstResultItems(json)
      .map(it => ({
        domain:         normalizeDomain(String(it.domain ?? '')),
        keywords_count: num(it.keywords_count),
        avg_position:   num(it.avg_position),
        visibility:     num(it.visibility),
      }))
      .filter(c => c.domain && c.domain !== self && !isAggregatorDomain(c.domain))
      .slice(0, opts.limit ?? 10)
  } catch (e) {
    console.warn('[dataforseo] serp_competitors failed:', String(e).slice(0, 180))
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

/**
 * Keywords that CONTAIN the seed phrase — the long tail of one specific search.
 *
 * keyword_ideas expands by category and orders by volume, so a seed like "landscape lighting
 * los angeles" contributes its category (Lighting) and loses its city: the local phrases are
 * low-volume and never reach the top of the list. keyword_suggestions is the other tool —
 * every result contains the seed verbatim, so "landscape lighting los angeles" returns
 * "landscape lighting los angeles ca", "landscape lighting installation los angeles" and the
 * rest of what people in that city actually type. One Labs task per seed, single keyword only.
 */
export async function dfsKeywordSuggestions(
  seed: string,
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; limit?: number; onCost?: CostSink } = {},
): Promise<DfsKeywordCandidate[]> {
  const keyword = seed.trim()
  if (!keyword) return []
  try {
    const json = await dfsPost('/v3/dataforseo_labs/google/keyword_suggestions/live', creds, {
      keyword,
      location_code: opts.locationCode ?? 2840,
      language_code: opts.languageCode ?? 'en',
      limit:         Math.min(1000, Math.max(1, opts.limit ?? 100)),
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
    console.warn('[dataforseo] keyword_suggestions failed:', String(e).slice(0, 180))
    return []
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

/** One SERP page's items, read defensively — a shape change must cost a field, never the caller. */
function parseSerp(items: Record<string, unknown>[]): DfsSerpSnapshot {
  const features = Array.from(new Set(items.map(i => String(i.type ?? '')).filter(t => t && t !== 'organic')))

  const organic = items
    .filter(i => i.type === 'organic')
    .map(i => ({
      domain: normalizeDomain(String(i.domain ?? '') || String(i.url ?? '')),
      url:    String(i.url ?? ''),
      title:  String(i.title ?? ''),
      rank:   num(i.rank_group) ?? 999,
    }))
    .filter(o => o.domain)

  // One local_pack item per business.
  const localPack = items
    .filter(i => i.type === 'local_pack')
    .map(i => {
      const rating = (i.rating as Record<string, unknown> | null) ?? null
      const dom = i.domain ? normalizeDomain(String(i.domain)) : i.url ? normalizeDomain(String(i.url)) : ''
      return {
        title:  String(i.title ?? ''),
        domain: dom || null,
        rating: num(rating?.value),
        votes:  num(rating?.votes_count),
        rank:   num(i.rank_group) ?? 999,
      }
    })
    .filter(p => p.title)

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
  let aiOverview: DfsSerpSnapshot['aiOverview'] = null
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

  return { features, organic, localPack, paa, related, aiOverview, featuredSnippet }
}

export async function dfsSerpIntel(
  keyword: string,
  creds: DfsCreds,
  opts: { locationCode?: number; languageCode?: string; limit?: number; aiOverview?: boolean; onCost?: CostSink; timeoutMs?: number } = {},
): Promise<DfsSerpIntel> {
  const empty: DfsSerpIntel = { features: [], organic: [], localPack: [], paa: [], related: [], aiOverview: null, featuredSnippet: null, organicUrls: [], answered: false }
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
  const refused = firstTaskError(json)
  // A refused task is not billed by DataForSEO and must not be billed by the ledger either.
  if (refused) { console.warn(`[dataforseo] serp intel refused for "${keyword}": ${refused}`); return empty }
  if (json) opts.onCost?.(readTopCost(json) || estimateSerpCost(depth) + 0.002)
  const items = firstResultItems(json)
  if (!items.length) return empty
  const snap = parseSerp(items)
  // Asked for and absent is a fact worth keeping ("no AI answer"); not asked for is not.
  if ((opts.aiOverview ?? true) && !snap.aiOverview) snap.aiOverview = { present: false, sources: [] }
  // Reused for the competitor-heading scrape, so the reference sites are left out of it.
  const organicUrls = snap.organic
    .map(o => o.url)
    .filter(u => u && !u.includes('youtube.com') && !u.includes('wikipedia.org'))
    .slice(0, opts.limit ?? 5)
  return { ...snap, organicUrls, answered: true }
}

// ── Locality ──────────────────────────────────────────────────────────────────
//
// Everything in the Labs section above is COUNTRY-level by design: the Labs locations list has
// exactly one location_type, "Country", and DataForSEO's help centre says city databases would be
// too expensive to maintain. So a Labs volume is the national figure and a Labs competitor is
// whoever ranks nationally — for a lighting installer in one county, that is Amazon and Govee.
//
// Two other APIs take a city, county or state, using the same Google geo-target codes:
//
//   Google Ads search volume   keywords_data/google_ads/search_volume/live   $0.09 per task, up to 1,000 keywords
//   Live SERP                  serp/google/organic/live/advanced             $0.002 per 10 results
//   Locations list             keywords_data/google_ads/locations            free
//
// The helpers below put a local layer on top of the Labs pool: what the client's own market
// searches for, and who a searcher there actually sees.

/** A Google geo target as DataForSEO lists it. The code is valid for SERP and Google Ads calls alike. */
export interface DfsLocation {
  code:    number
  /** As DataForSEO prints it: "Los Angeles County,California,United States". */
  name:    string
  /** City, County, State, Municipality, Region. */
  type:    string
  parent:  number | null
  country: string
}

/** What content_settings.research_location holds. Null = country-level, the default. */
export interface ResearchLocation { code: number; name: string; type: string }

/** The stored value, or nothing: never trust a JSON column's shape. */
export function readResearchLocation(v: unknown): ResearchLocation | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const code = Number(o.code)
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!Number.isFinite(code) || code <= 0 || !name) return null
  return { code: Math.round(code), name, type: typeof o.type === 'string' ? o.type : '' }
}

/** The kinds a service area is described in. Neighbourhoods and postal codes are below what Google Ads reports volume for. */
const PICKABLE_LOCATION_TYPES = new Set(['City', 'County', 'State', 'Municipality', 'Region', 'Province', 'Territory'])

// ~100k rows for every country; fetched once per process and kept for a day.
let locationCache: { at: number; rows: DfsLocation[] } | null = null
const LOCATION_CACHE_MS = 24 * 3_600_000

async function loadLocations(creds: DfsCreds): Promise<DfsLocation[]> {
  if (locationCache && Date.now() - locationCache.at < LOCATION_CACHE_MS) return locationCache.rows
  const json = await dfsGet('/v3/keywords_data/google_ads/locations', creds, 60_000)
  const rows = firstResultArray(json)
    .map(r => ({
      code:    num(r.location_code) ?? 0,
      name:    String(r.location_name ?? ''),
      type:    String(r.location_type ?? ''),
      parent:  num(r.location_code_parent),
      country: String(r.country_iso_code ?? ''),
    }))
    .filter(l => l.code > 0 && l.name && PICKABLE_LOCATION_TYPES.has(l.type))
  if (rows.length) locationCache = { at: Date.now(), rows }
  return rows
}

/**
 * Locations whose own name matches `q`: exact first, then prefix, then contains; cities before
 * counties before states; the agency's home market (US, then CA) before the rest. Free.
 */
export async function dfsSearchLocations(
  q: string,
  creds: DfsCreds,
  opts: { limit?: number } = {},
): Promise<DfsLocation[]> {
  const needle = q.trim().toLowerCase()
  if (needle.length < 2) return []
  const rows = await loadLocations(creds)
  const TYPE_RANK: Record<string, number>    = { City: 0, County: 1, Municipality: 2, State: 3, Province: 3, Region: 4, Territory: 4 }
  const COUNTRY_RANK: Record<string, number> = { US: 0, CA: 1 }
  const hits: Array<{ l: DfsLocation; rank: number }> = []
  for (const l of rows) {
    const head = l.name.split(',')[0].toLowerCase()
    const rank = head === needle ? 0 : head.startsWith(needle) ? 1 : head.includes(needle) ? 2 : -1
    if (rank >= 0) hits.push({ l, rank })
  }
  hits.sort((a, b) =>
    a.rank - b.rank
    || (COUNTRY_RANK[a.l.country] ?? 9) - (COUNTRY_RANK[b.l.country] ?? 9)
    || (TYPE_RANK[a.l.type] ?? 9) - (TYPE_RANK[b.l.type] ?? 9)
    || a.l.name.length - b.l.name.length)
  return hits.slice(0, opts.limit ?? 12).map(h => h.l)
}

export interface DfsLocalVolume { search_volume: number | null; cpc: number | null; competition_index: number | null }
const DFS_GOOGLE_ADS_TASK_COST = 0.09

/**
 * Google Ads search volume for `keywords` in one location. One task, one flat price whatever the
 * count (up to 1,000). Keyed by the keyword lower-cased with single spaces. A null volume means
 * Google's bucket for that phrase in that place is too small to report — not zero demand.
 */
export async function dfsLocalSearchVolume(
  keywords: string[],
  creds: DfsCreds,
  opts: { locationCode: number; languageCode?: string; onCost?: CostSink },
): Promise<Map<string, DfsLocalVolume>> {
  const out = new Map<string, DfsLocalVolume>()
  const list = Array.from(new Set(
    keywords.map(k => k.trim()).filter(k => k && k.length <= 80 && k.split(/\s+/).length <= 10),
  )).slice(0, 1000)
  if (!list.length) return out
  const json = await dfsPost('/v3/keywords_data/google_ads/search_volume/live', creds, {
    keywords:        list,
    location_code:   opts.locationCode,
    language_code:   opts.languageCode ?? 'en',
    search_partners: false,
  }, 60_000)
  if (!json) return out
  const err = firstTaskError(json)
  if (err) { console.warn(`[dataforseo] google_ads search_volume refused: ${err}`); return out }
  opts.onCost?.(readTopCost(json) || DFS_GOOGLE_ADS_TASK_COST)
  for (const r of firstResultArray(json)) {
    const kw = String(r.keyword ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
    if (!kw) continue
    out.set(kw, { search_volume: num(r.search_volume), cpc: num(r.cpc), competition_index: num(r.competition_index) })
  }
  return out
}


/**
 * One live SERP as a searcher in `locationCode` sees it: organic results, the local pack, and
 * the talking points (People-Also-Ask, related searches, AI Overview sources).
 * depth 20 is two pages, $0.004. Null when DataForSEO did not answer.
 */
export async function dfsLocalSerp(
  keyword: string,
  creds: DfsCreds,
  opts: { locationCode: number; languageCode?: string; depth?: number; device?: SeoDevice; onCost?: CostSink },
): Promise<DfsSerpSnapshot | null> {
  if (!keyword.trim()) return null
  const depth = opts.depth ?? 20
  const json = await dfsPost('/v3/serp/google/organic/live/advanced', creds, {
    keyword:       keyword.trim(),
    location_code: opts.locationCode,
    language_code: opts.languageCode ?? 'en',
    device:        opts.device ?? 'desktop',
    depth,
  })
  if (!json) return null
  const err = firstTaskError(json)
  // A refused task is not billed by DataForSEO and must not be billed by the ledger either.
  if (err) { console.warn(`[dataforseo] local SERP refused for "${keyword}": ${err}`); return null }
  opts.onCost?.(readTopCost(json) || estimateSerpCost(depth))
  const items = firstResultItems(json)
  return items.length ? parseSerp(items) : null
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
