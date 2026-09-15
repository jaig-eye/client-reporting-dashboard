// ─────────────────────────────────────────────────────────────────────────────
// Google Analytics 4 Connector
//
// Uses the Google Analytics Data API v1 (analyticsdata.googleapis.com).
// Auth: Same Google OAuth flow as Google Ads — tokens stored in connectors.auth.
// Required scope: https://www.googleapis.com/auth/analytics.readonly
//
// Auth object shape (shared with Google Ads connector):
//   { access_token, refresh_token, token_expires_at }
//
// Config object shape:
//   { property_id }  — GA4 property ID (e.g. "properties/123456789")
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const TOKEN_ENDPOINT  = 'https://oauth2.googleapis.com/token'
const DATA_API_BASE   = 'https://analyticsdata.googleapis.com/v1beta'
const ADMIN_API_BASE  = 'https://analyticsadmin.googleapis.com/v1beta'

// ─────────────────────────────────────────────────────────────────────────────
// OAuth helpers (mirrored from google-ads.ts)
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
// GA4 Data API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function runReport(
  propertyId: string,
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, unknown>[]> {
  // Normalise property ID — accept bare number or full resource name
  const property = propertyId.startsWith('properties/')
    ? propertyId
    : `properties/${propertyId}`

  const body = {
    dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
    dimensions: [
      { name: 'date' },
      { name: 'sessionDefaultChannelGroup' },
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'screenPageViews' },
      { name: 'conversions' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
      { name: 'engagedSessions' },
    ],
    // Restrict to web streams only — matches GA4 Traffic Acquisition report default.
    // Without this filter app streams (iOS/Android) inflate sessions, especially
    // the Cross-network channel used heavily for app install campaigns.
    dimensionFilter: {
      filter: {
        fieldName: 'platform',
        stringFilter: { matchType: 'EXACT', value: 'web' },
      },
    },
    limit: 100000,
  }

  const res = await fetch(`${DATA_API_BASE}/${property}:runReport`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GA4 Data API error ${res.status}: ${text}`)
  }

  const data = await res.json() as {
    dimensionHeaders?: { name: string }[]
    metricHeaders?:    { name: string }[]
    rows?:             { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]
  }

  if (!data.rows?.length) return []

  const dimHeaders = (data.dimensionHeaders ?? []).map(h => h.name)
  const metHeaders = (data.metricHeaders  ?? []).map(h => h.name)

  return data.rows.map(row => {
    const dims:  Record<string, string> = {}
    const mets:  Record<string, string> = {}
    row.dimensionValues.forEach((v, i) => { dims[dimHeaders[i]] = v.value })
    row.metricValues.forEach(  (v, i) => { mets[metHeaders[i]]  = v.value })
    return { ...dims, ...mets }
  })
}

async function runSourceReport(
  propertyId: string,
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, unknown>[]> {
  const property = propertyId.startsWith('properties/')
    ? propertyId
    : `properties/${propertyId}`

  const body = {
    dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
    dimensions: [
      { name: 'date' },
      { name: 'sessionSource' },
      { name: 'sessionMedium' },
      { name: 'sessionCampaignName' },
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'screenPageViews' },
      { name: 'conversions' },
      { name: 'engagedSessions' },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'platform',
        stringFilter: { matchType: 'EXACT', value: 'web' },
      },
    },
    limit: 100000,
  }

  const res = await fetch(`${DATA_API_BASE}/${property}:runReport`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GA4 Source Report error ${res.status}: ${text}`)
  }

  const data = await res.json() as {
    dimensionHeaders?: { name: string }[]
    metricHeaders?:    { name: string }[]
    rows?:             { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]
  }

  if (!data.rows?.length) return []

  const dimHeaders = (data.dimensionHeaders ?? []).map(h => h.name)
  const metHeaders = (data.metricHeaders  ?? []).map(h => h.name)

  return data.rows.map(row => {
    const dims:  Record<string, string> = {}
    const mets:  Record<string, string> = {}
    row.dimensionValues.forEach((v, i) => { dims[dimHeaders[i]] = v.value })
    row.metricValues.forEach(  (v, i) => { mets[metHeaders[i]]  = v.value })
    return { ...dims, ...mets }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector adapter
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Audience and behaviour detail: device, city, landing page, key events
// ─────────────────────────────────────────────────────────────────────────────

export type GA4Dimension = 'device' | 'city' | 'landing_page' | 'key_event'

export interface GA4DimensionRow {
  date:             string
  dimension:        GA4Dimension
  value:            string
  sessions:         number
  users:            number
  conversions:      number
  engaged_sessions: number
  event_count:      number
}

const TRAFFIC_METRICS = ['sessions', 'totalUsers', 'conversions', 'engagedSessions']

const DIMENSION_REPORTS: { dimension: GA4Dimension; field: string; metrics: string[]; topPerDay: number }[] = [
  { dimension: 'device',       field: 'deviceCategory', metrics: TRAFFIC_METRICS,               topPerDay: 10 },
  { dimension: 'city',         field: 'city',           metrics: TRAFFIC_METRICS,               topPerDay: 25 },
  { dimension: 'landing_page', field: 'landingPage',    metrics: TRAFFIC_METRICS,               topPerDay: 25 },
  { dimension: 'key_event',    field: 'eventName',      metrics: ['eventCount', 'conversions'], topPerDay: 25 },
]

/**
 * One row per day per value for each audience report. Each report runs and fails on its own:
 * a property that rejects one still syncs the others, and the main traffic sync never depends
 * on them. Cities and landing pages keep each day's top values, so a long backfill stays small.
 * Key events keep only events GA4 counts as conversions.
 */
async function runDimensionReports(
  propertyId: string,
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<GA4DimensionRow[]> {
  const property = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`

  const results = await Promise.all(DIMENSION_REPORTS.map(async report => {
    try {
      const res = await fetch(`${DATA_API_BASE}/${property}:runReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
          dimensions: [{ name: 'date' }, { name: report.field }],
          metrics:    report.metrics.map(name => ({ name })),
          dimensionFilter: { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'web' } } },
          limit: 100000,
        }),
      })
      if (!res.ok) {
        console.warn(`[google-analytics] ${report.dimension} report failed ${res.status}: ${(await res.text()).slice(0, 300)}`)
        return []
      }
      const data = await res.json() as {
        metricHeaders?: { name: string }[]
        rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]
      }
      const metricNames = (data.metricHeaders ?? []).map(h => h.name)

      const byDay = new Map<string, GA4DimensionRow[]>()
      for (const row of data.rows ?? []) {
        const rawDate = row.dimensionValues[0]?.value ?? ''
        const date    = rawDate.length === 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate
        const value   = (row.dimensionValues[1]?.value ?? '').slice(0, 500)
        if (!date || !value) continue
        const metric = (name: string) => {
          const i = metricNames.indexOf(name)
          return i >= 0 ? Math.round(Number(row.metricValues[i]?.value ?? 0) || 0) : 0
        }
        const out: GA4DimensionRow = {
          date, dimension: report.dimension, value,
          sessions:         metric('sessions'),
          users:            metric('totalUsers'),
          conversions:      metric('conversions'),
          engaged_sessions: metric('engagedSessions'),
          event_count:      metric('eventCount'),
        }
        if (report.dimension === 'key_event' && out.conversions <= 0) continue
        const list = byDay.get(date) ?? []
        list.push(out)
        byDay.set(date, list)
      }

      const rank = (r: GA4DimensionRow) => (report.dimension === 'key_event' ? r.conversions : r.sessions)
      return Array.from(byDay.values()).flatMap(list => list.sort((a, b) => rank(b) - rank(a)).slice(0, report.topPerDay))
    } catch (e) {
      console.warn(`[google-analytics] ${report.dimension} report failed:`, e)
      return []
    }
  }))

  return results.flat()
}

export interface GA4RawRow {
  date: string
  channel_group: string
  sessions: number
  users: number
  new_users: number
  page_views: number
  conversions: number
  bounce_rate: number
  avg_session_duration: number
  engaged_sessions: number
}

export interface GA4SourceRow {
  date:             string
  source:           string
  medium:           string
  campaign:         string
  sessions:         number
  users:            number
  new_users:        number
  page_views:       number
  conversions:      number
  engaged_sessions: number
}

export const googleAnalyticsConnector: ConnectorAdapter = {
  type: 'google_analytics',

  async refreshAuth(auth) {
    if (!isExpiringSoon(auth.token_expires_at as string | undefined)) return null
    const rt = auth.refresh_token as string | undefined
    if (!rt) throw new Error('GA4 refresh_token missing — re-connect the integration')
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

    const propertyId = externalId // stored as the GA4 property ID

    const [channelApiRows, sourceApiRows, dimensionRows] = await Promise.all([
      runReport(propertyId, accessToken, dateFrom, dateTo),
      runSourceReport(propertyId, accessToken, dateFrom, dateTo),
      runDimensionReports(propertyId, accessToken, dateFrom, dateTo),
    ])

    const rows: GA4RawRow[] = channelApiRows.map(r => ({
      date:                 String(r.date || ''),
      channel_group:        String(r.sessionDefaultChannelGroup || ''),
      sessions:             parseInt(String(r.sessions              || '0'), 10),
      users:                parseInt(String(r.totalUsers            || '0'), 10),
      new_users:            parseInt(String(r.newUsers              || '0'), 10),
      page_views:           parseInt(String(r.screenPageViews       || '0'), 10),
      conversions:          parseInt(String(r.conversions           || '0'), 10),
      bounce_rate:          parseFloat(String(r.bounceRate          || '0')),
      avg_session_duration: parseFloat(String(r.averageSessionDuration || '0')),
      engaged_sessions:     parseInt(String(r.engagedSessions       || '0'), 10),
    }))

    const sourceRows: GA4SourceRow[] = sourceApiRows.map(r => ({
      date:             String(r.date || ''),
      source:           String(r.sessionSource         || '(direct)'),
      medium:           String(r.sessionMedium         || '(none)'),
      campaign:         String(r.sessionCampaignName   || '(not set)'),
      sessions:         parseInt(String(r.sessions         || '0'), 10),
      users:            parseInt(String(r.totalUsers       || '0'), 10),
      new_users:        parseInt(String(r.newUsers         || '0'), 10),
      page_views:       parseInt(String(r.screenPageViews  || '0'), 10),
      conversions:      parseInt(String(r.conversions      || '0'), 10),
      engaged_sessions: parseInt(String(r.engagedSessions  || '0'), 10),
    }))

    // Cast to RawMetricRow via unknown — GA4 rows are stored separately from ad rows
    return {
      rows: rows as unknown as import('./types').RawMetricRow[],
      extraRows: { ga4_source_metrics: sourceRows, ga4_dimension_metrics: dimensionRows },
    }
  },

  async discoverAccounts(auth): Promise<DiscoveredAccount[]> {
    const accessToken = resolveToken(auth)
    if (!accessToken) return []

    let nextPageToken: string | undefined
    const accounts: DiscoveredAccount[] = []

    do {
      const url = new URL(`${ADMIN_API_BASE}/accountSummaries`)
      url.searchParams.set('pageSize', '200')
      if (nextPageToken) url.searchParams.set('pageToken', nextPageToken)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        const text = await res.text()
        console.error(`[google-analytics] accountSummaries error ${res.status}:`, text)
        break
      }

      const data = await res.json() as {
        accountSummaries?: {
          account: string
          displayName: string
          propertySummaries?: { property: string; displayName: string }[]
        }[]
        nextPageToken?: string
      }

      for (const acct of data.accountSummaries ?? []) {
        for (const prop of acct.propertySummaries ?? []) {
          // external_id = property resource name (e.g. "properties/123456789")
          accounts.push({
            external_id:   prop.property,
            external_name: `${prop.displayName} (${acct.displayName})`,
            metadata: { account: acct.account },
          })
        }
      }

      nextPageToken = data.nextPageToken
    } while (nextPageToken)

    return accounts
  },

  async testConnection(auth, config): Promise<boolean> {
    try {
      const accessToken = resolveToken(auth)
      if (!accessToken) return false
      const propertyId = (config.property_id as string) || ''
      if (!propertyId) return false
      const property = propertyId.startsWith('properties/')
        ? propertyId
        : `properties/${propertyId}`
      const res = await fetch(`${ADMIN_API_BASE}/${property}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return res.ok
    } catch {
      return false
    }
  },
}
