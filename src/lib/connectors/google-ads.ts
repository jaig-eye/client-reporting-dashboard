// ─────────────────────────────────────────────────────────────────────────────
// Google Ads Connector
//
// Implements ConnectorAdapter for the Google Ads API.
// Supports two auth modes:
//   1. OAuth (access_token + refresh_token stored per connector)
//   2. MCC Script push (no OAuth — data is pushed to /api/ingest/google by a
//      Google Ads Script running in the MCC account; auth field is empty)
//
// Auth object shape:
//   { access_token, refresh_token, token_expires_at }
//
// Config object shape:
//   { mcc_customer_id }
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, GoogleAdsRawRow, SyncResult, DiscoveredAccount } from './types'

const API_VERSION = 'v16'
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

// ─────────────────────────────────────────────────────────────────────────────
// OAuth helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Exchange an OAuth authorization code for tokens. */
export async function exchangeGoogleCode(
  code: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Google code exchange failed: ${data.error}`)
  return data
}

/** Refresh an expired Google access token using the stored refresh token. */
async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string
  expires_in: number
}> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Google token refresh failed: ${data.error}`)
  return data
}

/** Returns true if the access token will expire within the next 5 minutes. */
function isExpiringSoon(expiresAt?: string): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() < Date.now() + 5 * 60 * 1000
}

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Execute a GAQL query against the Google Ads API. */
async function runQuery(
  customerId: string,
  mccCustomerId: string,
  accessToken: string,
  query: string
): Promise<Record<string, unknown>[]> {
  const id = customerId.replace(/-/g, '')
  const mcc = mccCustomerId.replace(/-/g, '')

  const res = await fetch(`${BASE_URL}/customers/${id}/googleAds:search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': process.env.GOOGLE_DEVELOPER_TOKEN!,
      'login-customer-id': mcc,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Ads query failed ${res.status}: ${text}`)
  }

  const data = await res.json()
  return (data.results || []) as Record<string, unknown>[]
}

/** List all accessible customer accounts under the authenticated user. */
async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': process.env.GOOGLE_DEVELOPER_TOKEN!,
    },
  })
  if (!res.ok) throw new Error(`listAccessibleCustomers failed: ${res.status}`)
  const data = await res.json()
  return ((data.resourceNames || []) as string[]).map((r: string) =>
    r.replace('customers/', '')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector adapter implementation
// ─────────────────────────────────────────────────────────────────────────────

export const googleAdsConnector: ConnectorAdapter = {
  type: 'google_ads',

  async refreshAuth(auth: Record<string, unknown>) {
    const refreshToken = auth.refresh_token as string | undefined
    if (!refreshToken) return null

    const expiresAt = auth.token_expires_at as string | undefined
    if (!isExpiringSoon(expiresAt)) return null

    const { access_token, expires_in } = await refreshAccessToken(refreshToken)
    return {
      ...auth,
      access_token,
      token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
    }
  },

  async fetchMetrics(
    externalId: string,
    auth: Record<string, unknown>,
    config: Record<string, unknown>,
    dateFrom: string,
    dateTo: string
  ): Promise<SyncResult> {
    const accessToken = auth.access_token as string | undefined

    // MCC Script mode: no OAuth credentials stored — data arrives via push endpoint.
    // Return empty rows; the sync engine skips pull-mode sync for this connector.
    if (!accessToken && !auth.refresh_token) {
      return { rows: [] }
    }

    const token = accessToken!
    const mccId = (config.mcc_customer_id as string | undefined) || externalId

    const raw = await runQuery(
      externalId,
      mccId,
      token,
      `SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        segments.date,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        metrics.conversions_value,
        metrics.view_through_conversions
      FROM campaign
      WHERE campaign.status != 'REMOVED'
        AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      ORDER BY segments.date DESC`
    )

    const rows: GoogleAdsRawRow[] = raw.map(row => {
      const campaign  = row.campaign  as Record<string, unknown>
      const metrics   = row.metrics   as Record<string, unknown>
      const segments  = row.segments  as Record<string, unknown>

      return {
        campaign_id:              String(campaign?.id    || ''),
        campaign_name:            String(campaign?.name  || ''),
        campaign_status:          String(campaign?.status || ''),
        campaign_type:            String(campaign?.advertisingChannelType || ''),
        date:                     String(segments?.date  || ''),
        cost_micros:              Number(metrics?.costMicros              || 0),
        impressions:              Number(metrics?.impressions             || 0),
        clicks:                   Number(metrics?.clicks                  || 0),
        conversions:              Number(metrics?.conversions             || 0),
        conversions_value:        Number(metrics?.conversionsValue        || 0),
        view_through_conversions: Number(metrics?.viewThroughConversions  || 0),
      }
    })

    return { rows }
  },

  async discoverAccounts(
    auth: Record<string, unknown>
  ): Promise<DiscoveredAccount[]> {
    const accessToken = auth.access_token as string | undefined
    if (!accessToken) return []

    const customerIds = await listAccessibleCustomers(accessToken)
    return customerIds.map(id => ({
      external_id: id,
      external_name: `Google Ads: ${id}`,
    }))
  },

  async testConnection(auth: Record<string, unknown>): Promise<boolean> {
    try {
      const accessToken = auth.access_token as string | undefined
      if (!accessToken) return false
      const customers = await listAccessibleCustomers(accessToken)
      return customers.length >= 0 // even 0 accounts is a valid auth state
    } catch {
      return false
    }
  },
}
