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

const API_VERSION = 'v21.0'
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
// Ad-level metrics fetch (for campaign drill-down)
// ─────────────────────────────────────────────────────────────────────────────

export interface MetaAdRawRow {
  campaign_id: string
  campaign_name: string
  adset_id: string
  adset_name: string
  ad_id: string
  ad_name: string
  // Creative
  thumbnail_url: string      // low-res fallback / video poster
  image_url: string          // high-res image (empty string if none)
  video_id: string           // Meta video asset ID (empty string if not video)
  video_thumb_url: string    // video poster URL (empty string if none)
  creative_body: string      // primary ad copy text
  creative_title: string     // headline
  creative_link_url: string  // destination URL
  ad_status: string          // ACTIVE | PAUSED | DELETED
  date: string
  spend: number
  impressions: number
  clicks: number
  reach: number
  actions: import('../types').MetaAction[]
  action_values: import('../types').MetaAction[]
  conversions: number
  conversion_value: number
}

/**
 * Fetch ad-level metrics for a Meta ad account over a date range.
 * Includes thumbnail_url fetched from the creative API in a batch request.
 * Called by the sync engine after campaign-level sync.
 */
export async function fetchMetaAdMetrics(
  externalId: string,
  auth: Record<string, unknown>,
  dateFrom: string,
  dateTo: string
): Promise<MetaAdRawRow[]> {
  const accessToken = resolveToken(auth)
  if (!accessToken) return []

  const rows: MetaAdRawRow[] = []

  // Build initial insights URL at the ad level
  let nextUrl: string | null = (() => {
    const base = new URL(`${BASE_URL}/${externalId}/insights`)
    base.searchParams.set('access_token', accessToken)
    base.searchParams.set('level', 'ad')
    base.searchParams.set(
      'fields',
      [
        'campaign_id',
        'campaign_name',
        'adset_id',
        'adset_name',
        'ad_id',
        'ad_name',
        'spend',
        'impressions',
        'clicks',
        'reach',
        'actions',
        'action_values',
      ].join(',')
    )
    base.searchParams.set(
      'time_range',
      JSON.stringify({ since: dateFrom, until: dateTo })
    )
    base.searchParams.set('time_increment', '1')
    base.searchParams.set('limit', '500')
    return base.toString()
  })()

  // Collect all ad_ids so we can batch-fetch creative assets
  const adIdSet = new Set<string>()
  const rawRows: (Omit<MetaAdRawRow, 'thumbnail_url' | 'image_url' | 'video_id' | 'video_thumb_url' | 'creative_body' | 'creative_title' | 'creative_link_url' | 'ad_status'>)[] = []

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

      const actions = rawActions.map(a => ({
        action_type: String(a.action_type || ''),
        value:       String(a.value       || '0'),
      }))
      const actionValues = rawActionValues.map(a => ({
        action_type: String(a.action_type || ''),
        value:       String(a.value       || '0'),
      }))

      const conversions     = actions.reduce((s, a) => s + parseFloat(a.value || '0'), 0)
      const conversionValue = actionValues.reduce((s, a) => s + parseFloat(a.value || '0'), 0)

      const adId = String(day.ad_id || '')
      if (adId) adIdSet.add(adId)

      rawRows.push({
        campaign_id:      String(day.campaign_id   || ''),
        campaign_name:    String(day.campaign_name || ''),
        adset_id:         String(day.adset_id      || ''),
        adset_name:       String(day.adset_name    || ''),
        ad_id:            adId,
        ad_name:          String(day.ad_name       || ''),
        date:             String(day.date_start     || ''),
        spend:            parseFloat(String(day.spend       || '0')),
        impressions:      parseInt(  String(day.impressions || '0'), 10),
        clicks:           parseInt(  String(day.clicks      || '0'), 10),
        reach:            parseInt(  String(day.reach       || '0'), 10),
        actions,
        action_values:    actionValues,
        conversions,
        conversion_value: conversionValue,
      })
    }

    const paging = data.paging as Record<string, unknown> | undefined
    nextUrl = (paging?.next as string) || null
  }

  // Batch-fetch creative assets for all unique ad_ids
  const creativeMap = await fetchAdCreatives(Array.from(adIdSet), accessToken)

  // Merge creative data into rows
  for (const row of rawRows) {
    const creative = creativeMap[row.ad_id] ?? {}
    rows.push({
      ...row,
      thumbnail_url:     creative.thumbnail_url    ?? '',
      image_url:         creative.image_url        ?? '',
      video_id:          creative.video_id         ?? '',
      video_thumb_url:   creative.video_thumb_url  ?? '',
      creative_body:     creative.creative_body    ?? '',
      creative_title:    creative.creative_title   ?? '',
      creative_link_url: creative.creative_link_url ?? '',
      ad_status:         creative.ad_status        ?? '',
    })
  }

  return rows
}

interface AdCreativeData {
  thumbnail_url:    string
  image_url:        string
  video_id:         string
  video_thumb_url:  string
  creative_body:    string
  creative_title:   string
  creative_link_url: string
  ad_status:        string
}

/**
 * Batch-fetch creative assets and delivery status for a list of ad IDs.
 * Requests high-res image_url, video info, copy fields, and ad status.
 * Returns a map of ad_id → AdCreativeData.
 */
async function fetchAdCreatives(
  adIds: string[],
  accessToken: string
): Promise<Record<string, Partial<AdCreativeData>>> {
  if (!adIds.length) return {}

  const result: Record<string, Partial<AdCreativeData>> = {}

  // Process in batches of 50 (Meta batch API limit)
  for (let i = 0; i < adIds.length; i += 50) {
    const batch = adIds.slice(i, i + 50)
    try {
      const creativeFields = [
        'image_url',
        'thumbnail_url',
        'video_id',
        'body',
        'title',
        'link_url',
        'object_story_spec',
      ].join(',')

      const batchRequests = batch.map(adId => ({
        method: 'GET',
        relative_url: `${adId}?fields=status,creative{${creativeFields}}`,
      }))

      const batchUrl = new URL(`${BASE_URL}/`)
      batchUrl.searchParams.set('access_token', accessToken)
      batchUrl.searchParams.set('batch', JSON.stringify(batchRequests))

      const res = await fetch(batchUrl.toString(), { method: 'POST' })
      if (!res.ok) continue

      const responses = (await res.json()) as Record<string, unknown>[]
      for (let j = 0; j < responses.length; j++) {
        const item = responses[j]
        if (!item || (item.code as number) !== 200) continue
        try {
          const body     = JSON.parse(item.body as string) as Record<string, unknown>
          const creative = body.creative as Record<string, unknown> | undefined
          const adId     = batch[j]

          // Resolve image URL — prefer full-size image_url, fall back to thumbnail
          const imageUrl    = (creative?.image_url    as string | undefined) ?? ''
          const thumbUrl    = (creative?.thumbnail_url as string | undefined) ?? ''
          const videoId     = (creative?.video_id     as string | undefined) ?? ''

          // For video ads, thumbnail_url is the poster frame — keep it separately
          const videoThumb  = videoId ? thumbUrl : ''

          result[adId] = {
            image_url:         imageUrl || (!videoId ? thumbUrl : ''),
            thumbnail_url:     thumbUrl,
            video_id:          videoId,
            video_thumb_url:   videoThumb,
            creative_body:     (creative?.body      as string | undefined) ?? '',
            creative_title:    (creative?.title     as string | undefined) ?? '',
            creative_link_url: (creative?.link_url  as string | undefined) ?? '',
            ad_status:         (body.status         as string | undefined) ?? '',
          }
        } catch {
          // ignore parse errors for individual ads
        }
      }
    } catch {
      // ignore batch errors — creatives are best-effort
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector adapter implementation
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve the access token from stored auth credentials.
 *  Priority: system_user_token (never expires) → access_token (60-day OAuth token)
 *  Note: App Access Tokens (app_id|app_secret) cannot access ad insights and are not used.
 */
function resolveToken(auth: Record<string, unknown>): string | undefined {
  if (auth.system_user_token) return auth.system_user_token as string
  if (auth.access_token)      return auth.access_token      as string
  return undefined
}

export const metaAdsConnector: ConnectorAdapter = {
  type: 'meta_ads',

  refreshAuth: undefined,

  async fetchMetrics(
    externalId: string,
    auth: Record<string, unknown>,
    _config: Record<string, unknown>,
    dateFrom: string,
    dateTo: string
  ): Promise<SyncResult> {
    const accessToken = resolveToken(auth)

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
    const accessToken = resolveToken(auth)
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
      const accessToken = resolveToken(auth)
      if (!accessToken) return false
      // A simple /me check validates the token is alive
      const data = await metaGet('/me', accessToken, { fields: 'id' })
      return !!data.id
    } catch {
      return false
    }
  },
}
