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
    chunks.push({
      from: cur.toISOString().split('T')[0],
      to:   chunkEnd.toISOString().split('T')[0],
    })
    cur = new Date(chunkEnd)
    cur.setDate(cur.getDate() + 1)
  }
  return chunks
}

/**
 * Create a Meta Insights async report job and return all rows once complete.
 *
 * Meta recommends async jobs for date ranges > 30 days.  A single POST
 * creates one server-side report (one BUC charge), avoiding the rate-limit
 * explosion that happens when 25 sequential GET /insights calls are made for
 * a 2-year backfill.
 *
 * Progress is reported from 2 % (job created) to 88 % (results ready).
 * The caller is responsible for everything above 88 %.
 */
async function fetchMetaInsightsAsync(
  adAccountId: string,
  accessToken: string,
  params: {
    fields:        string
    timeRange:     { since: string; until: string }
    level:         string
    timeIncrement: string
    limit:         number
  },
  onProgress?: (pct: number, note: string) => void
): Promise<Record<string, unknown>[]> {
  // ── Step 1: Submit async job ──────────────────────────────────────────────
  if (onProgress) onProgress(2, 'Creating report job…')

  const createUrl = new URL(`${BASE_URL}/${adAccountId}/insights`)
  createUrl.searchParams.set('access_token',   accessToken)
  createUrl.searchParams.set('level',          params.level)
  createUrl.searchParams.set('fields',         params.fields)
  createUrl.searchParams.set('time_range',     JSON.stringify(params.timeRange))
  createUrl.searchParams.set('time_increment', params.timeIncrement)
  // NOTE: do NOT pass 'limit' here — it caps total job output rows.
  //       Pagination limit is set separately on the results endpoint below.

  const createRes  = await fetch(createUrl.toString(), { method: 'POST' })
  const createData = await createRes.json() as Record<string, unknown>

  if (!createRes.ok || createData.error) {
    const e = createData.error as Record<string, unknown> | undefined
    throw new Error(e
      ? `Meta API error (code ${e.code}): ${e.message}`
      : `Meta async job creation failed (HTTP ${createRes.status})`
    )
  }

  const reportRunId = String(createData.report_run_id ?? '')
  if (!reportRunId) throw new Error('Meta did not return a report_run_id — async job rejected')

  // ── Step 2: Poll until complete ───────────────────────────────────────────
  // Schedule: fast at first (5 s × 6), then 10 s × 18, then 20 s × 20
  // Covers up to ~8 minutes — well inside Vercel's 13-min function timeout.
  const POLL_MS = [
    ...Array<number>(6).fill(5_000),
    ...Array<number>(18).fill(10_000),
    ...Array<number>(20).fill(20_000),
  ]

  for (let i = 0; i < POLL_MS.length; i++) {
    await sleep(POLL_MS[i])

    const statusData = await metaGet(`/${reportRunId}`, accessToken)
    const status     = String(statusData.async_status              ?? '')
    const jobPct     = Number(statusData.async_percent_completion  ?? 0)

    // Map job 0–100 % → overall 2–88 %
    if (onProgress) onProgress(Math.round(2 + jobPct * 0.86), `Processing report… ${jobPct}%`)

    // Meta returns 'Job Complete' in docs but 'Job Completed' in practice
    if (status === 'Job Complete' || status === 'Job Completed') break

    if (status === 'Job Failed' || status === 'Job Skipped') {
      throw new Error(`Meta async job ${status} (id: ${reportRunId})`)
    }

    if (i === POLL_MS.length - 1) {
      throw new Error(`Meta async job timed out (last status: ${status} ${jobPct}%)`)
    }
  }

  // ── Step 3: Paginate through results ─────────────────────────────────────
  if (onProgress) onProgress(89, 'Fetching results…')

  const rows: Record<string, unknown>[] = []
  const firstUrl = new URL(`${BASE_URL}/${reportRunId}/insights`)
  firstUrl.searchParams.set('access_token', accessToken)
  firstUrl.searchParams.set('limit',        String(params.limit))
  let nextUrl: string | null = firstUrl.toString()

  while (nextUrl) {
    const data = await metaFetchWithRetry(nextUrl)
    rows.push(...((data.data || []) as Record<string, unknown>[]))
    const paging = data.paging as Record<string, unknown> | undefined
    nextUrl = (paging?.next as string) || null
  }

  return rows
}

/**
 * Fetch ad-level metrics for a Meta ad account over a date range.
 * Includes thumbnail_url fetched from the creative API in a batch request.
 * Long date ranges are automatically split into 30-day chunks to avoid the
 * Meta API "Please reduce the amount of data" error on large backfills.
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

  // Collect all ad_ids so we can batch-fetch creative assets once at the end
  const adIdSet = new Set<string>()
  const rawRows: (Omit<MetaAdRawRow, 'thumbnail_url' | 'image_url' | 'video_id' | 'video_thumb_url' | 'creative_body' | 'creative_title' | 'creative_link_url' | 'ad_status'>)[] = []

  // Same async-vs-sync strategy as campaign-level: long ranges use a single
  // async job (one BUC charge) to avoid the rate-limit explosion from 25
  // sequential GET calls during a 2-year backfill.
  const adFields = [
    'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
    'ad_id', 'ad_name', 'spend', 'impressions', 'clicks',
    'reach', 'actions', 'action_values',
  ].join(',')

  const rangeDays = Math.ceil(
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86_400_000
  ) + 1

  const rawApiRows: Record<string, unknown>[] = rangeDays > 30
    ? await fetchMetaInsightsAsync(
        externalId, accessToken,
        { fields: adFields, timeRange: { since: dateFrom, until: dateTo }, level: 'ad', timeIncrement: '1', limit: 500 }
      )
    : await (async () => {
        const buf: Record<string, unknown>[] = []
        const base = new URL(`${BASE_URL}/${externalId}/insights`)
        base.searchParams.set('access_token',   accessToken)
        base.searchParams.set('level',          'ad')
        base.searchParams.set('fields',         adFields)
        base.searchParams.set('time_range',     JSON.stringify({ since: dateFrom, until: dateTo }))
        base.searchParams.set('time_increment', '1')
        base.searchParams.set('limit',          '500')
        let nextUrl: string | null = base.toString()
        while (nextUrl) {
          const data = await metaFetchWithRetry(nextUrl)
          buf.push(...((data.data || []) as Record<string, unknown>[]))
          const paging = data.paging as Record<string, unknown> | undefined
          nextUrl = (paging?.next as string) || null
        }
        return buf
      })()

  for (const day of rawApiRows) {
    const rawActions      = (day.actions       || []) as Record<string, unknown>[]
    const rawActionValues = (day.action_values  || []) as Record<string, unknown>[]
    const actions      = rawActions.map(a => ({ action_type: String(a.action_type || ''), value: String(a.value || '0') }))
    const actionValues = rawActionValues.map(a => ({ action_type: String(a.action_type || ''), value: String(a.value || '0') }))
    const adId = String(day.ad_id || '')
    if (adId) adIdSet.add(adId)
    rawRows.push({
      campaign_id:      String(day.campaign_id   || ''),
      campaign_name:    String(day.campaign_name || ''),
      adset_id:         String(day.adset_id      || ''),
      adset_name:       String(day.adset_name    || ''),
      ad_id:            adId,
      ad_name:          String(day.ad_name       || ''),
      date:             String(day.date_start    || ''),
      spend:            parseFloat(String(day.spend       || '0')),
      impressions:      parseInt(  String(day.impressions || '0'), 10),
      clicks:           parseInt(  String(day.clicks      || '0'), 10),
      reach:            parseInt(  String(day.reach       || '0'), 10),
      actions,
      action_values:    actionValues,
      conversions:      actions.reduce((s, a) => s + parseFloat(a.value || '0'), 0),
      conversion_value: actionValues.reduce((s, a) => s + parseFloat(a.value || '0'), 0),
    })
  }

  // Batch-fetch creative assets for all unique ad_ids (once across all chunks)
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
            ad_status:         (body.status        as string | undefined) ?? '',
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

    // For date ranges > 30 days use Meta's async jobs API: one POST creates a
    // server-side report (single BUC charge), avoiding the rate-limit storm
    // that 25 sequential GET /insights calls produce during a 2-year backfill.
    // Short ranges use a direct GET — faster with no job-polling overhead.
    const rangeDays = Math.ceil(
      (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86_400_000
    ) + 1

    const campaignFields = [
      'campaign_id', 'campaign_name', 'objective',
      'spend', 'impressions', 'clicks', 'reach', 'frequency',
      'actions', 'action_values',
    ].join(',')

    const rawDayRows: Record<string, unknown>[] = rangeDays > 30
      ? await fetchMetaInsightsAsync(
          externalId, accessToken,
          {
            fields:        campaignFields,
            timeRange:     { since: dateFrom, until: dateTo },
            level:         'campaign',
            timeIncrement: '1',
            limit:         500,
          },
          onProgress
        )
      : await (async () => {
          if (onProgress) onProgress(5, 'Fetching insights…')
          const buf: Record<string, unknown>[] = []
          const base = new URL(`${BASE_URL}/${externalId}/insights`)
          base.searchParams.set('access_token',   accessToken)
          base.searchParams.set('level',          'campaign')
          base.searchParams.set('fields',         campaignFields)
          base.searchParams.set('time_range',     JSON.stringify({ since: dateFrom, until: dateTo }))
          base.searchParams.set('time_increment', '1')
          base.searchParams.set('limit',          '500')
          let nextUrl: string | null = base.toString()
          while (nextUrl) {
            const data = await metaFetchWithRetry(nextUrl)
            buf.push(...((data.data || []) as Record<string, unknown>[]))
            const paging = data.paging as Record<string, unknown> | undefined
            nextUrl = (paging?.next as string) || null
          }
          return buf
        })()

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
    const adsetBudgetMap = new Map<string, number>() // ABO: sum of active adset budgets per campaign
    try {
      const [campData, adsetData] = await Promise.all([
        metaGet(`/${externalId}/campaigns`, accessToken, {
          fields: 'id,daily_budget,effective_status',
          limit: '500',
        }),
        metaGet(`/${externalId}/adsets`, accessToken, {
          fields: 'campaign_id,daily_budget,effective_status',
          limit: '500',
        }),
      ])
      for (const camp of (campData.data || []) as Record<string, unknown>[]) {
        const cid    = String(camp.id || '')
        const budget = Number(camp.daily_budget || 0) / 100  // cents → account currency
        const status = String(camp.effective_status || '')
        if (cid) {
          if (budget > 0) budgetMap.set(cid, budget)
          if (status)     statusMap.set(cid, status)
        }
      }
      // For ABO campaigns (no campaign-level budget), sum active adset budgets
      for (const adset of (adsetData.data || []) as Record<string, unknown>[]) {
        const cid    = String(adset.campaign_id || '')
        const budget = Number(adset.daily_budget || 0) / 100
        const status = String(adset.effective_status || '')
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

    if (onProgress) onProgress(100, 'Done')

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
