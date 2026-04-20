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
// API endpoints used:
//   GET /v3/site-explorer/domain-rating-history   — weekly DR timeseries
//   GET /v3/site-explorer/metrics-history         — weekly backlinks/organic timeseries
//   GET /v3/site-explorer/organic-keywords        — top keyword rankings snapshot
//   GET /v3/site-explorer/top-pages              — top organic pages snapshot
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
  traffic_value?:    number | null
  paid_keywords?:    number | null
  paid_traffic?:     number | null
}

export interface AhrefsKeywordRow {
  date:       string
  keyword:    string
  position:   number | null
  volume:     number | null
  traffic:    number | null
  difficulty: number | null
}

export interface AhrefsPageRow {
  date:             string
  url:              string
  organic_traffic:  number | null
  organic_keywords: number | null
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

// ─────────────────────────────────────────────────────────────────────────────
// Keyword rankings snapshot (for a specific date)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAhrefsKeywords(
  domain: string,
  apiKey: string,
  date: string
): Promise<AhrefsKeywordRow[]> {
  try {
    const data = await ahrefsGet('/site-explorer/organic-keywords', apiKey, {
      target:   domain,
      date,
      select:   'keyword,best_position,volume,sum_traffic,keyword_difficulty',
      order_by: 'sum_traffic:desc',
      limit:    '200',
    })
    const items = (data.keywords ?? data) as Record<string, unknown>[]
    if (!Array.isArray(items) || items.length === 0) return []
    console.log('[ahrefs] keyword sample:', JSON.stringify(items[0]).slice(0, 200))
    return items.map(k => ({
      date,
      keyword:    String(k.keyword ?? ''),
      position:   typeof k.best_position      === 'number' ? k.best_position      : null,
      volume:     typeof k.volume             === 'number' ? k.volume             : null,
      traffic:    typeof k.sum_traffic        === 'number' ? k.sum_traffic        : null,
      difficulty: typeof k.keyword_difficulty === 'number' ? k.keyword_difficulty : null,
    })).filter(k => k.keyword)
  } catch (e) {
    console.error(`[ahrefs] fetchAhrefsKeywords failed for ${domain}:`, e)
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top organic pages snapshot (for a specific date)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAhrefsPages(
  domain: string,
  apiKey: string,
  date: string
): Promise<AhrefsPageRow[]> {
  try {
    const data = await ahrefsGet('/site-explorer/top-pages', apiKey, {
      target:   domain,
      date,
      select:   'url,traffic,keywords',
      order_by: 'traffic:desc',
      limit:    '50',
    })
    const items = (data.pages ?? data.top_pages ?? data) as Record<string, unknown>[]
    if (!Array.isArray(items) || items.length === 0) return []
    console.log('[ahrefs] pages sample:', JSON.stringify(items[0]).slice(0, 200))
    return items.map(p => ({
      date,
      url:              String(p.url ?? ''),
      organic_traffic:  typeof p.traffic  === 'number' ? p.traffic  : null,
      organic_keywords: typeof p.keywords === 'number' ? p.keywords : null,
    })).filter(p => p.url)
  } catch (e) {
    console.error(`[ahrefs] fetchAhrefsPages failed for ${domain}:`, e)
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector adapter
// ─────────────────────────────────────────────────────────────────────────────

export const ahrefsConnector: ConnectorAdapter = {
  type: 'ahrefs',

  refreshAuth: undefined,

  async fetchMetrics(
    externalId: string,
    auth: Record<string, unknown>,
    _config: Record<string, unknown>,
    dateFrom: string,
    dateTo: string
  ): Promise<SyncResult> {
    const apiKey = String(auth.api_key || '')
    if (!apiKey) return { rows: [] }

    const domain = externalId.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')

    // ── Domain Rating history (weekly snapshots)
    let drPoints: { date: string; domain_rating?: number; ahrefs_rank?: number }[] = []
    try {
      const drHistory = await ahrefsGet('/site-explorer/domain-rating-history', apiKey, {
        target:           domain,
        date_from:        dateFrom,
        date_to:          dateTo,
        history_grouping: 'weekly',
      })
      console.log('[ahrefs] DR history sample:', JSON.stringify(drHistory).slice(0, 400))
      drPoints = (drHistory.domain_rating ?? drHistory) as typeof drPoints
      if (!Array.isArray(drPoints)) drPoints = []
    } catch (e) {
      console.error(`[ahrefs] DR history failed for ${domain}:`, e)
    }

    // ── Metrics history (weekly snapshots — backlinks, ref domains, organic)
    let metricsPoints: { date: string; backlinks?: number; refdomains?: number; org_keywords?: number; org_traffic?: number; org_cost?: number; paid_keywords?: number; paid_traffic?: number }[] = []
    try {
      const metricsHistory = await ahrefsGet('/site-explorer/metrics-history', apiKey, {
        target:           domain,
        date_from:        dateFrom,
        date_to:          dateTo,
        history_grouping: 'weekly',
        select:           'backlinks,refdomains,org_keywords,org_traffic,org_cost,paid_keywords,paid_traffic',
      })
      console.log('[ahrefs] metrics-history keys:', Object.keys(metricsHistory ?? {}))
      console.log('[ahrefs] metrics-history sample:', JSON.stringify(metricsHistory).slice(0, 600))
      // Try multiple response key paths — Ahrefs v3 uses .metrics but may differ
      const rawMetrics = metricsHistory.metrics ?? metricsHistory.history ?? metricsHistory.data ?? metricsHistory.results
      metricsPoints = Array.isArray(rawMetrics) ? rawMetrics
                    : Array.isArray(metricsHistory) ? metricsHistory
                    : []
    } catch (e) {
      console.error(`[ahrefs] Metrics history failed for ${domain}:`, e)
    }

    // If history endpoint returned nothing but DR data exists, supplement with a
    // single-snapshot metrics call so the most-recent row has backlinks/refdomains.
    if (metricsPoints.length === 0 && drPoints.length > 0) {
      console.warn('[ahrefs] metrics-history empty — supplementing with single-snapshot for', dateTo)
      try {
        const mSnap = await ahrefsGet('/site-explorer/metrics', apiKey, {
          target: domain, date: dateTo,
          select: 'backlinks,refdomains,org_keywords,org_traffic,org_cost,paid_keywords,paid_traffic',
        })
        const mData = (mSnap.metrics as Record<string, unknown> | null) ?? mSnap
        const snapBl  = typeof mData.backlinks     === 'number' ? mData.backlinks     : null
        const snapRd  = typeof mData.refdomains    === 'number' ? mData.refdomains    : null
        const snapKw  = typeof mData.org_keywords  === 'number' ? mData.org_keywords  : null
        const snapTr  = typeof mData.org_traffic   === 'number' ? mData.org_traffic   : null
        const snapOc  = typeof mData.org_cost      === 'number' ? mData.org_cost      : null
        const snapPk  = typeof mData.paid_keywords === 'number' ? mData.paid_keywords : null
        const snapPt  = typeof mData.paid_traffic  === 'number' ? mData.paid_traffic  : null
        if (snapBl !== null || snapRd !== null) {
          metricsPoints = [{
            date:          dateTo,
            backlinks:     snapBl  ?? undefined,
            refdomains:    snapRd  ?? undefined,
            org_keywords:  snapKw  ?? undefined,
            org_traffic:   snapTr  ?? undefined,
            org_cost:      snapOc  ?? undefined,
            paid_keywords: snapPk  ?? undefined,
            paid_traffic:  snapPt  ?? undefined,
          }]
          console.log('[ahrefs] supplemental snapshot metrics:', { backlinks: snapBl, refdomains: snapRd })
        }
      } catch (e) {
        console.error('[ahrefs] supplemental snapshot metrics failed:', e)
      }
    }

    // ── Merge DR + metrics by date (nearest-date within ±3 days to handle weekly offset)
    function findNearestMetrics(drDate: string) {
      const drMs = new Date(drDate).getTime()
      let best: (typeof metricsPoints)[0] | undefined
      let bestDiff = Infinity
      for (const m of metricsPoints) {
        const diff = Math.abs(new Date(m.date).getTime() - drMs)
        if (diff < bestDiff && diff <= 3 * 86_400_000) { best = m; bestDiff = diff }
      }
      return best ?? ({} as { backlinks?: number; refdomains?: number; org_keywords?: number; org_traffic?: number; org_cost?: number; paid_keywords?: number; paid_traffic?: number })
    }
    let rows: AhrefsRawRow[] = drPoints.map(dr => {
      const m = findNearestMetrics(dr.date)
      return {
        date:              dr.date,
        domain_rating:     typeof dr.domain_rating  === 'number' ? dr.domain_rating  : null,
        ahrefs_rank:       typeof dr.ahrefs_rank    === 'number' ? dr.ahrefs_rank    : null,
        backlinks:         typeof m.backlinks        === 'number' ? m.backlinks       : null,
        referring_domains: typeof m.refdomains       === 'number' ? m.refdomains      : null,
        organic_keywords:  typeof m.org_keywords     === 'number' ? m.org_keywords    : null,
        organic_traffic:   typeof m.org_traffic      === 'number' ? m.org_traffic     : null,
        traffic_value:     typeof m.org_cost         === 'number' ? m.org_cost        : null,
        paid_keywords:     typeof m.paid_keywords    === 'number' ? m.paid_keywords   : null,
        paid_traffic:      typeof m.paid_traffic     === 'number' ? m.paid_traffic    : null,
      }
    }).filter(r => r.domain_rating !== null || r.backlinks !== null)

    // ── Fallback: history endpoints returned nothing — write a single snapshot
    if (rows.length === 0) {
      console.warn(`[ahrefs] History endpoints returned no rows for ${domain} — falling back to single snapshot`)
      let domainRating:    number | null = null
      let ahrefsRank:      number | null = null
      let backlinks:       number | null = null
      let referringDoms:   number | null = null
      let organicKeywords: number | null = null
      let organicTraffic:  number | null = null
      let trafficValue:    number | null = null
      let paidKeywords:    number | null = null
      let paidTraffic:     number | null = null

      try {
        const drData = await ahrefsGet('/site-explorer/domain-rating', apiKey, { target: domain, date: dateTo })
        console.log(`[ahrefs] DR fallback for ${domain}:`, JSON.stringify(drData).slice(0, 400))
        const d = (drData.domain_rating as Record<string, unknown> | null) ?? drData
        domainRating = typeof d.domain_rating === 'number' ? d.domain_rating : null
        ahrefsRank   = typeof d.ahrefs_rank   === 'number' ? d.ahrefs_rank   : null
      } catch (e) {
        console.error(`[ahrefs] DR fallback failed for ${domain}:`, e)
      }

      try {
        const mData = await ahrefsGet('/site-explorer/metrics', apiKey, {
          target: domain, date: dateTo, select: 'backlinks,refdomains,org_keywords,org_traffic,org_cost,paid_keywords,paid_traffic',
        })
        const m = (mData.metrics as Record<string, unknown> | null) ?? mData
        backlinks       = typeof m.backlinks     === 'number' ? m.backlinks     : null
        referringDoms   = typeof m.refdomains    === 'number' ? m.refdomains    : null
        organicKeywords = typeof m.org_keywords  === 'number' ? m.org_keywords  : null
        organicTraffic  = typeof m.org_traffic   === 'number' ? m.org_traffic   : null
        trafficValue    = typeof m.org_cost      === 'number' ? m.org_cost      : null
        paidKeywords    = typeof m.paid_keywords === 'number' ? m.paid_keywords : null
        paidTraffic     = typeof m.paid_traffic  === 'number' ? m.paid_traffic  : null
      } catch (e) {
        console.error(`[ahrefs] Metrics fallback failed for ${domain}:`, e)
      }

      if (domainRating !== null || backlinks !== null) {
        rows = [{ date: dateTo, domain_rating: domainRating, ahrefs_rank: ahrefsRank,
          backlinks, referring_domains: referringDoms, organic_keywords: organicKeywords, organic_traffic: organicTraffic,
          traffic_value: trafficValue, paid_keywords: paidKeywords, paid_traffic: paidTraffic }]
      }
    }

    if (rows.length === 0) return { rows: [] }
    console.log(`[ahrefs] fetchMetrics: ${rows.length} rows for ${domain} (${dateFrom} → ${dateTo})`)
    return { rows: rows as never[] }
  },

  async discoverAccounts(): Promise<DiscoveredAccount[]> {
    return []
  },

  async testConnection(auth: Record<string, unknown>): Promise<boolean> {
    const apiKey = String(auth.api_key || '')
    if (!apiKey) return false
    try {
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
