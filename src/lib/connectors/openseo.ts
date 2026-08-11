// ─────────────────────────────────────────────────────────────────────────────
// OpenSEO connector — keyword research & SERP rank tracking (pay-as-you-go)
//
// Agency-level, API-key auth (exactly like Ahrefs):
//   Auth:   API key stored in connector.auth.api_key
//           Header: Authorization: Bearer {api_key}
//   Target: the client's domain, stored as external_id on client_connections
//           e.g. "example.com"
//
// STATUS: BAREBONES / SCAFFOLDING. OpenSEO is not yet contracted, so the exact
// request/response shapes below are provisional and every network call fails
// SOFT (returns [] / false, never throws). The point of shipping this now is that
// the rest of the system — topic generation, the rank-sync path, the Analytics tab,
// and the SEO score surfacing — can already call these typed functions. When the
// API key is added and the endpoints are confirmed against OpenSEO's docs, only the
// two fetch bodies (openSeoKeywordSearch / openSeoRankCheck) and BASE_URL need
// updating; no caller changes. Everything "carries over".
//
// Cost model (per openseo.so/pricing, for future budgeting):
//   ~$10/mo base · ~$0.05 / keyword search · ~$0.0025 / rank check ·
//   ~$0.08 / backlink lookup · ~$1.09 / ChatGPT brand check
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

// Provisional — confirm against OpenSEO API docs when the connector goes live.
const BASE_URL = 'https://api.openseo.so/v1'

// ── Shared shapes (stable — the datastream is modelled on these) ─────────────

/** A keyword-research result: one enriched keyword idea. */
export interface OpenSeoKeywordResult {
  keyword:            string
  search_volume:      number | null
  keyword_difficulty: number | null   // 0–100
  cpc:                number | null    // USD
  intent:             string | null    // informational | commercial | transactional | navigational
}

/** A rank-check result: where a domain currently sits for a keyword. */
export interface OpenSeoRankResult {
  keyword:        string
  position:       number | null        // null = not found in the checked window (top 100)
  url:            string | null        // the ranking URL on the target domain
  search_volume:  number | null
  serp_features?: Record<string, unknown>  // featured snippet / PAA / local pack, when available
}

function normalizeDomain(input: string): string {
  return input.trim().replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase()
}

// ── API client (soft-failing) ────────────────────────────────────────────────

/**
 * Keyword research for a seed term. Returns enriched keyword ideas (volume,
 * difficulty, cpc, intent). Soft-fails to [] on any error or when no API key.
 *
 * NOTE: request/response mapping is provisional pending OpenSEO API confirmation.
 */
export async function openSeoKeywordSearch(
  seed: string,
  apiKey: string,
  opts: { country?: string; limit?: number } = {},
): Promise<OpenSeoKeywordResult[]> {
  if (!apiKey || !seed.trim()) return []
  try {
    const url = new URL(`${BASE_URL}/keywords/search`)
    url.searchParams.set('q', seed.trim())
    url.searchParams.set('country', opts.country ?? 'us')
    url.searchParams.set('limit', String(opts.limit ?? 25))
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data = await res.json() as { keywords?: unknown[]; results?: unknown[] }
    const items = (data.keywords ?? data.results ?? []) as Record<string, unknown>[]
    if (!Array.isArray(items)) return []
    return items.map(k => ({
      keyword:            String(k.keyword ?? k.term ?? ''),
      search_volume:      numOrNull(k.search_volume ?? k.volume),
      keyword_difficulty: numOrNull(k.keyword_difficulty ?? k.difficulty),
      cpc:                numOrNull(k.cpc),
      intent:             k.intent ? String(k.intent) : null,
    })).filter(k => k.keyword)
  } catch (e) {
    console.error('[openseo] keyword search failed:', e)
    return []
  }
}

/**
 * Rank check: where does `domain` currently rank for each keyword?
 * Soft-fails to [] on any error or when no API key.
 *
 * NOTE: request/response mapping is provisional pending OpenSEO API confirmation.
 */
export async function openSeoRankCheck(
  domain: string,
  keywords: string[],
  apiKey: string,
  opts: { country?: string } = {},
): Promise<OpenSeoRankResult[]> {
  if (!apiKey || keywords.length === 0) return []
  const target = normalizeDomain(domain)
  if (!target) return []
  try {
    const res = await fetch(`${BASE_URL}/rankings/check`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: target, keywords, country: opts.country ?? 'us' }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return []
    const data = await res.json() as { rankings?: unknown[]; results?: unknown[] }
    const items = (data.rankings ?? data.results ?? []) as Record<string, unknown>[]
    if (!Array.isArray(items)) return []
    return items.map(r => ({
      keyword:       String(r.keyword ?? ''),
      position:      numOrNull(r.position ?? r.rank),
      url:           r.url ? String(r.url) : null,
      search_volume: numOrNull(r.search_volume ?? r.volume),
      serp_features: (r.serp_features as Record<string, unknown>) ?? undefined,
    })).filter(r => r.keyword)
  } catch (e) {
    console.error('[openseo] rank check failed:', e)
    return []
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null
}

// ── Connector adapter ─────────────────────────────────────────────────────────
//
// Like GSC, OpenSEO's metric syncing does NOT flow through fetchMetrics — rank
// snapshots are keyword-scoped, not campaign-scoped, so they are written by a
// dedicated rank-sync path into seo_rankings (see lib/content/seoRankings.ts).
// fetchMetrics is a no-op stub so the connector satisfies the registry.

export const openSeoConnector: ConnectorAdapter = {
  type: 'openseo',

  refreshAuth: undefined,

  async fetchMetrics(): Promise<SyncResult> {
    // Rank data is synced via the keyword-scoped path, not the campaign sync engine.
    return { rows: [] }
  },

  async discoverAccounts(): Promise<DiscoveredAccount[]> {
    // Domain-based connector — the client's domain is entered directly, no discovery.
    return []
  },

  async testConnection(auth: Record<string, unknown>): Promise<boolean> {
    const apiKey = String(auth.api_key || '')
    if (!apiKey) return false
    try {
      // Lightweight authenticated probe. Endpoint provisional; treat a 2xx/401-free
      // response as "key accepted". Confirm against OpenSEO docs when going live.
      const res = await fetch(`${BASE_URL}/account`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal:  AbortSignal.timeout(8_000),
      })
      return res.ok
    } catch {
      return false
    }
  },
}
