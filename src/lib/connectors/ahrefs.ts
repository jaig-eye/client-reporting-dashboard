// ─────────────────────────────────────────────────────────────────────────────
// Ahrefs SEO Authority Connector
//
// Uses the Ahrefs API v3.
// Auth: API key stored in connector.auth.api_key
//       Header: Authorization: Bearer {api_key}
//
// The target domain is stored as external_id on client_connections.
// e.g. "example.com"
//
// Ahrefs DR / backlink data is not truly daily — it updates weekly.
// fetchMetrics stores one snapshot row per sync with date = dateTo.
//
// API endpoints used:
//   GET /v3/site-explorer/domain-rating?target={domain}&date={YYYY-MM-DD}
//   GET /v3/site-explorer/metrics?target={domain}&date_from={}&date_to={}&select=...
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const BASE_URL = 'https://api.ahrefs.com/v3'

interface AhrefsRawRow {
  date:              string
  domain_rating:     number | null
  ahrefs_rank:       number | null
  backlinks:         number | null
  referring_domains: number | null
  organic_keywords:  number | null
  organic_traffic:   number | null
}

async function ahrefsGet(
  path: string,
  apiKey: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ahrefs API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

export const ahrefsConnector: ConnectorAdapter = {
  type: 'ahrefs',

  refreshAuth: undefined,

  async fetchMetrics(
    externalId: string,   // target domain e.g. "example.com"
    auth: Record<string, unknown>,
    _config: Record<string, unknown>,
    dateFrom: string,
    dateTo: string
  ): Promise<SyncResult> {
    const apiKey = String(auth.api_key || '')
    if (!apiKey) return { rows: [] }

    const domain = externalId.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')

    let domainRating:    number | null = null
    let ahrefsRank:      number | null = null
    let backlinks:       number | null = null
    let referringDoms:   number | null = null
    let organicKeywords: number | null = null
    let organicTraffic:  number | null = null

    // Domain Rating snapshot
    try {
      const drData = await ahrefsGet('/site-explorer/domain-rating', apiKey, {
        target: domain,
        date:   dateTo,
      })
      // Ahrefs v3 may return flat { domain_rating, ahrefs_rank } or nested { domain: { ... } }
      const d = (drData.domain as Record<string, unknown> | null) ?? drData
      domainRating = typeof d.domain_rating === 'number' ? d.domain_rating : null
      ahrefsRank   = typeof d.ahrefs_rank   === 'number' ? d.ahrefs_rank   : null
    } catch (e) {
      console.error(`[ahrefs] Domain rating fetch failed for ${domain}:`, e)
    }

    // Overview metrics (backlinks, ref domains, organic keywords + traffic)
    try {
      const metricsData = await ahrefsGet('/site-explorer/metrics', apiKey, {
        target:    domain,
        date_from: dateFrom,
        date_to:   dateTo,
        select:    'backlinks,refdomains,org_keywords,org_traffic',
      })
      const m = (metricsData.metrics as Record<string, unknown> | null) ?? metricsData
      backlinks       = typeof m.backlinks    === 'number' ? m.backlinks    : null
      referringDoms   = typeof m.refdomains   === 'number' ? m.refdomains   : null
      organicKeywords = typeof m.org_keywords === 'number' ? m.org_keywords : null
      organicTraffic  = typeof m.org_traffic  === 'number' ? m.org_traffic  : null
    } catch (e) {
      console.error(`[ahrefs] Metrics fetch failed for ${domain}:`, e)
    }

    // If both API calls returned nothing useful, skip writing a blank row
    if (domainRating === null && backlinks === null && organicTraffic === null) {
      console.warn(`[ahrefs] All metrics null for ${domain} — skipping row write`)
      return { rows: [] }
    }

    const row: AhrefsRawRow = {
      date:              dateTo,
      domain_rating:     domainRating,
      ahrefs_rank:       ahrefsRank,
      backlinks:         backlinks,
      referring_domains: referringDoms,
      organic_keywords:  organicKeywords,
      organic_traffic:   organicTraffic,
    }

    return { rows: [row] as never[] }
  },

  async discoverAccounts(): Promise<DiscoveredAccount[]> {
    // Ahrefs has no account listing endpoint — admin enters domain manually
    return []
  },

  async testConnection(
    auth: Record<string, unknown>
  ): Promise<boolean> {
    const apiKey = String(auth.api_key || '')
    if (!apiKey) return false
    try {
      // Fetch DR for a known domain as a connectivity check
      const res = await fetch(
        `${BASE_URL}/site-explorer/domain-rating?target=ahrefs.com&date=${new Date().toISOString().split('T')[0]}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      )
      return res.ok
    } catch {
      return false
    }
  },
}
