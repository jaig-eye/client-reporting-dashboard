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

const API_VERSION = 'v23'
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
      redirect_uri: `${(process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Google code exchange failed: ${data.error}`)
  return data
}

/** Refresh an expired Google access token using the stored refresh token.
 *  Uses per-connector client_id/client_secret if provided, falls back to env vars.
 */
async function refreshAccessToken(
  refreshToken: string,
  clientId?: string,
  clientSecret?: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     clientId     || process.env.GOOGLE_CLIENT_ID!,
      client_secret: clientSecret || process.env.GOOGLE_CLIENT_SECRET!,
      grant_type:    'refresh_token',
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

/** Execute a GAQL query against the Google Ads API with automatic pagination. */
async function runQuery(
  customerId: string,
  mccCustomerId: string,
  accessToken: string,
  query: string,
  developerToken?: string
): Promise<Record<string, unknown>[]> {
  const id  = customerId.replace(/-/g, '')
  const mcc = mccCustomerId.replace(/-/g, '')
  const devToken = developerToken || process.env.GOOGLE_DEVELOPER_TOKEN
  if (!devToken) throw new Error('Google Ads developer token is missing. Add it in connector settings or set GOOGLE_DEVELOPER_TOKEN env var.')

  const headers = {
    Authorization:       `Bearer ${accessToken}`,
    'developer-token':   devToken,
    'login-customer-id': mcc,
    'Content-Type':      'application/json',
  }
  const url = `${BASE_URL}/customers/${id}/googleAds:search`

  const allResults: Record<string, unknown>[] = []
  let pageToken: string | undefined

  do {
    const body: Record<string, unknown> = { query }
    if (pageToken) body.pageToken = pageToken

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Google Ads query failed ${res.status}: ${text}`)
    }

    const data = await res.json() as Record<string, unknown>
    const results = (data.results || []) as Record<string, unknown>[]
    allResults.push(...results)
    pageToken = data.nextPageToken as string | undefined
  } while (pageToken)

  return allResults
}

/** List all accessible customer accounts under the authenticated user. */
async function listAccessibleCustomers(accessToken: string, developerToken?: string): Promise<string[]> {
  const devToken = developerToken || process.env.GOOGLE_DEVELOPER_TOKEN!
  const res = await fetch(`${BASE_URL}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': devToken,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`listAccessibleCustomers failed ${res.status}: ${text}`)
  }
  const data = await res.json()
  return ((data.resourceNames || []) as string[]).map((r: string) =>
    r.replace('customers/', '')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Negative keywords (campaign-level + ad-group-level, not date-segmented)
// ─────────────────────────────────────────────────────────────────────────────

export interface GoogleAdsNegativeKeywordRawRow {
  campaign_id:   string
  campaign_name: string
  ad_group_id:   string | null   // null = campaign-level
  ad_group_name: string | null
  keyword_id:    string
  keyword_text:  string
  match_type:    string
  level:         'campaign' | 'adgroup'
}

/**
 * Fetch campaign-level and ad-group-level negative keywords.
 * Not date-segmented — returns the current active set.
 */
export async function fetchGoogleNegativeKeywords(
  externalId: string,
  auth: Record<string, unknown>,
  config: Record<string, unknown>
): Promise<GoogleAdsNegativeKeywordRawRow[]> {
  const refreshToken = auth.refresh_token as string | undefined
  const clientId     = auth.client_id     as string | undefined
  const clientSecret = auth.client_secret as string | undefined

  if (!auth.access_token && !refreshToken) return []

  let accessToken = auth.access_token as string | undefined
  if ((!accessToken || isExpiringSoon(auth.token_expires_at as string | undefined)) && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken, clientId, clientSecret)
    accessToken = refreshed.access_token
  }
  if (!accessToken) return []

  const mccId    = (config.mcc_customer_id as string | undefined) || externalId
  const devToken = (auth.developer_token   as string | undefined) || undefined

  const results: GoogleAdsNegativeKeywordRawRow[] = []

  // Campaign-level negatives
  try {
    const raw = await runQuery(
      externalId, mccId, accessToken,
      `SELECT
        campaign.id,
        campaign.name,
        campaign_criterion.criterion_id,
        campaign_criterion.keyword.text,
        campaign_criterion.keyword.match_type
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'KEYWORD'
        AND campaign_criterion.negative = true`,
      devToken
    )
    for (const row of raw) {
      const campaign  = row.campaign          as Record<string, unknown>
      const criterion = row.campaignCriterion as Record<string, unknown>
      const keyword   = criterion?.keyword    as Record<string, unknown> | undefined
      results.push({
        campaign_id:   String(campaign?.id              || ''),
        campaign_name: String(campaign?.name            || ''),
        ad_group_id:   null,
        ad_group_name: null,
        keyword_id:    String(criterion?.criterionId    || ''),
        keyword_text:  String(keyword?.text             || ''),
        match_type:    String(keyword?.matchType        || ''),
        level:         'campaign',
      })
    }
  } catch {
    // non-fatal
  }

  // Ad-group-level negatives
  try {
    const raw = await runQuery(
      externalId, mccId, accessToken,
      `SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.negative = true
        AND ad_group_criterion.status != 'REMOVED'`,
      devToken
    )
    for (const row of raw) {
      const campaign  = row.campaign          as Record<string, unknown>
      const adGroup   = row.adGroup           as Record<string, unknown>
      const criterion = row.adGroupCriterion  as Record<string, unknown>
      const keyword   = criterion?.keyword    as Record<string, unknown> | undefined
      results.push({
        campaign_id:   String(campaign?.id              || ''),
        campaign_name: String(campaign?.name            || ''),
        ad_group_id:   String(adGroup?.id               || '') || null,
        ad_group_name: String(adGroup?.name             || '') || null,
        keyword_id:    String(criterion?.criterionId    || ''),
        keyword_text:  String(keyword?.text             || ''),
        match_type:    String(keyword?.matchType        || ''),
        level:         'adgroup',
      })
    }
  } catch {
    // non-fatal
  }

  return results.filter(r => r.keyword_id && r.keyword_text)
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyword-level metrics (Search campaigns)
// ─────────────────────────────────────────────────────────────────────────────

export interface GoogleAdsKeywordRawRow {
  campaign_id:       string
  campaign_name:     string
  ad_group_id:       string
  ad_group_name:     string
  keyword_id:        string
  keyword_text:      string
  match_type:        string
  keyword_status:    string | null
  date:              string
  cost_micros:       number
  impressions:       number
  clicks:            number
  conversions:       number
  conversions_value: number
}

/**
 * Fetch keyword-level metrics for Search campaigns over a date range.
 * Only keywords with at least one impression in the range are returned.
 */
export async function fetchGoogleSearchKeywords(
  externalId: string,
  auth: Record<string, unknown>,
  config: Record<string, unknown>,
  dateFrom: string,
  dateTo: string
): Promise<GoogleAdsKeywordRawRow[]> {
  const refreshToken = auth.refresh_token as string | undefined
  const clientId     = auth.client_id     as string | undefined
  const clientSecret = auth.client_secret as string | undefined

  if (!auth.access_token && !refreshToken) return []

  let accessToken = auth.access_token as string | undefined
  if ((!accessToken || isExpiringSoon(auth.token_expires_at as string | undefined)) && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken, clientId, clientSecret)
    accessToken = refreshed.access_token
  }
  if (!accessToken) return []

  const mccId    = (config.mcc_customer_id as string | undefined) || externalId
  const devToken = (auth.developer_token   as string | undefined) || undefined

  const raw = await runQuery(
    externalId,
    mccId,
    accessToken,
    `SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status,
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM keyword_view
    WHERE ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status != 'REMOVED'
      AND metrics.impressions > 0
      AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
    ORDER BY segments.date DESC`,
    devToken
  )

  return raw.map(row => {
    const campaign  = row.campaign           as Record<string, unknown>
    const adGroup   = row.adGroup            as Record<string, unknown>
    const criterion = row.adGroupCriterion   as Record<string, unknown>
    const keyword   = criterion?.keyword     as Record<string, unknown> | undefined
    const metrics   = row.metrics            as Record<string, unknown>
    const segments  = row.segments           as Record<string, unknown>

    return {
      campaign_id:       String(campaign?.id              || ''),
      campaign_name:     String(campaign?.name            || ''),
      ad_group_id:       String(adGroup?.id               || ''),
      ad_group_name:     String(adGroup?.name             || ''),
      keyword_id:        String(criterion?.criterionId    || ''),
      keyword_text:      String(keyword?.text             || ''),
      match_type:        String(keyword?.matchType        || ''),
      keyword_status:    (criterion?.status as string)    ?? null,
      date:              String(segments?.date            || ''),
      cost_micros:       Number(metrics?.costMicros       || 0),
      impressions:       Number(metrics?.impressions      || 0),
      clicks:            Number(metrics?.clicks           || 0),
      conversions:       Number(metrics?.conversions      || 0),
      conversions_value: Number(metrics?.conversionsValue || 0),
    }
  }).filter(r => r.keyword_id && r.date)
}

// ─────────────────────────────────────────────────────────────────────────────
// Ad-level metrics fetch (for campaign drill-down)
// ─────────────────────────────────────────────────────────────────────────────

export interface GoogleAdsAdRawRow {
  campaign_id: string
  campaign_name: string
  ad_group_id: string
  ad_group_name: string
  ad_id: string
  ad_name: string
  ad_type: string
  // Creative
  headlines: string[]
  descriptions: string[]
  final_url: string | null
  image_url: string | null
  ad_strength: string | null
  ad_status: string | null
  // Performance
  date: string
  cost_micros: number
  impressions: number
  clicks: number
  conversions: number
  conversions_value: number
  all_conversions_value?: number
}

/**
 * Fetch ad-level metrics for a Google Ads account over a date range.
 * Called by the sync engine after campaign-level sync.
 */
export async function fetchGoogleAdMetrics(
  externalId: string,
  auth: Record<string, unknown>,
  config: Record<string, unknown>,
  dateFrom: string,
  dateTo: string
): Promise<GoogleAdsAdRawRow[]> {
  const refreshToken = auth.refresh_token as string | undefined
  const clientId     = auth.client_id     as string | undefined
  const clientSecret = auth.client_secret as string | undefined

  if (!auth.access_token && !refreshToken) return []

  let accessToken = auth.access_token as string | undefined
  if ((!accessToken || isExpiringSoon(auth.token_expires_at as string | undefined)) && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken, clientId, clientSecret)
    accessToken = refreshed.access_token
  }
  if (!accessToken) return []

  const token    = accessToken
  const mccId    = (config.mcc_customer_id as string | undefined) || externalId
  const devToken = (auth.developer_token as string | undefined) || undefined

  // Regular search/display/shopping ads via ad_group_ad (includes RSA and ETA copy)
  const rawAds = await runQuery(
    externalId,
    mccId,
    token,
    `SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.expanded_text_ad.headline_part1,
      ad_group_ad.ad.expanded_text_ad.headline_part2,
      ad_group_ad.ad.expanded_text_ad.headline_part3,
      ad_group_ad.ad.expanded_text_ad.description,
      ad_group_ad.ad.expanded_text_ad.description2,
      ad_group_ad.ad.demand_gen_multi_asset_ad.headlines,
      ad_group_ad.ad.demand_gen_multi_asset_ad.descriptions,
      ad_group_ad.ad.demand_gen_video_responsive_ad.headlines,
      ad_group_ad.ad.demand_gen_video_responsive_ad.descriptions,
      ad_group_ad.ad_strength,
      ad_group_ad.status,
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.all_conversions_value
    FROM ad_group_ad
    WHERE ad_group_ad.status != 'REMOVED'
      AND metrics.impressions > 0
      AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
    ORDER BY segments.date DESC`,
    devToken
  )

  const adRows: GoogleAdsAdRawRow[] = rawAds.map(row => {
    const campaign  = row.campaign   as Record<string, unknown>
    const adGroup   = row.adGroup    as Record<string, unknown>
    const adGroupAd = row.adGroupAd  as Record<string, unknown>
    const ad        = adGroupAd?.ad  as Record<string, unknown> | undefined
    const metrics   = row.metrics    as Record<string, unknown>
    const segments  = row.segments   as Record<string, unknown>
    const finalUrls = (ad?.finalUrls as string[] | undefined) ?? []

    // RSA headlines/descriptions
    const rsa          = ad?.responsiveSearchAd as Record<string, unknown> | undefined
    const rsaHeadlines = ((rsa?.headlines as Array<Record<string, unknown>>) ?? [])
      .map(h => String(h.text || '')).filter(Boolean)
    const rsaDescs     = ((rsa?.descriptions as Array<Record<string, unknown>>) ?? [])
      .map(d => String(d.text || '')).filter(Boolean)

    // ETA headlines/descriptions (legacy format)
    const eta = ad?.expandedTextAd as Record<string, unknown> | undefined
    const etaHeadlines = [eta?.headlinePart1, eta?.headlinePart2, eta?.headlinePart3]
      .filter(Boolean).map(String)
    const etaDescs = [eta?.description, eta?.description2].filter(Boolean).map(String)

    // Demand Gen multi-asset and video-responsive copy
    const dgm          = ad?.demandGenMultiAssetAd     as Record<string, unknown> | undefined
    const dgv          = ad?.demandGenVideoResponsiveAd as Record<string, unknown> | undefined
    const dgmHeadlines = ((dgm?.headlines as Array<Record<string, unknown>>) ?? [])
      .map(h => String(h.text || '')).filter(Boolean)
    const dgmDescs     = ((dgm?.descriptions as Array<Record<string, unknown>>) ?? [])
      .map(d => String(d.text || '')).filter(Boolean)
    const dgvHeadlines = ((dgv?.headlines as Array<Record<string, unknown>>) ?? [])
      .map(h => String(h.text || '')).filter(Boolean)
    const dgvDescs     = ((dgv?.descriptions as Array<Record<string, unknown>>) ?? [])
      .map(d => String(d.text || '')).filter(Boolean)

    const headlines    = rsaHeadlines.length > 0 ? rsaHeadlines
      : etaHeadlines.length > 0 ? etaHeadlines
      : dgmHeadlines.length > 0 ? dgmHeadlines
      : dgvHeadlines
    const descriptions = rsaDescs.length > 0 ? rsaDescs
      : etaDescs.length > 0 ? etaDescs
      : dgmDescs.length > 0 ? dgmDescs
      : dgvDescs

    return {
      campaign_id:       String(campaign?.id              || ''),
      campaign_name:     String(campaign?.name            || ''),
      ad_group_id:       String(adGroup?.id               || ''),
      ad_group_name:     String(adGroup?.name             || ''),
      ad_id:             String(ad?.id                    || ''),
      ad_name:           String(ad?.name                  || ''),
      ad_type:           String(ad?.type                  || ''),
      headlines,
      descriptions,
      final_url:         finalUrls[0] ?? null,
      image_url:         null,
      ad_strength:       (adGroupAd?.adStrength as string | undefined) ?? null,
      ad_status:         (adGroupAd?.status     as string | undefined) ?? null,
      date:              String(segments?.date            || ''),
      cost_micros:       Number(metrics?.costMicros       || 0),
      impressions:       Number(metrics?.impressions      || 0),
      clicks:            Number(metrics?.clicks           || 0),
      conversions:           Number(metrics?.conversions         || 0),
      conversions_value:     Number(metrics?.conversionsValue    || 0),
      all_conversions_value: Number(metrics?.allConversionsValue || 0),
    }
  })

  // Performance Max asset groups — separate resource, same output shape.
  // ad_id = ad_group_id = asset_group.id so they aggregate naturally in the UI.
  let assetGroupRows: GoogleAdsAdRawRow[] = []
  try {
    const rawAssets = await runQuery(
      externalId,
      mccId,
      token,
      `SELECT
        campaign.id,
        campaign.name,
        asset_group.id,
        asset_group.name,
        asset_group.status,
        asset_group.ad_strength,
        segments.date,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        metrics.conversions_value,
        metrics.all_conversions_value
      FROM asset_group
      WHERE metrics.impressions > 0
        AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      ORDER BY segments.date DESC`,
      devToken
    )
    assetGroupRows = rawAssets.map(row => {
      const campaign    = row.campaign    as Record<string, unknown>
      const assetGroup  = row.assetGroup  as Record<string, unknown>
      const metrics     = row.metrics     as Record<string, unknown>
      const segments    = row.segments    as Record<string, unknown>
      const agId        = String(assetGroup?.id   || '')
      return {
        campaign_id:       String(campaign?.id              || ''),
        campaign_name:     String(campaign?.name            || ''),
        ad_group_id:       agId,
        ad_group_name:     String(assetGroup?.name          || ''),
        ad_id:             agId,
        ad_name:           String(assetGroup?.name          || ''),
        ad_type:           'ASSET_GROUP',
        headlines:         [],
        descriptions:      [],
        final_url:         null,
        image_url:         null,
        ad_strength:       (assetGroup?.adStrength as string | undefined) ?? null,
        ad_status:         (assetGroup?.status     as string | undefined) ?? null,
        date:              String(segments?.date            || ''),
        cost_micros:       Number(metrics?.costMicros       || 0),
        impressions:       Number(metrics?.impressions      || 0),
        clicks:            Number(metrics?.clicks           || 0),
        conversions:           Number(metrics?.conversions         || 0),
        conversions_value:     Number(metrics?.conversionsValue    || 0),
        all_conversions_value: Number(metrics?.allConversionsValue || 0),
      }
    })
  } catch {
    // asset_group query may fail for accounts with no pMax campaigns — non-fatal
  }

  return [...adRows, ...assetGroupRows]
}

// ─────────────────────────────────────────────────────────────────────────────
// pMax asset group assets
// ─────────────────────────────────────────────────────────────────────────────

export type GooglePMaxAssetRawRow = {
  campaign_id:      string
  campaign_name:    string
  asset_group_id:   string
  asset_group_name: string
  asset_id:         string
  field_type:       string
  text_content:     string | null
  image_url:        string | null
  video_id:         string | null
}

/**
 * Fetch all creative assets for Performance Max asset groups.
 * Not date-segmented — returns the current active asset set.
 * Called by the sync engine alongside fetchGoogleAdMetrics.
 */
export async function fetchGooglePMaxAssets(
  externalId: string,
  auth: Record<string, unknown>,
  config: Record<string, unknown>
): Promise<GooglePMaxAssetRawRow[]> {
  const refreshToken = auth.refresh_token as string | undefined
  const clientId     = auth.client_id     as string | undefined
  const clientSecret = auth.client_secret as string | undefined

  if (!auth.access_token && !refreshToken) return []

  let accessToken = auth.access_token as string | undefined
  if ((!accessToken || isExpiringSoon(auth.token_expires_at as string | undefined)) && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken, clientId, clientSecret)
    accessToken = refreshed.access_token
  }
  if (!accessToken) return []

  const mccId    = (config.mcc_customer_id as string | undefined) || externalId
  const devToken = (auth.developer_token   as string | undefined) || undefined

  const raw = await runQuery(
    externalId,
    mccId,
    accessToken,
    `SELECT
      campaign.id,
      campaign.name,
      asset_group.id,
      asset_group.name,
      asset_group_asset.field_type,
      asset.id,
      asset.image_asset.full_size.url,
      asset.text_asset.text,
      asset.youtube_video_asset.youtube_video_id
    FROM asset_group_asset
    WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
      AND asset_group_asset.status != 'REMOVED'`,
    devToken
  )

  return raw
    .map(row => {
      const campaign        = row.campaign       as Record<string, unknown>
      const assetGroup      = row.assetGroup     as Record<string, unknown>
      const assetGroupAsset = row.assetGroupAsset as Record<string, unknown>
      const asset           = row.asset          as Record<string, unknown>
      const imageAsset      = asset?.imageAsset  as Record<string, unknown> | undefined
      const fullSize        = imageAsset?.fullSize as Record<string, unknown> | undefined
      const textAsset       = asset?.textAsset   as Record<string, unknown> | undefined
      const videoAsset      = asset?.youtubeVideoAsset as Record<string, unknown> | undefined

      return {
        campaign_id:      String(campaign?.id           || ''),
        campaign_name:    String(campaign?.name         || ''),
        asset_group_id:   String(assetGroup?.id         || ''),
        asset_group_name: String(assetGroup?.name       || ''),
        asset_id:         String(asset?.id              || ''),
        field_type:       String(assetGroupAsset?.fieldType || ''),
        text_content:     (textAsset?.text    as string) || null,
        image_url:        (fullSize?.url      as string) || null,
        video_id:         (videoAsset?.youtubeVideoId as string) || null,
      }
    })
    .filter(r => r.asset_group_id && r.asset_id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector adapter implementation
// ─────────────────────────────────────────────────────────────────────────────

export const googleAdsConnector: ConnectorAdapter = {
  type: 'google_ads',

  async refreshAuth(auth: Record<string, unknown>) {
    const refreshToken  = auth.refresh_token  as string | undefined
    if (!refreshToken) return null

    const expiresAt = auth.token_expires_at as string | undefined
    if (!isExpiringSoon(expiresAt)) return null

    const clientId     = auth.client_id     as string | undefined
    const clientSecret = auth.client_secret as string | undefined
    const { access_token, expires_in } = await refreshAccessToken(refreshToken, clientId, clientSecret)
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
    const refreshToken  = auth.refresh_token  as string | undefined
    const clientId      = auth.client_id      as string | undefined
    const clientSecret  = auth.client_secret  as string | undefined

    // No credentials at all → MCC Script push mode, skip pull sync.
    if (!auth.access_token && !refreshToken) {
      return { rows: [] }
    }

    // Resolve access token — refresh if expired or missing
    let accessToken = auth.access_token as string | undefined
    if ((!accessToken || isExpiringSoon(auth.token_expires_at as string | undefined)) && refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken, clientId, clientSecret)
      accessToken = refreshed.access_token
    }

    if (!accessToken) return { rows: [] }

    const token    = accessToken
    const mccId    = (config.mcc_customer_id as string | undefined) || externalId
    const devToken = (auth.developer_token as string | undefined) || undefined

    const raw = await runQuery(
      externalId,
      mccId,
      token,
      `SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign_budget.amount_micros,
        segments.date,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        metrics.conversions_value,
        metrics.all_conversions_value,
        metrics.view_through_conversions,
        metrics.search_impression_share,
        metrics.search_absolute_top_impression_share,
        metrics.search_top_impression_share
      FROM campaign
      WHERE campaign.status != 'REMOVED'
        AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      ORDER BY segments.date DESC`,
      devToken
    )

    const rows: GoogleAdsRawRow[] = raw.map(row => {
      const campaign       = row.campaign       as Record<string, unknown>
      const campaignBudget = row.campaignBudget as Record<string, unknown> | null | undefined
      const metrics        = row.metrics        as Record<string, unknown>
      const segments       = row.segments       as Record<string, unknown>

      // Impression share is only meaningful for Search campaigns and comes back
      // as a decimal (0–1). The API returns a special sentinel value > 1 when
      // the metric is unavailable (e.g. for Display/Video/PMax). Store null.
      const rawImprShare    = metrics?.searchImpressionShare != null ? Number(metrics.searchImpressionShare) : null
      const rawAbsTop       = metrics?.searchAbsoluteTopImpressionShare != null ? Number(metrics.searchAbsoluteTopImpressionShare) : null
      const rawTopImpr      = metrics?.searchTopImpressionShare != null ? Number(metrics.searchTopImpressionShare) : null
      const safeIS  = (v: number | null) => (v !== null && v <= 1) ? v : null

      return {
        campaign_id:              String(campaign?.id    || ''),
        campaign_name:            String(campaign?.name  || ''),
        campaign_status:          String(campaign?.status || ''),
        campaign_type:            String(campaign?.advertisingChannelType || ''),
        date:                     String(segments?.date  || ''),
        cost_micros:              Number(metrics?.costMicros              || 0),
        daily_budget_micros:      Number(campaignBudget?.amountMicros    || 0),
        impressions:              Number(metrics?.impressions             || 0),
        clicks:                   Number(metrics?.clicks                  || 0),
        conversions:              Number(metrics?.conversions             || 0),
        conversions_value:        Number(metrics?.conversionsValue        || 0),
        all_conversions_value:    Number(metrics?.allConversionsValue     || 0),
        view_through_conversions: Number(metrics?.viewThroughConversions  || 0),
        search_impression_share:         safeIS(rawImprShare),
        search_abs_top_impression_share: safeIS(rawAbsTop),
        search_top_impression_share:     safeIS(rawTopImpr),
      }
    })

    return { rows }
  },

  async discoverAccounts(
    auth:   Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<DiscoveredAccount[]> {
    const refreshToken = auth.refresh_token as string | undefined
    const clientId     = auth.client_id     as string | undefined
    const clientSecret = auth.client_secret as string | undefined

    let accessToken = auth.access_token as string | undefined
    if ((!accessToken || isExpiringSoon(auth.token_expires_at as string | undefined)) && refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken, clientId, clientSecret)
      accessToken = refreshed.access_token
    }
    if (!accessToken) return []

    const devToken = (auth.developer_token as string | undefined) || undefined
    const mccId    = (config.mcc_customer_id as string | undefined)?.replace(/-/g, '')

    // If we have an MCC ID, query customer_client to get real account names
    if (mccId) {
      try {
        const rows = await runQuery(
          mccId,
          mccId,
          accessToken,
          `SELECT
            customer_client.id,
            customer_client.descriptive_name,
            customer_client.currency_code,
            customer_client.manager,
            customer_client.test_account
          FROM customer_client
          WHERE customer_client.manager = FALSE
            AND customer_client.status = 'ENABLED'`,
          devToken
        )
        const accounts = rows.map(row => {
          const cc = row.customer_client as Record<string, unknown>
          return {
            external_id:   String(cc?.id               || ''),
            external_name: String(cc?.descriptiveName  || cc?.id || ''),
            metadata: {
              currency:   cc?.currencyCode,
              is_manager: cc?.manager,
              is_test:    cc?.testAccount,
            },
          }
        }).filter(a => a.external_id)
        if (accounts.length > 0) return accounts
      } catch (e) {
        console.warn('Google customer_client query failed, falling back:', e)
      }
    }

    // Fallback: list accessible customers (no names)
    // Throws with detail if the API is not enabled or token is invalid
    const customerIds = await listAccessibleCustomers(accessToken, devToken)
    return customerIds.map(id => ({
      external_id:   id,
      external_name: `Google Ads Account (${id})`,
    }))
  },

  async testConnection(auth: Record<string, unknown>): Promise<boolean> {
    try {
      const refreshToken = auth.refresh_token as string | undefined
      const clientId     = auth.client_id     as string | undefined
      const clientSecret = auth.client_secret as string | undefined

      let accessToken = auth.access_token as string | undefined
      if ((!accessToken || isExpiringSoon(auth.token_expires_at as string | undefined)) && refreshToken) {
        const refreshed = await refreshAccessToken(refreshToken, clientId, clientSecret)
        accessToken = refreshed.access_token
      }
      if (!accessToken) return false

      const devToken = (auth.developer_token as string | undefined) || undefined
      const customers = await listAccessibleCustomers(accessToken, devToken)
      return customers.length >= 0
    } catch {
      return false
    }
  },
}
