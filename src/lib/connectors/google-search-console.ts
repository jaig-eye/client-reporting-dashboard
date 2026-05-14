// ─────────────────────────────────────────────────────────────────────────────
// Google Search Console Connector
//
// Uses the Google Search Console API (searchconsole.googleapis.com).
// Auth: Same Google OAuth flow — tokens stored in connectors.auth.
// Required scope: https://www.googleapis.com/auth/webmasters.readonly
//
// Auth object shape:
//   { access_token, refresh_token, token_expires_at }
//
// Config object shape:
//   { site_url }  — verified property URL (e.g. "https://example.com/")
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GSC_BASE       = 'https://www.googleapis.com/webmasters/v3'

// ─────────────────────────────────────────────────────────────────────────────
// OAuth helpers (shared pattern with google-ads.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type:    'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Google token refresh failed: ${data.error}`)
  return data
}

function isExpiringSoon(expiresAt?: string): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() < Date.now() + 5 * 60 * 1000
}

function resolveToken(auth: Record<string, unknown>): string | null {
  return (auth.access_token as string) || null
}

// ─────────────────────────────────────────────────────────────────────────────
// GSC API helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface GSCRawRow {
  date:        string
  query:       string | null
  page:        string | null
  // country removed — never displayed in UI; caused 5–20× row inflation on backfills
  clicks:      number
  impressions: number
  ctr:         number
  position:    number
}

/**
 * Fetch Search Analytics data for a site over a date range.
 * GSC limits to 25,000 rows per request; paginates automatically.
 * Pagination stops when GSC returns a partial page (<PAGE_SIZE rows).
 * A 500K safety cap prevents runaway pagination on extremely high-traffic sites.
 */
async function fetchSearchAnalytics(
  siteUrl: string,
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<GSCRawRow[]> {
  const encodedSite = encodeURIComponent(siteUrl)
  const endpoint    = `${GSC_BASE}/sites/${encodedSite}/searchAnalytics/query`
  const PAGE_SIZE   = 25000
  const rows: GSCRawRow[] = []

  let startRow = 0

  while (true) {
    const body = {
      startDate:    dateFrom,
      endDate:      dateTo,
      dimensions:   ['date', 'query', 'page'],
      rowLimit:     PAGE_SIZE,
      startRow,
      dataState:    'all', // include fresh (unconfirmed) data
    }

    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 60_000)
    let res: Response
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`GSC API error ${res.status}: ${text}`)
    }

    const data = await res.json() as {
      rows?: {
        keys:        string[]
        clicks:      number
        impressions: number
        ctr:         number
        position:    number
      }[]
    }

    if (!data.rows?.length) break

    for (const row of data.rows) {
      rows.push({
        date:        row.keys[0] ?? '',
        query:       row.keys[1] ?? null,
        page:        row.keys[2] ?? null,
        clicks:      row.clicks,
        impressions: row.impressions,
        ctr:         row.ctr,
        position:    row.position,
      })
    }

    if (data.rows.length < PAGE_SIZE) break
    startRow += PAGE_SIZE

    if (rows.length >= 500_000) {
      console.warn(`[gsc] ${siteUrl}: reached 500K row safety cap for ${dateFrom}→${dateTo}, stopping pagination`)
      break
    }
  }

  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily totals — dimensions=['date'] only, no privacy filtering
// ─────────────────────────────────────────────────────────────────────────────

export interface GSCDailyTotalRow {
  date:        string
  clicks:      number
  impressions: number
  ctr:         number
  position:    number
}

/**
 * Fetch true daily totals using dimensions=['date'] only.
 * Unlike the dimensional query (date+query+page), this endpoint returns
 * the real total clicks/impressions for each day with no privacy threshold filtering.
 * Max 1 row per day — no pagination needed for typical date ranges.
 */
export async function fetchDailyTotals(
  siteUrl: string,
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<GSCDailyTotalRow[]> {
  const encodedSite = encodeURIComponent(siteUrl)
  const endpoint    = `${GSC_BASE}/sites/${encodedSite}/searchAnalytics/query`

  const body = {
    startDate:  dateFrom,
    endDate:    dateTo,
    dimensions: ['date'],
    rowLimit:   1000,
    dataState:  'all',
  }

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 60_000)
  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GSC daily totals API error ${res.status}: ${text}`)
  }

  const data = await res.json() as {
    rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[]
  }

  return (data.rows ?? []).map(row => ({
    date:        row.keys[0] ?? '',
    clicks:      row.clicks,
    impressions: row.impressions,
    ctr:         row.ctr,
    position:    row.position,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector adapter
// ─────────────────────────────────────────────────────────────────────────────

export const googleSearchConsoleConnector: ConnectorAdapter = {
  type: 'google_search_console',

  async refreshAuth(auth) {
    const rt = auth.refresh_token as string | undefined
    if (!rt) return null
    if (!isExpiringSoon(auth.token_expires_at as string | undefined)) return null
    const refreshed = await refreshAccessToken(rt)
    return {
      ...auth,
      access_token:     refreshed.access_token,
      token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    }
  },

  async fetchMetrics(externalId, auth, _config, dateFrom, dateTo): Promise<SyncResult> {
    const accessToken = resolveToken(auth)
    if (!accessToken) return { rows: [] }

    const siteUrl = externalId // stored as the verified site URL

    const gscRows = await fetchSearchAnalytics(siteUrl, accessToken, dateFrom, dateTo)

    // Cast via unknown — GSC rows stored in gsc_metrics, not the ad metric tables
    return { rows: gscRows as unknown as import('./types').RawMetricRow[] }
  },

  async discoverAccounts(auth): Promise<DiscoveredAccount[]> {
    const accessToken = resolveToken(auth)
    if (!accessToken) return []

    const res = await fetch(`${GSC_BASE}/sites`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const text = await res.text()
      console.error(`[google-search-console] sites list error ${res.status}:`, text)
      return []
    }

    const data = await res.json() as {
      siteEntry?: { siteUrl: string; permissionLevel: string }[]
    }

    return (data.siteEntry ?? []).map(site => ({
      external_id:   site.siteUrl,
      external_name: site.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      metadata: { permissionLevel: site.permissionLevel },
    }))
  },

  async testConnection(auth, _config): Promise<boolean> {
    try {
      const accessToken = resolveToken(auth)
      if (!accessToken) return false
      const res = await fetch(`${GSC_BASE}/sites`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return res.ok
    } catch {
      return false
    }
  },
}
