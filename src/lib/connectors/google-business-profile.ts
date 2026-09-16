// ─────────────────────────────────────────────────────────────────────────────
// Google Business Profile Connector
//
// Accounts:  My Business Account Management API   (GET /v1/accounts)
// Locations: My Business Business Information API (GET /v1/accounts/*/locations, readMask required)
// Metrics:   Business Profile Performance API     (fetchMultiDailyMetricsTimeSeries)
// Reviews:   Google My Business API v4            (GET /v4/accounts/*/locations/*/reviews)
//
// All four must be enabled on the Google Cloud project, and Business Profile API access
// must be approved by Google (unapproved projects get a quota of 0 requests).
//
// Auth: Same Google OAuth flow — tokens stored in connectors.auth.
// Required scope: https://www.googleapis.com/auth/business.manage
//
// Auth object shape:
//   { access_token, refresh_token, token_expires_at }
//
// External ID: the location resource name, e.g. "locations/123456789"
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const TOKEN_ENDPOINT  = 'https://oauth2.googleapis.com/token'
const ACCT_MGMT_BASE  = 'https://mybusinessaccountmanagement.googleapis.com/v1'
const BIZ_INFO_BASE   = 'https://mybusinessbusinessinformation.googleapis.com/v1'
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

/** Google's own error message, so a refused call says why (API not enabled, quota 0, no access). */
async function googleError(res: Response, what: string): Promise<Error> {
  const text = await res.text()
  let message = text
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    message = parsed.error?.message ?? text
  } catch { /* not JSON */ }
  return new Error(`${what} failed (${res.status}): ${message.slice(0, 400)}`)
}

async function googleGet<T>(url: URL | string, accessToken: string, what: string): Promise<T> {
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw await googleError(res, what)
  return res.json() as Promise<T>
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

/** Roughly 18 months: how far back the Performance API keeps daily metrics. */
const MAX_HISTORY_DAYS = 540

type DatedValue   = { date: { year: number; month: number; day: number }; value?: string }
type MetricSeries = { dailyMetric: string; timeSeries?: { datedValues?: DatedValue[] } }

/** Every account the signed-in Google user can see. */
async function listAccounts(accessToken: string): Promise<{ name: string; accountName?: string }[]> {
  const accounts: { name: string; accountName?: string }[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${ACCT_MGMT_BASE}/accounts`)
    url.searchParams.set('pageSize', '20')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const data = await googleGet<{ accounts?: { name: string; accountName?: string }[]; nextPageToken?: string }>(
      url, accessToken, 'Listing Business Profile accounts',
    )
    accounts.push(...(data.accounts ?? []))
    pageToken = data.nextPageToken
    if (!pageToken) break
  }
  return accounts
}

/**
 * Fetch daily metrics for a location from the Performance API in one call.
 * Returns one row per day, adding desktop and mobile impressions together.
 */
async function fetchLocationMetrics(
  locationName: string,   // full resource name: "locations/XXXXXXXXXXX"
  locationDisplayName: string,
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<GBPRawRow[]> {
  // Daily metrics only go back about 18 months, and the 2-year backfill asks for more.
  // Start at the oldest day Google keeps rather than letting the whole request fail.
  const oldest = new Date(Date.now() - MAX_HISTORY_DAYS * 86_400_000).toISOString().split('T')[0]
  if (dateTo < oldest) return []
  if (dateFrom < oldest) dateFrom = oldest

  const [fromY, fromM, fromD] = dateFrom.split('-').map(Number)
  const [toY,   toM,   toD]   = dateTo.split('-').map(Number)

  const url = new URL(`${PERF_API_BASE}/${locationName}:fetchMultiDailyMetricsTimeSeries`)
  for (const m of DAILY_METRICS) url.searchParams.append('dailyMetrics', m)
  url.searchParams.set('dailyRange.start_date.year',  String(fromY))
  url.searchParams.set('dailyRange.start_date.month', String(fromM))
  url.searchParams.set('dailyRange.start_date.day',   String(fromD))
  url.searchParams.set('dailyRange.end_date.year',    String(toY))
  url.searchParams.set('dailyRange.end_date.month',   String(toM))
  url.searchParams.set('dailyRange.end_date.day',     String(toD))

  const data = await googleGet<{
    multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: MetricSeries[] }[]
  }>(url, accessToken, `Business Profile metrics for ${locationName}`)

  const byDate = new Map<string, GBPRawRow>()

  for (const group of data.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
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

        // Google leaves `value` out on days with zero.
        const row = byDate.get(dateStr)!
        ;(row[fieldName] as number) += parseInt(dv.value ?? '0', 10) || 0
      }
    }
  }

  return Array.from(byDate.values())
}

export interface GBPReview {
  review_id:     string
  reviewer_name: string
  /** 1–5. Zero when Google returns STAR_RATING_UNSPECIFIED. */
  star_rating:   number
  comment:       string
  created_at:    string
  updated_at:    string | null
  /** The owner's public reply, when there is one. */
  reply_comment: string | null
  replied_at:    string | null
}

export interface GBPReviewResult {
  count:     number
  avgRating: number
  reviews:   GBPReview[]
}

const STAR_WORDS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

// Google returns 50 reviews a page. Forty pages covers every listing we report on outright —
// the largest holds about 1,200 — which matters because the reply rate is only true if it is
// measured over all of them. The cap is here so a listing with tens of thousands cannot hold up
// a sync, and the page says when it has been hit.
const REVIEW_PAGE_SIZE = 50
const MAX_REVIEW_PAGES = 40

interface V4Review {
  reviewId?:    string
  name?:        string
  reviewer?:    { displayName?: string; isAnonymous?: boolean }
  starRating?:  string
  comment?:     string
  createTime?:  string
  updateTime?:  string
  reviewReply?: { comment?: string; updateTime?: string }
}

/**
 * Every review for a location, with the owner's reply where there is one, plus the running count
 * and average Google reports alongside them.
 *
 * The v4 reviews endpoint needs the owning account in the path, which the location name doesn't
 * carry, so try each account the user can see until one owns the location.
 *
 * Only what Google already shows publicly on the listing is read: the display name, the words and
 * the reply. The reviewer's profile URL and anything identifying beyond the name are left behind.
 */
export async function fetchReviews(
  locationName: string,
  accessToken: string
): Promise<GBPReviewResult> {
  const empty: GBPReviewResult = { count: 0, avgRating: 0, reviews: [] }
  try {
    const accounts = await listAccounts(accessToken)
    for (const account of accounts) {
      const reviews: GBPReview[] = []
      let count = 0, avgRating = 0, pageToken: string | undefined, owned = false

      for (let page = 0; page < MAX_REVIEW_PAGES; page++) {
        const url = new URL(`${MYBIZ_BASE}/${account.name}/${locationName}/reviews`)
        url.searchParams.set('pageSize', String(REVIEW_PAGE_SIZE))
        if (pageToken) url.searchParams.set('pageToken', pageToken)

        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
        // Another account may own this location — try the next one.
        if (!res.ok) break
        owned = true

        const data = await res.json() as {
          reviews?: V4Review[]; totalReviewCount?: number; averageRating?: number; nextPageToken?: string
        }
        count     = data.totalReviewCount ?? count
        avgRating = data.averageRating    ?? avgRating

        for (const r of data.reviews ?? []) {
          // reviewId is not always set; the resource name always ends with it.
          const id = r.reviewId || (r.name ?? '').split('/').pop() || ''
          if (!id || !r.createTime) continue
          reviews.push({
            review_id:     id,
            reviewer_name: r.reviewer?.isAnonymous ? '' : (r.reviewer?.displayName ?? ''),
            star_rating:   STAR_WORDS[String(r.starRating ?? '').toUpperCase()] ?? 0,
            comment:       r.comment ?? '',
            created_at:    r.createTime,
            updated_at:    r.updateTime ?? null,
            reply_comment: r.reviewReply?.comment ?? null,
            replied_at:    r.reviewReply?.updateTime ?? null,
          })
        }

        pageToken = data.nextPageToken
        if (!pageToken) break
      }

      if (!owned) continue
      const replied = reviews.filter(r => r.reply_comment).length
      console.log(`[google-business-profile] reviews for ${locationName}: ${reviews.length} fetched of ${count}, ${replied} replied to`)
      return { count, avgRating, reviews }
    }
    console.warn(`[google-business-profile] no account returned reviews for ${locationName}`)
  } catch (e) {
    console.warn(`[google-business-profile] reviews failed for ${locationName}:`, e)
  }
  return empty
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
    if (!accessToken) return { rows: [], error: 'No Google access token. Reconnect the Google account.' }

    // externalId = "locations/XXXXXXXXXXX" (full resource name)
    const locationName = externalId
    const displayName  = (_config.location_name as string) || locationName

    const rows = await fetchLocationMetrics(
      locationName, displayName, accessToken, dateFrom, dateTo
    )

    // Reviews are fetched once by the sync, which stores them and puts the running total and
    // average on the most recent row. Fetching them here as well would read the same pages twice.

    return { rows: rows as unknown as import('./types').RawMetricRow[] }
  },

  /**
   * Throws with Google's message when accounts or locations can't be listed, so the admin
   * "refresh accounts" button shows why instead of quietly finding nothing. The OAuth
   * callback already treats discovery failures as non-fatal.
   */
  async discoverAccounts(auth): Promise<DiscoveredAccount[]> {
    const accessToken = resolveToken(auth)
    if (!accessToken) throw new Error('No Google access token. Reconnect the Google account.')

    const accounts = await listAccounts(accessToken)
    const found: DiscoveredAccount[] = []
    const failures: Error[] = []

    for (const acct of accounts) {
      let pageToken: string | undefined
      try {
        for (let page = 0; page < 50; page++) {
          const url = new URL(`${BIZ_INFO_BASE}/${acct.name}/locations`)
          url.searchParams.set('readMask', 'name,title,websiteUri')
          url.searchParams.set('pageSize', '100')
          if (pageToken) url.searchParams.set('pageToken', pageToken)
          const data = await googleGet<{
            locations?: { name: string; title?: string; websiteUri?: string }[]
            nextPageToken?: string
          }>(url, accessToken, `Listing locations for ${acct.name}`)

          for (const loc of data.locations ?? []) {
            found.push({
              external_id:   loc.name,
              external_name: `${loc.title ?? loc.name}${loc.websiteUri ? ` — ${loc.websiteUri}` : ''}`,
              metadata:      { account: acct.name, accountName: acct.accountName },
            })
          }
          pageToken = data.nextPageToken
          if (!pageToken) break
        }
      } catch (e) {
        console.warn(`[google-business-profile] ${String(e)}`)
        failures.push(e instanceof Error ? e : new Error(String(e)))
      }
    }

    if (found.length === 0 && failures.length > 0) throw failures[0]
    if (accounts.length === 0) {
      console.warn('[google-business-profile] the connected Google user has no Business Profile accounts')
    }
    return found
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
