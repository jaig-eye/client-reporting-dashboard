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
  if (!llRes.ok || llData.error) {
    console.warn('Meta long-lived token exchange failed:', llData.error ?? llRes.status, '— falling back to short-lived token')
    return { access_token: String(data.access_token) }
  }
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
  adset_daily_budget: number | null  // ABO adset budget; null for CBO campaigns
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Fetch a Meta Insights URL with up to maxRetries retries on rate-limit errors (codes 17, 32, 613). */
async function metaFetchWithRetry(url: string, maxRetries = 4): Promise<Record<string, unknown>> {
  let delay = 10_000 // 10 s initial back-off
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url)
    if (res.ok) {
      const json = await res.json() as Record<string, unknown>
      if (json.error) {
        const e    = json.error as Record<string, unknown>
        const code = Number(e.code ?? 0)
        const msg  = String(e.message ?? 'Unknown Meta API error')
        // BUC rate-limit codes can arrive inside HTTP 200 responses
        const isRateLimit = code === 17 || code === 32 || code === 613
        if (isRateLimit && attempt < maxRetries) {
          await sleep(delay)
          delay = Math.min(delay * 2, 60_000)
          continue
        }
        throw new Error(`Meta API error (code ${code}): ${msg}`)
      }
      return json
    }
    const text = await res.text()
    // Meta rate-limit codes: 17 (user request limit), 32 (page throttle), 613 (insights limit)
    const isRateLimit = res.status === 400 || res.status === 429
    const hasRateLimitCode = /\"code\":\s*(17|32|613)\b/.test(text)
    if ((isRateLimit || hasRateLimitCode) && attempt < maxRetries) {
      await sleep(delay)
      delay = Math.min(delay * 2, 60_000) // cap at 60 s
      continue
    }
    throw new Error(`Meta API error ${res.status}: ${text}`)
  }
  throw new Error('Meta API: max retries exceeded')
}

/** Split a date range into chunks of at most maxDays each. */
function chunkDateRange(from: string, to: string, maxDays: number): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = []
  let cur = new Date(from)
  const end = new Date(to)
  while (cur <= end) {
    const chunkEnd = new Date(cur)
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1)
    if (chunkEnd > end) chunkEnd.setTime(end.getTime())
    chunks.push({ from: cur.toISOString().split('T')[0], to: chunkEnd.toISOString().split('T')[0] })
    cur = new Date(chunkEnd)
    cur.setDate(cur.getDate() + 1)
  }
  return chunks
}

/**
 * Fetch ad-level metrics for a Meta ad account over a date range.
 * Includes thumbnail_url fetched from the creative API in a batch request.
 */
export async function fetchMetaAdMetrics(
  externalId: string,
  auth: Record<string, unknown>,
  dateFrom: string,
  dateTo: string,
  onRawRowsReady?: (rows: MetaAdRawRow[]) => Promise<void>
): Promise<MetaAdRawRow[]> {
  const accessToken = resolveToken(auth)
  if (!accessToken) return []

  const rows: MetaAdRawRow[] = []

  // Collect all ad_ids so we can batch-fetch creative assets once at the end
  const adIdSet = new Set<string>()
  const rawRows: (Omit<MetaAdRawRow, 'thumbnail_url' | 'image_url' | 'video_id' | 'video_thumb_url' | 'creative_body' | 'creative_title' | 'creative_link_url' | 'ad_status'>)[] = []

  const adFields = [
    'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
    'ad_id', 'ad_name', 'spend', 'impressions', 'clicks',
    'reach', 'actions', 'action_values',
  ].join(',')

  // Ad-level data is much denser than campaign-level (N ads × N days).
  // 365-day chunks trigger Meta's HTTP 500 "please reduce data" error.
  // 60-day chunks (12 per 730-day backfill) stay within Meta's tolerance;
  // metaFetchWithRetry handles BUC rate limits (17/32/613) per chunk.
  const rawApiRows: Record<string, unknown>[] = []
  const adChunks = chunkDateRange(dateFrom, dateTo, 60)
  for (let ci = 0; ci < adChunks.length; ci++) {
    const chunk = adChunks[ci]
    const adBase = new URL(`${BASE_URL}/${externalId}/insights`)
    adBase.searchParams.set('access_token',   accessToken)
    adBase.searchParams.set('level',          'ad')
    adBase.searchParams.set('fields',         adFields)
    adBase.searchParams.set('time_range',     JSON.stringify({ since: chunk.from, until: chunk.to }))
    adBase.searchParams.set('time_increment', '1')
    adBase.searchParams.set('limit',          '500')
    adBase.searchParams.set('filtering', JSON.stringify([{
      field: 'campaign.effective_status', operator: 'IN',
      value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED'],
    }]))
    let pageNum = 0
    let adNextUrl: string | null = adBase.toString()
    while (adNextUrl) {
      const data = await metaFetchWithRetry(adNextUrl)
      const page = (data.data || []) as Record<string, unknown>[]
      pageNum++
      const d = page.map(r => String(r.date_start || '')).filter(Boolean)
      console.log(`[meta] fetchMetaAdMetrics chunk ${ci+1}/${adChunks.length} (${chunk.from}–${chunk.to}) page ${pageNum}: ${page.length} rows, dates ${d[0]??'-'}→${d[d.length-1]??'-'}, has_next=${!!(data.paging as Record<string,unknown>|undefined)?.next}`)
      rawApiRows.push(...page)
      const paging = data.paging as Record<string, unknown> | undefined
      adNextUrl = (typeof paging?.next === 'string' && paging.next) ? paging.next : null
    }
    console.log(`[meta] fetchMetaAdMetrics chunk ${ci+1} done: ${rawApiRows.length} total rows so far`)
  }

  // Backfill adset names from the Adsets API — the Insights API occasionally omits
  // adset_name even when requested, particularly for some ad types/configurations.
  const adsetNameMap = new Map<string, string>()
  try {
    let adsetNextUrl: string | null = new URL(`${BASE_URL}/${externalId}/adsets`, 'https://graph.facebook.com').toString()
    adsetNextUrl += `?fields=id%2Cname&limit=500&access_token=${encodeURIComponent(accessToken)}`
    while (adsetNextUrl) {
      const adsetData = await metaFetchWithRetry(adsetNextUrl)
      for (const s of (adsetData.data || []) as Record<string, unknown>[]) {
        if (s.id && s.name) adsetNameMap.set(String(s.id), String(s.name))
      }
      const pg = adsetData.paging as Record<string, unknown> | undefined
      adsetNextUrl = typeof pg?.next === 'string' ? pg.next : null
    }
    console.log(`[meta] fetchMetaAdMetrics: fetched ${adsetNameMap.size} adset names for backfill`)
  } catch (e) {
    console.warn('[meta] adset name backfill failed (non-fatal):', e)
  }

  for (const day of rawApiRows) {
    const rawActions      = (day.actions       || []) as Record<string, unknown>[]
    const rawActionValues = (day.action_values  || []) as Record<string, unknown>[]
    const actions      = rawActions.map(a => ({ action_type: String(a.action_type || ''), value: String(a.value || '0') }))
    const actionValues = rawActionValues.map(a => ({ action_type: String(a.action_type || ''), value: String(a.value || '0') }))
    const adId = String(day.ad_id || '')
    if (adId) adIdSet.add(adId)
    const adsetId   = String(day.adset_id   || '')
    const adsetName = String(day.adset_name || '') || (adsetNameMap.get(adsetId) ?? '')
    rawRows.push({
      campaign_id:      String(day.campaign_id   || ''),
      campaign_name:    String(day.campaign_name || ''),
      adset_id:         adsetId,
      adset_name:       adsetName,
      ad_id:            adId,
      ad_name:          String(day.ad_name       || ''),
      date:             String(day.date_start    || ''),
      spend:            parseFloat(String(day.spend       || '0')),
      impressions:      parseInt(  String(day.impressions || '0'), 10),
      clicks:           parseInt(  String(day.clicks      || '0'), 10),
      reach:            parseInt(  String(day.reach       || '0'), 10),
      actions,
      action_values:      actionValues,
      conversions:        actions.reduce((s, a) => s + parseFloat(a.value || '0'), 0),
      conversion_value:   actionValues.reduce((s, a) => s + parseFloat(a.value || '0'), 0),
      adset_daily_budget: null,  // populated later after adset API fetch
    })
  }

  // Upsert raw insight rows immediately so spend/clicks data is persisted even if
  // the creative fetch below times out or errors on large accounts.
  if (onRawRowsReady && rawRows.length > 0) {
    const rawWithEmptyCreatives: MetaAdRawRow[] = rawRows.map(r => ({
      ...r,
      thumbnail_url:      '',
      image_url:          '',
      video_id:           '',
      video_thumb_url:    '',
      creative_body:      '',
      creative_title:     '',
      creative_link_url:  '',
      ad_status:          '',
      adset_daily_budget: null,
    }))
    await onRawRowsReady(rawWithEmptyCreatives).catch(e =>
      console.error('[meta] onRawRowsReady failed (non-fatal):', e)
    )
  }

  // Batch-fetch creative assets for all unique ad_ids (once across all chunks).
  // Wrapped defensively — fetchAdCreatives has internal try/catches per batch but
  // we guard the call site too in case of unexpected failures (network timeout, etc.).
  let creativeMap: Record<string, Partial<AdCreativeData>> = {}
  try {
    creativeMap = await fetchAdCreatives(Array.from(adIdSet), accessToken)
  } catch (e) {
    console.error('[meta] fetchAdCreatives failed (non-fatal, continuing without creatives):', e)
  }

  // Fetch per-adset budgets so ABO ad rows carry their adset's own daily budget.
  // CBO adsets have no adset-level budget (daily_budget=0); those stay null.
  // Must include 'id' in fields — without it adset.id is undefined and the map
  // is built with empty-string keys, making every lookup return null.
  const adsetBudgetById = new Map<string, number>()
  try {
    const adsetData = await metaGet(`/${externalId}/adsets`, accessToken, { fields: 'id,daily_budget', limit: '500' })
    const adsetRows = (adsetData.data || []) as Record<string, unknown>[]
    for (const adset of adsetRows) {
      const aid    = String(adset.id || '')
      const budget = Number(adset.daily_budget || 0) / 100
      if (aid && budget > 0) adsetBudgetById.set(aid, budget)
    }
    console.log(`[meta] adset budget fetch: ${adsetBudgetById.size} adsets with budget out of ${adsetRows.length} total`)
  } catch (e) {
    console.error('[meta] adset budget fetch failed (non-fatal, adset_daily_budget will be null):', e)
  }

  // Merge creative data and adset budgets into final rows
  for (const row of rawRows) {
    const creative = creativeMap[row.ad_id] ?? {}
    rows.push({
      ...row,
      thumbnail_url:      creative.thumbnail_url     ?? '',
      image_url:          creative.image_url         ?? '',
      video_id:           creative.video_id          ?? '',
      video_thumb_url:    creative.video_thumb_url   ?? '',
      creative_body:      creative.creative_body     ?? '',
      creative_title:     creative.creative_title    ?? '',
      creative_link_url:  creative.creative_link_url ?? '',
      ad_status:          creative.ad_status         ?? '',
      adset_daily_budget: adsetBudgetById.get(row.adset_id) ?? null,
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

  // Ads that have a Facebook post backing them — query the post for full text + image
  const needsPostData:    Array<{ adId: string; postId: string }> = []
  // Ads with no real image — fetch creative thumbnail at 720px via a direct creative call
  const needsLargerThumb: Array<{ adId: string; creativeId: string }> = []

  // ── Pass 1: batch-fetch creative data for all ad IDs ─────────────────────
  for (let i = 0; i < adIds.length; i += 50) {
    const batch = adIds.slice(i, i + 50)
    try {
      const creativeFields = [
        'id',                              // needed for pass-3 thumbnail upgrade
        'effective_object_story_id',       // backing FB/IG post — best source of text + full image
        'image_url',
        'thumbnail_url',
        'video_id',
        'body',
        'title',
        'link_url',
        'object_story_spec',
        'asset_feed_spec{bodies,titles}',
      ].join(',')

      const batchRequests = batch.map(adId => ({
        method: 'GET',
        relative_url: `${adId}?fields=effective_status,creative{${creativeFields}}`,
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

          const creativeId      = (creative?.id                       as string | undefined) ?? ''
          const effectivePostId = (creative?.effective_object_story_id as string | undefined) ?? ''
          const imageUrl        = (creative?.image_url                 as string | undefined) ?? ''
          const thumbUrl        = (creative?.thumbnail_url             as string | undefined) ?? ''
          const videoId         = (creative?.video_id                  as string | undefined) ?? ''
          const videoThumb      = videoId ? thumbUrl : ''

          // Extract text from object_story_spec fallback paths
          const oss       = creative?.object_story_spec as Record<string, Record<string, string>> | undefined
          const linkData  = oss?.link_data
          const videoData = oss?.video_data
          const afs       = creative?.asset_feed_spec as { bodies?: Array<{ text?: string }>; titles?: Array<{ text?: string }> } | undefined

          const resolvedBody  = (creative?.body  as string | undefined)
                             || linkData?.message
                             || videoData?.message
                             || afs?.bodies?.[0]?.text
                             || ''

          const resolvedTitle = (creative?.title as string | undefined)
                             || linkData?.name
                             || videoData?.title
                             || afs?.titles?.[0]?.text
                             || ''

          const ossImage = linkData?.picture ?? ''
          const hasRealImage = !!(imageUrl || ossImage)

          result[adId] = {
            image_url:         imageUrl || ossImage || (!videoId ? thumbUrl : ''),
            thumbnail_url:     thumbUrl,
            video_id:          videoId,
            video_thumb_url:   videoThumb,
            creative_body:     resolvedBody,
            creative_title:    resolvedTitle,
            creative_link_url: (creative?.link_url as string | undefined) ?? linkData?.link ?? '',
            ad_status:         (body.effective_status as string | undefined) ?? '',
          }

          // Queue for subsequent passes
          if (effectivePostId) {
            needsPostData.push({ adId, postId: effectivePostId })
          } else if (creativeId && !hasRealImage) {
            needsLargerThumb.push({ adId, creativeId })
          }
        } catch {
          // ignore parse errors for individual ads
        }
      }
    } catch {
      // ignore batch errors — creatives are best-effort
    }
  }

  // ── Pass 2: fetch backing Facebook post for full text + high-res image ────
  // effective_object_story_id points to the FB/IG post that powers the ad.
  // Posts reliably expose `message` (primary text) and `full_picture` (high-res).
  for (let i = 0; i < needsPostData.length; i += 50) {
    const slice = needsPostData.slice(i, i + 50)
    try {
      const batchRequests = slice.map(({ postId }) => ({
        method: 'GET',
        relative_url: `${postId}?fields=message,story,full_picture`,
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
          const data        = JSON.parse(item.body as string) as Record<string, unknown>
          const { adId }    = slice[j]
          const fullPicture = data.full_picture as string | undefined
          const message     = (data.message as string | undefined) || (data.story as string | undefined)

          if (fullPicture && result[adId]) result[adId].image_url = fullPicture
          if (message    && result[adId] && !result[adId].creative_body) {
            result[adId].creative_body = message
          }
          // If the post had a good image, no need for the thumb-upgrade pass
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  // ── Pass 3: upgrade thumbnail to 720 px for ads still without a real image ─
  for (let i = 0; i < needsLargerThumb.length; i += 50) {
    const slice = needsLargerThumb.slice(i, i + 50)
    try {
      const batchRequests = slice.map(({ creativeId }) => ({
        method: 'GET',
        relative_url: `${creativeId}?fields=thumbnail_url&thumbnail_width=1080&thumbnail_height=1080`,
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
          const data       = JSON.parse(item.body as string) as Record<string, unknown>
          const largeThumb = data.thumbnail_url as string | undefined
          const { adId }   = slice[j]
          if (largeThumb && result[adId]) result[adId].image_url = largeThumb
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
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
    dateTo: string,
    onProgress?: (pct: number, note: string) => void
  ): Promise<SyncResult> {
    const accessToken = resolveToken(auth)

    if (!accessToken) {
      return { rows: [], error: 'No Meta access token — check connector credentials.' }
    }

    const rows: MetaAdsRawRow[] = []
    const discoveredActions = new Set<string>()

    const campaignFields = [
      'campaign_id', 'campaign_name', 'objective',
      'spend', 'impressions', 'clicks', 'reach', 'frequency',
      'actions', 'action_values',
    ].join(',')

    // Chunk into 365-day windows — Meta silently truncates single GET requests
    // spanning > ~1 year, causing the "missing recent year" symptom (1,019 rows
    // for a 730-day backfill). Two chunks = 2 BUC charges, no rate-limit storm.
    if (onProgress) onProgress(5, 'Fetching insights…')
    const rawDayRows: Record<string, unknown>[] = []
    const camChunks = chunkDateRange(dateFrom, dateTo, 365)
    for (let ci = 0; ci < camChunks.length; ci++) {
      const chunk = camChunks[ci]
      const base = new URL(`${BASE_URL}/${externalId}/insights`)
      base.searchParams.set('access_token',   accessToken)
      base.searchParams.set('level',          'campaign')
      base.searchParams.set('fields',         campaignFields)
      base.searchParams.set('time_range',     JSON.stringify({ since: chunk.from, until: chunk.to }))
      base.searchParams.set('time_increment', '1')
      base.searchParams.set('limit',          '500')
      let pageNum = 0
      let nextUrl: string | null = base.toString()
      while (nextUrl) {
        const data = await metaFetchWithRetry(nextUrl)
        const page = (data.data || []) as Record<string, unknown>[]
        pageNum++
        const d = page.map(r => String(r.date_start || '')).filter(Boolean)
        console.log(`[meta] fetchMetrics chunk ${ci+1}/${camChunks.length} (${chunk.from}–${chunk.to}) page ${pageNum}: ${page.length} rows, dates ${d[0]??'-'}→${d[d.length-1]??'-'}, has_next=${!!(data.paging as Record<string,unknown>|undefined)?.next}`)
        rawDayRows.push(...page)
        if (onProgress && rawDayRows.length > 0) {
          onProgress(Math.min(85, 10 + Math.floor(rawDayRows.length / 15)), `Fetching insights… ${rawDayRows.length} rows`)
        }
        const paging = data.paging as Record<string, unknown> | undefined
        nextUrl = (typeof paging?.next === 'string' && paging.next) ? paging.next : null
      }
      console.log(`[meta] fetchMetrics chunk ${ci+1} done: ${rawDayRows.length} total rows so far`)
    }

    for (const day of rawDayRows) {
      const rawActions      = (day.actions       || []) as Record<string, unknown>[]
      const rawActionValues = (day.action_values  || []) as Record<string, unknown>[]

      for (const a of rawActions) {
        const t = String(a.action_type || '')
        if (t) discoveredActions.add(t)
      }

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
        actions: rawActions.map(a => ({
          action_type: String(a.action_type || ''),
          value:       String(a.value       || '0'),
        })),
        action_values: rawActionValues.map(a => ({
          action_type: String(a.action_type || ''),
          value:       String(a.value       || '0'),
        })),
      })
    }

    if (onProgress) onProgress(95, 'Fetching budgets & statuses…')

    // Fetch campaign daily budgets and effective_status from the Campaigns API
    // (neither field is available in the Insights API)
    const budgetMap = new Map<string, number>() // CBO: campaign-level budget
    const statusMap = new Map<string, string>()
    const nameMap   = new Map<string, string>()
    const adsetBudgetMap = new Map<string, number>() // ABO: sum of active adset budgets per campaign
    let allCampaignList: Record<string, unknown>[] = []
    try {
      const [campData, adsetData] = await Promise.all([
        metaGet(`/${externalId}/campaigns`, accessToken, {
          fields: 'id,name,daily_budget,effective_status,objective',
          limit: '500',
        }),
        metaGet(`/${externalId}/adsets`, accessToken, {
          // Use `status` (adset's own configured state) not `effective_status`.
          // effective_status inherits from parent: when a campaign is paused, all adsets
          // show CAMPAIGN_PAUSED even if their own budgets are configured and ready to run.
          // Using status=ACTIVE gives the correct "allocated budget" regardless of parent state.
          fields: 'campaign_id,daily_budget,status',
          limit: '500',
        }),
      ])
      allCampaignList = (campData.data || []) as Record<string, unknown>[]
      for (const camp of allCampaignList) {
        const cid    = String(camp.id || '')
        const budget = Number(camp.daily_budget || 0) / 100  // cents → account currency
        const status = String(camp.effective_status || '')
        const name   = String(camp.name || '')
        if (cid) {
          if (budget > 0) budgetMap.set(cid, budget)
          if (status)     statusMap.set(cid, status)
          if (name)       nameMap.set(cid, name)
        }
      }
      // For ABO campaigns (no campaign-level budget), sum adset budgets.
      // Filter by adset's own `status` (not effective_status) so the sum reflects
      // configured allocation even when the parent campaign is paused.
      for (const adset of (adsetData.data || []) as Record<string, unknown>[]) {
        const cid    = String(adset.campaign_id || '')
        const budget = Number(adset.daily_budget || 0) / 100
        const status = String(adset.status || '')
        if (cid && budget > 0 && status === 'ACTIVE') {
          adsetBudgetMap.set(cid, (adsetBudgetMap.get(cid) ?? 0) + budget)
        }
      }
    } catch {
      // best-effort — budget/status stays undefined if unavailable
    }

    // Enrich rows: prefer CBO campaign budget, fall back to sum of active adset budgets
    for (const row of rows) {
      const budget = budgetMap.get(row.campaign_id) ?? adsetBudgetMap.get(row.campaign_id)
      const status = statusMap.get(row.campaign_id)
      if (budget !== undefined) row.daily_budget    = budget
      if (status !== undefined) row.campaign_status = status
    }

    // Add $0 stub rows for PAUSED/active campaigns with no activity in the sync window.
    // This allows clients to see their full campaign setup even for campaigns not yet spending.
    if (allCampaignList.length > 0) {
      const insightIds = new Set(rows.map(r => r.campaign_id).filter(Boolean))
      for (const camp of allCampaignList) {
        const campId = String(camp.id || '')
        const status = String(camp.effective_status || '')
        if (!campId || insightIds.has(campId)) continue
        if (status === 'DELETED' || status === 'ARCHIVED') continue
        rows.push({
          campaign_id:     campId,
          campaign_name:   String(camp.name || ''),
          campaign_status: status,
          objective:       String(camp.objective || ''),
          date:         dateTo,
          spend:        0, impressions: 0, clicks: 0, reach: 0, frequency: 0,
          actions: [], action_values: [],
          daily_budget: budgetMap.get(campId) ?? adsetBudgetMap.get(campId),
        })
      }
    }

    if (onProgress) onProgress(75, 'Campaign insights ready')

    const totalSpend = rows.reduce((s, r) => s + (r.spend ?? 0), 0)
    console.log(`[meta] fetchMetrics returning ${rows.length} rows, total spend=$${totalSpend.toFixed(2)}`)

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

// ─────────────────────────────────────────────────────────────────────────────
// Campaign pause / resume (used by auto-pause-ads cron)
// ─────────────────────────────────────────────────────────────────────────────

async function metaPost(
  path: string,
  accessToken: string,
  body: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = `${BASE_URL}${path}`
  const params = new URLSearchParams({ access_token: accessToken, ...body })
  const res = await fetch(url, { method: 'POST', body: params })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meta API POST error ${res.status}: ${text}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

export async function pauseMetaCampaigns(
  externalId: string,
  auth: Record<string, unknown>
): Promise<{ paused: number; campaignIds: string[]; campaignNames: string[]; error?: string }> {
  try {
    const accessToken = resolveToken(auth)
    if (!accessToken) return { paused: 0, campaignIds: [], campaignNames: [], error: 'No access token' }

    const acctId = externalId.startsWith('act_') ? externalId : `act_${externalId}`

    // Get all active campaigns (include name for Discord alerts)
    const url = new URL(`${BASE_URL}/${acctId}/campaigns`)
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('fields', 'id,name,status')
    url.searchParams.set('effective_status', JSON.stringify(['ACTIVE']))
    url.searchParams.set('limit', '500')

    const res = await fetch(url.toString())
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Meta campaigns fetch failed ${res.status}: ${text}`)
    }
    const data = await res.json() as { data: { id: string; name?: string; status: string }[] }
    const campaigns = data.data ?? []

    if (campaigns.length === 0) return { paused: 0, campaignIds: [], campaignNames: [] }

    // Pause each campaign
    const campaignIds:   string[] = []
    const campaignNames: string[] = []
    for (const camp of campaigns) {
      await metaPost(`/${camp.id}`, accessToken, { status: 'PAUSED' })
      campaignIds.push(camp.id)
      campaignNames.push((camp.name?.trim() || camp.id).trim())
    }

    return { paused: campaignIds.length, campaignIds, campaignNames }
  } catch (err) {
    return { paused: 0, campaignIds: [], campaignNames: [], error: String(err) }
  }
}

export async function resumeMetaCampaigns(
  externalId: string,
  auth: Record<string, unknown>,
  campaignIds?: string[]
): Promise<{ resumed: number; error?: string }> {
  try {
    const accessToken = resolveToken(auth)
    if (!accessToken) return { resumed: 0, error: 'No access token' }

    const acctId = externalId.startsWith('act_') ? externalId : `act_${externalId}`

    const targets = campaignIds ?? []
    if (targets.length === 0) return { resumed: 0 }

    for (const id of targets) {
      await metaPost(`/${id}`, accessToken, { status: 'ACTIVE' })
    }

    return { resumed: targets.length }
  } catch (err) {
    return { resumed: 0, error: String(err) }
  }
}
