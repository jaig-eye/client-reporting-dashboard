// ─────────────────────────────────────────────────────────────────────────────
// Meta Ads Connector
//
// Implements ConnectorAdapter for the Meta Marketing API.
// Supports two auth modes:
//   1. System User token (agency-level, stored in connector.auth.system_user_token)
//      — covers all Business Manager ad accounts, never expires
//   2. Per-account OAuth token (stored in connector.auth.access_token)
//      — 60-day long-lived token
//
// Auth object shape:
//   { access_token?, system_user_token?, token_expires_at? }
//
// Config object shape:
//   { business_manager_id? }
//
// Key design decision: raw Meta actions are stored as JSONB in meta_ads_metrics
// so conversion events can be remapped at query time without re-syncing.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, MetaAdsRawRow, SyncResult, DiscoveredAccount } from './types'

const API_VERSION = 'v18.0'
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`

// ─────────────────────────────────────────────────────────────────────────────
// OAuth helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Exchange an authorization code for a long-lived (60-day) token. */
export async function exchangeMetaCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string }> {
  const shortLived = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri: redirectUri,
    code,
  })
  const res = await fetch(`${BASE_URL}/oauth/access_token?${shortLived}`)
  const data = (await res.json()) as Record<string, unknown>
  if (data.error) throw new Error(`Meta code exchange failed: ${JSON.stringify(data.error)}`)

  // Immediately exchange the short-lived token for a 60-day long-lived token
  const longLived = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    fb_exchange_token: String(data.access_token),
  })
  const llRes = await fetch(`${BASE_URL}/oauth/access_token?${longLived}`)
  const llData = (await llRes.json()) as Record<string, unknown>
  return { access_token: String(llData.access_token || data.access_token) }
}

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function metaGet(
  path: string,
  accessToken: string,
  params: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const url = new URL(`${BASE_URL}${path}`)
  url.searchParams.set('access_token', accessToken)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString())
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meta API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector adapter implementation
// ─────────────────────────────────────────────────────────────────────────────

export const metaAdsConnector: ConnectorAdapter = {
  type: 'meta_ads',

  // Meta long-lived tokens last 60 days and don't auto-refresh — admins must reconnect.
  // System User tokens never expire. No refreshAuth needed.
  refreshAuth: undefined,

  async fetchMetrics(
    externalId: string,
    auth: Record<string, unknown>,
    _config: Record<string, unknown>,
    dateFrom: string,
    dateTo: string
  ): Promise<SyncResult> {
    // Prefer the system user token (agency-level); fall back to per-account OAuth token
    const accessToken =
      (auth.system_user_token as string | undefined) ||
      (auth.access_token as string | undefined)

    if (!accessToken) return { rows: [] }

    const rows: MetaAdsRawRow[] = []
    const discoveredActions = new Set<string>()

    // Paginate through all campaign-level daily rows
    let nextUrl: string | null = (() => {
      const base = new URL(`${BASE_URL}/${externalId}/insights`)
      base.searchParams.set('access_token', accessToken)
      base.searchParams.set('level', 'campaign')
      // Request all fields needed to store source-faithful data.
      // `actions` and `action_values` are always fetched regardless of campaign goal
      // so admins can remap conversions without a re-sync.
      base.searchParams.set(
        'fields',
        [
          'campaign_id',
          'campaign_name',
          'objective',
          'spend',
          'impressions',
          'clicks',
          'reach',
          'frequency',
          'actions',
          'action_values',
        ].join(',')
      )
      base.searchParams.set(
        'time_range',
        JSON.stringify({ since: dateFrom, until: dateTo })
      )
      base.searchParams.set('time_increment', '1') // one row per day
      base.searchParams.set('limit', '500')
      return base.toString()
    })()

    while (nextUrl) {
      const res = await fetch(nextUrl)
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Meta API error ${res.status}: ${text}`)
      }

      const data = (await res.json()) as Record<string, unknown>
      const dayRows = (data.data || []) as Record<string, unknown>[]

      for (const day of dayRows) {
        const rawActions      = (day.actions       || []) as Record<string, unknown>[]
        const rawActionValues = (day.action_values  || []) as Record<string, unknown>[]

        // Accumulate all action types encountered for this sync
        for (const a of rawActions) {
          const t = String(a.action_type || '')
          if (t) discoveredActions.add(t)
        }

        // Store actions and action_values in source-faithful shape.
        // Conversion remapping happens at query time — we don't pick a winner here.
        const actions = rawActions.map(a => ({
          action_type: String(a.action_type || ''),
          value:       String(a.value       || '0'),
        }))
        const actionValues = rawActionValues.map(a => ({
          action_type: String(a.action_type || ''),
          value:       String(a.value       || '0'),
        }))

        rows.push({
          campaign_id:   String(day.campaign_id   || ''),
          campaign_name: String(day.campaign_name || ''),
          objective:     String(day.objective     || ''),
          date:          String(day.date_start    || ''),
          spend:         parseFloat(String(day.spend       || '0')),
          impressions:   parseInt(  String(day.impressions || '0'), 10),
          clicks:        parseInt(  String(day.clicks      || '0'), 10),
          reach:         parseInt(  String(day.reach       || '0'), 10),
          frequency:     parseFloat(String(day.frequency   || '0')),
          actions,
          action_values: actionValues,
        })
      }

      const paging = data.paging as Record<string, unknown> | undefined
      nextUrl = (paging?.next as string) || null
    }

    return {
      rows,
      discoveredActions: Array.from(discoveredActions),
    }
  },

  async discoverAccounts(
    auth: Record<string, unknown>
  ): Promise<DiscoveredAccount[]> {
    const accessToken =
      (auth.system_user_token as string | undefined) ||
      (auth.access_token as string | undefined)

    if (!accessToken) return []

    const data = await metaGet('/me/adaccounts', accessToken, {
      fields: 'id,name,account_status,currency,timezone_name',
      limit: '200',
    })

    return ((data.data || []) as Record<string, unknown>[]).map(a => ({
      external_id:   String(a.id   || ''),
      external_name: String(a.name || ''),
      metadata: {
        account_status: a.account_status,
        currency:       a.currency,
        timezone:       a.timezone_name,
      },
    }))
  },

  async testConnection(auth: Record<string, unknown>): Promise<boolean> {
    try {
      const accessToken =
        (auth.system_user_token as string | undefined) ||
        (auth.access_token as string | undefined)
      if (!accessToken) return false
      // A simple /me check validates the token is alive
      const data = await metaGet('/me', accessToken, { fields: 'id' })
      return !!data.id
    } catch {
      return false
    }
  },
}
