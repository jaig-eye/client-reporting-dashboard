// ─────────────────────────────────────────────────────────────────────────────
// Google Business Profile Connector
//
// Uses the Business Profile Performance API and My Business Account Management API.
// Auth: Same Google OAuth flow — tokens stored in connectors.auth.
// Required scope: https://www.googleapis.com/auth/business.manage
//
// Auth object shape:
//   { access_token, refresh_token, token_expires_at }
//
// Config object shape:
//   { account_id }  — GBP account resource name (e.g. "accounts/123456789")
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const TOKEN_ENDPOINT  = 'https://oauth2.googleapis.com/token'
const ACCT_MGMT_BASE  = 'https://mybusinessaccountmanagement.googleapis.com/v1'
const PERF_API_BASE   = 'https://businessprofileperformance.googleapis.com/v1'
const MYBIZ_BASE      = 'https://mybusiness.googleapis.com/v4'

// ─────────────────────────────────────────────────────────────────────────────
// OAuth helpers
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
// GBP API helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface GBPRawRow {
  location_id: string
  location_name: string
  date: string
  views_search: number
  views_maps: number
  website_clicks: number
  call_clicks: number
  direction_clicks: number
  reviews_count: number
  reviews_avg_rating: number
}

const METRIC_MAP: Record<string, keyof GBPRawRow> = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'views_search',
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH:  'views_search',   // added to same bucket
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS:   'views_maps',
  BUSINESS_IMPRESSIONS_MOBILE_MAPS:    'views_maps',     // added to same bucket
  WEBSITE_CLICKS:              'website_clicks',
  CALL_CLICKS:                 'call_clicks',
  BUSINESS_DIRECTION_REQUESTS: 'direction_clicks',
}

const DAILY_METRICS = Object.keys(METRIC_MAP)

/**
 * Fetch daily metrics for a location from the Performance API.
 * Returns one row per day, aggregating search + maps impressions.
 */
async function fetchLocationMetrics(
  locationName: string,   // full resource name: "locations/XXXXXXXXXXX"
  locationDisplayName: string,
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<GBPRawRow[]> {
  const [fromY, fromM, fromD] = dateFrom.split('-').map(Number)
  const [toY,   toM,   toD]   = dateTo.split('-').map(Number)

  const url = new URL(`${PERF_API_BASE}/${locationName}:getDailyMetricsTimeSeries`)
  url.searchParams.set('dailyRange.start_date.year',  String(fromY))
  url.searchParams.set('dailyRange.start_date.month', String(fromM))
  url.searchParams.set('dailyRange.start_date.day',   String(fromD))
  url.searchParams.set('dailyRange.end_date.year',    String(toY))
  url.searchParams.set('dailyRange.end_date.month',   String(toM))
  url.searchParams.set('dailyRange.end_date.day',     String(toD))
  for (const m of DAILY_METRICS) {
    url.searchParams.append('dailyMetric', m)
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GBP Performance API error ${res.status}: ${text}`)
  }

  const data = await res.json() as {
    multiDailyMetricTimeSeries?: {
      dailyMetric: string
      dailySubEntityType?: string
      timeSeries: {
        datedValues: { date: { year: number; month: number; day: number }; value?: string }[]
      }
    }[]
  }

  // Build a map of date → row
  const byDate = new Map<string, GBPRawRow>()

  for (const series of data.multiDailyMetricTimeSeries ?? []) {
    const fieldName = METRIC_MAP[series.dailyMetric]
    if (!fieldName) continue

    for (const dv of series.timeSeries?.datedValues ?? []) {
      const { year, month, day } = dv.date
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      if (!byDate.has(dateStr)) {
        byDate.set(dateStr, {
          location_id:        locationName,
          location_name:      locationDisplayName,
          date:               dateStr,
          views_search:       0,
          views_maps:         0,
          website_clicks:     0,
          call_clicks:        0,
          direction_clicks:   0,
          reviews_count:      0,
          reviews_avg_rating: 0,
        })
      }

      const row = byDate.get(dateStr)!
      ;(row[fieldName] as number) += parseInt(dv.value ?? '0', 10)
    }
  }

  return Array.from(byDate.values())
}

/**
 * Fetch review summary for a location (count + avg rating).
 * These are static snapshots, not time-series — applied to today's row.
 */
async function fetchReviewSummary(
  locationName: string,
  accessToken: string
): Promise<{ count: number; avgRating: number }> {
  try {
    // Reviews API requires the v4 mybusiness endpoint
    const accountId = locationName.split('/').slice(0, 2).join('/')
    const res = await fetch(
      `${MYBIZ_BASE}/${accountId}/${locationName.split('/').slice(2).join('/')}/reviews?pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) return { count: 0, avgRating: 0 }
    const data = await res.json() as {
      totalReviewCount?: number
      averageRating?: number
    }
    return {
      count:     data.totalReviewCount ?? 0,
      avgRating: data.averageRating    ?? 0,
    }
  } catch {
    return { count: 0, avgRating: 0 }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector adapter
// ─────────────────────────────────────────────────────────────────────────────

export const googleBusinessProfileConnector: ConnectorAdapter = {
  type: 'google_business_profile',

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

    // externalId = "locations/XXXXXXXXXXX" (full resource name)
    const locationName = externalId

    // Use the stored display name from connector_accounts if available
    const displayName = (_config.location_name as string) || locationName

    const rows = await fetchLocationMetrics(
      locationName, displayName, accessToken, dateFrom, dateTo
    )

    // Fetch review summary and apply to most recent row
    if (rows.length > 0) {
      const { count, avgRating } = await fetchReviewSummary(locationName, accessToken)
      // Apply to the latest date row (reviews are a current snapshot)
      const latestRow = rows.sort((a, b) => b.date.localeCompare(a.date))[0]
      latestRow.reviews_count      = count
      latestRow.reviews_avg_rating = avgRating
    }

    return { rows: rows as unknown as import('./types').RawMetricRow[] }
  },

  async discoverAccounts(auth): Promise<DiscoveredAccount[]> {
    const accessToken = resolveToken(auth)
    if (!accessToken) return []

    // List all accessible accounts
    const accountsRes = await fetch(`${ACCT_MGMT_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!accountsRes.ok) {
      const text = await accountsRes.text()
      console.error(`[google-business-profile] accounts list error ${accountsRes.status}:`, text)
      return []
    }

    const accountsData = await accountsRes.json() as {
      accounts?: { name: string; accountName: string }[]
    }

    const accounts: DiscoveredAccount[] = []

    for (const acct of accountsData.accounts ?? []) {
      // List locations for each account
      const locRes = await fetch(
        `${ACCT_MGMT_BASE}/${acct.name}/locations?pageSize=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!locRes.ok) {
        const text = await locRes.text()
        console.warn(`[google-business-profile] locations list error for ${acct.name} ${locRes.status}:`, text)
        continue
      }

      const locData = await locRes.json() as {
        locations?: { name: string; title: string; websiteUri?: string }[]
      }

      for (const loc of locData.locations ?? []) {
        accounts.push({
          external_id:   loc.name,
          external_name: `${loc.title}${loc.websiteUri ? ` — ${loc.websiteUri}` : ''}`,
          metadata: { account: acct.name, accountName: acct.accountName },
        })
      }
    }

    return accounts
  },

  async testConnection(auth, _config): Promise<boolean> {
    try {
      const accessToken = resolveToken(auth)
      if (!accessToken) return false
      const res = await fetch(`${ACCT_MGMT_BASE}/accounts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return res.ok
    } catch {
      return false
    }
  },
}
