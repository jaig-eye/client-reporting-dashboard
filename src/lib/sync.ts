// ─────────────────────────────────────────────────────────────────────────────
// Sync Engine
//
// Orchestrates data ingestion across all connector types.
// Each client_connection is synced independently using its connector's adapter.
// Source data is written to platform-specific tables (google_ads_metrics, meta_ads_metrics)
// — never merged at ingest time.
//
// Sync types:
//   backfill    — full historical pull when a connection is first created
//   incremental — daily catch-up (last INCREMENTAL_DAYS days to catch late conversions)
//   manual      — admin-triggered, custom date range
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from './supabase/server'
import { getConnectorAdapter } from './connectors/registry'
import { fetchGoogleAdMetrics, fetchGooglePMaxAssets, fetchGoogleSearchKeywords, fetchGoogleNegativeKeywords } from './connectors/google-ads'
import type { GooglePMaxAssetRawRow, GoogleAdsKeywordRawRow, GoogleAdsNegativeKeywordRawRow, GoogleAdsSearchTermRawRow } from './connectors/google-ads'
import { fetchGoogleSearchTerms, fetchGoogleAdsCalls, fetchConversionActions } from './connectors/google-ads'
import { fetchMetaAdMetrics } from './connectors/meta-ads'
import type { GhlRawRow } from './connectors/ghl'
import { fetchSocialPosts } from './connectors/ghl'
import type { ClientConnection, Connector, SyncJobType } from './types'
import type { GoogleAdsRawRow, MetaAdsRawRow } from './connectors/types'
import { fetchReviews as fetchGBPReviews, fetchLocationProfile } from './connectors/google-business-profile'
import { fetchAhrefsKeywords, fetchAhrefsPages } from './connectors/ahrefs'
import type { AhrefsKeywordRow, AhrefsPageRow } from './connectors/ahrefs'
import { fetchSearchAnalytics, fetchDailyTotals } from './connectors/google-search-console'
import type { GSCRawRow, GSCDailyTotalRow, GSCQueryTotalRow, GSCPageTotalRow, GSCPageFilter } from './connectors/google-search-console'

interface AhrefsRow {
  date:                   string
  domain_rating:          number | null
  ahrefs_rank:            number | null
  backlinks:              number | null
  referring_domains:      number | null
  organic_keywords:       number | null
  organic_traffic:        number | null
  traffic_value?:         number | null
  paid_keywords?:         number | null
  paid_traffic?:          number | null
  new_backlinks?:         number | null
  lost_backlinks?:        number | null
  new_referring_domains?: number | null
  lost_referring_domains?:number | null
}
import type { GoogleAdsAdRawRow } from './connectors/google-ads'
import type { MetaAdRawRow } from './connectors/meta-ads'

/** Days of history pulled on first connection (approx 2 years). */
export const BACKFILL_DAYS = 730

/**
 * Days re-synced on each incremental run.
 * Google Ads and Meta both update conversions retroactively (up to 30 days back),
 * so we re-pull recent days to capture late-arriving conversion data.
 */
export const INCREMENTAL_DAYS = 30

/**
 * Days re-synced for GSC on incremental runs.
 * GSC data is query×page dimensional — even 3 days can be 50K+ rows on large sites.
 * GSC finalizes data over 3–7 days, so we re-sync 7 days to keep rows fresh.
 */
export const GSC_INCREMENTAL_DAYS = 7

// ─────────────────────────────────────────────────────────────────────────────
// Main sync entry points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync all active connections for a client.
 * Called by the admin panel sync buttons and the daily cron job.
 *
 * @param clientId  - UUID of the client to sync
 * @param jobType   - 'backfill', 'incremental', or 'manual'
 * @param days      - Number of days back to sync (uses INCREMENTAL_DAYS if not specified)
 * @param connectionId - If provided, only syncs this specific connection
 * @param dateFrom  - ISO date string override (used for manual syncs)
 * @param dateTo    - ISO date string override (used for manual syncs)
 * @returns Total number of records synced across all connections
 */
export async function syncClient(
  clientId: string,
  jobType: SyncJobType = 'incremental',
  days = INCREMENTAL_DAYS,
  connectionId?: string,
  dateFrom?: string,
  dateTo?: string,
  triggeredBy?: 'cron' | 'admin' | 'system',
  excludeGsc?: boolean,
  connectorTypes?: string[],
): Promise<number> {
  const db = createAdminClient()

  // Load connections with their connector details in one query
  let query = db
    .from('client_connections')
    .select('*, connector:connectors(*)')
    .eq('client_id', clientId)
    .eq('status', 'active')

  if (connectionId) query = query.eq('id', connectionId)

  const { data: connections } = await query as {
    data: (ClientConnection & { connector: Connector })[] | null
  }
  if (!connections?.length) return 0

  // Compute default date range if not overridden
  const [resolvedFrom, resolvedTo] = dateFrom && dateTo
    ? [dateFrom, dateTo]
    : computeDateRange(jobType === 'backfill' ? BACKFILL_DAYS : days)

  let totalRecords = 0

  for (const connection of connections) {
    if (excludeGsc && connection.connector.type === 'google_search_console') continue
    if (connectorTypes && !connectorTypes.includes(connection.connector.type)) continue

    const adapter = getConnectorAdapter(connection.connector.type)
    if (!adapter) {
      // Connector type exists in DB but has no implementation yet (e.g. Search Console)
      continue
    }

    const jobId = await startSyncJob(db, connection.id, clientId, jobType, resolvedFrom, resolvedTo, triggeredBy)

    try {
      // Refresh auth tokens if the adapter supports it (e.g. Google OAuth)
      let auth = connection.connector.auth
      if (adapter.refreshAuth) {
        const refreshed = await adapter.refreshAuth(auth)
        if (refreshed) {
          auth = refreshed
          // Persist refreshed tokens so future syncs have a valid token
          await db
            .from('connectors')
            .update({ auth: refreshed })
            .eq('id', connection.connector_id)
        }
      }

      // One entry per Google Ads call, filled by fetchGoogleAdsCalls. Kept so the CRM sync can
      // match those calls to contacts by when they happened.
      const adCallEvents: import('./connectors/google-ads').GoogleAdsCallEvent[] = []

      // Fetch source-specific metrics
      const onProgress = (pct: number, note: string) => {
        db.from('sync_jobs').update({ progress_pct: pct, progress_note: note }).eq('id', jobId).then(() => {})
      }
      // The CRM can credit a caller to an ad when Google logged the same call. Google's sync
      // wrote those down; this reads back the ones for this client and range. Before migration 220
      // the read fails quietly and the CRM sync simply doesn't do the matching.
      let connectorConfig = connection.connector.config
      if (connection.connector.type === 'ghl') {
        const { data: adCalls } = await db.from('google_ads_calls')
          .select('started_at,duration_seconds,from_ad')
          .eq('client_id', clientId)
          .gte('started_at', `${resolvedFrom}T00:00:00Z`)
          .lte('started_at', `${resolvedTo}T23:59:59Z`)
          .limit(5000)
        if (adCalls && adCalls.length > 0) {
          console.log(`[sync] handing ${adCalls.length} Google Ads calls to the CRM sync for matching`)
          connectorConfig = { ...connectorConfig, ad_calls: adCalls }
        }
      }

      const result = await adapter.fetchMetrics(
        connection.external_id,
        auth,
        connectorConfig,
        resolvedFrom,
        resolvedTo,
        onProgress
      )

      if (result.error) {
        await completeSyncJob(db, jobId, 'error', 0, result.error)
        continue
      }

      // Write to the platform-specific table — no merging
      let recordCount = 0
      let adLevelError: string | undefined
      if (connection.connector.type === 'google_ads') {
        recordCount = await upsertGoogleAdsMetrics(
          db,
          connection.id,
          clientId,
          result.rows as GoogleAdsRawRow[]
        )
        // Run all Google Ads sub-fetches in parallel (best-effort — each is independent)
        const [adResult, assetResult, kwResult, negResult, stResult, callResult, convActionResult] = await Promise.allSettled([
          fetchGoogleAdMetrics(connection.external_id, auth, connection.connector.config, resolvedFrom, resolvedTo),
          fetchGooglePMaxAssets(connection.external_id, auth, connection.connector.config),
          fetchGoogleSearchKeywords(connection.external_id, auth, connection.connector.config, resolvedFrom, resolvedTo),
          fetchGoogleNegativeKeywords(connection.external_id, auth, connection.connector.config),
          fetchGoogleSearchTerms(connection.external_id, auth, connection.connector.config, resolvedFrom, resolvedTo),
          fetchGoogleAdsCalls(connection.external_id, auth, connection.connector.config, resolvedFrom, resolvedTo, adCallEvents),
          fetchConversionActions(connection.external_id, auth, connection.connector.config, resolvedFrom, resolvedTo),
        ])

        // What the conversion total is made of. Migration 222; before it, or on an account without
        // the segment, this writes nothing and the breakdown simply stays hidden.
        if (convActionResult.status === 'fulfilled' && convActionResult.value.length > 0) {
          const stored = await upsertGoogleAdsConversionActions(
            db, connection.id, clientId, convActionResult.value)
          console.log(`[sync] Google Ads conversion actions: stored ${stored} for connection ${connection.id}`)
        } else if (convActionResult.status === 'rejected') {
          console.error('[sync] Google Ads conversion actions failed:', convActionResult.reason)
        }

        if (adResult.status === 'fulfilled') {
          const adRows = adResult.value
          console.log(`[sync] Google Ads ad-level: ${adRows.length} rows for connection ${connection.id}`)
          if (adRows.length > 0) await upsertGoogleAdsAdMetrics(db, connection.id, clientId, adRows)
          else adLevelError = 'Ad-level: 0 rows — account may use Performance Max campaigns'
        } else {
          adLevelError = `Ad-level sync failed: ${String(adResult.reason)}`
          console.error(`[sync] Google Ads ad-level failed for connection ${connection.id}:`, adResult.reason)
        }

        if (assetResult.status === 'fulfilled' && assetResult.value.length > 0) {
          console.log(`[sync] Google Ads pMax assets: ${assetResult.value.length} rows for connection ${connection.id}`)
          await upsertGooglePMaxAssets(db, connection.id, clientId, assetResult.value)
        } else if (assetResult.status === 'rejected') {
          console.error(`[sync] Google Ads pMax assets failed for connection ${connection.id}:`, assetResult.reason)
        }

        if (kwResult.status === 'fulfilled' && kwResult.value.length > 0) {
          console.log(`[sync] Google Ads keywords: ${kwResult.value.length} rows for connection ${connection.id}`)
          await upsertGoogleAdsKeywords(db, connection.id, clientId, kwResult.value)
        } else if (kwResult.status === 'rejected') {
          console.error(`[sync] Google Ads keywords failed for connection ${connection.id}:`, kwResult.reason)
        }

        if (negResult.status === 'fulfilled' && negResult.value.length > 0) {
          console.log(`[sync] Google Ads negative keywords: ${negResult.value.length} rows for connection ${connection.id}`)
          await upsertGoogleAdsNegativeKeywords(db, connection.id, clientId, negResult.value)
        } else if (negResult.status === 'rejected') {
          console.error(`[sync] Google Ads negative keywords failed for connection ${connection.id}:`, negResult.reason)
        }

        if (stResult.status === 'fulfilled' && stResult.value.length > 0) {
          console.log(`[sync] Google Ads search terms: ${stResult.value.length} rows for connection ${connection.id}`)
          await upsertGoogleSearchTerms(db, connection.id, clientId, stResult.value)
        } else if (stResult.status === 'rejected') {
          console.error(`[sync] Google Ads search terms failed for connection ${connection.id}:`, stResult.reason)
        }

        if (callResult.status === 'fulfilled') {
          const calls = callResult.value
          const total = calls.reduce((s, r) => s + Math.max(r.phone_calls, r.calls_received + r.calls_missed), 0)
          console.log(`[sync] Google Ads calls: ${calls.length} campaign-days, ${total} calls for connection ${connection.id}`)
          await upsertGoogleAdsCallMetrics(db, connection.id, clientId, calls, resolvedFrom, resolvedTo)
          await upsertGoogleAdsCallEvents(db, connection.id, clientId, adCallEvents, resolvedFrom, resolvedTo)
        } else {
          console.error(`[sync] Google Ads calls failed for connection ${connection.id}:`, callResult.reason)
        }
      } else if (connection.connector.type === 'meta_ads') {
        onProgress(80, 'Saving campaign data…')
        recordCount = await upsertMetaAdsMetrics(
          db,
          connection.id,
          clientId,
          result.rows as MetaAdsRawRow[],
          result.discoveredActions ?? []
        )
        // Extract pre-loaded adset data from the campaign sync result so the
        // ad-level sync doesn't need a second adsets API call (avoids rate limits).
        const adsetRows = (result.extraRows?.adset_data ?? []) as { id: string; name: string; budget: number }[]
        const preloadedAdsetData = adsetRows.length > 0 ? {
          names:   new Map(adsetRows.map(a => [a.id, a.name])),
          budgets: new Map(adsetRows.map(a => [a.id, a.budget])),
        } : undefined

        // Ad-level sync (best-effort) — rows counted separately so the UI shows
        // the true total (campaign rows + ad rows) instead of just campaign rows.
        // onRawRowsReady upserts raw insight rows immediately after all chunks are
        // fetched so spend/click data is saved even if the creative fetch times out.
        onProgress(88, 'Fetching ad-level data…')
        let rawAdCount = 0
        try {
          const adRows = await fetchMetaAdMetrics(
            connection.external_id,
            auth,
            resolvedFrom,
            resolvedTo,
            async (rawRows) => {
              console.log(`[sync] Meta ad-level (raw): ${rawRows.length} rows for connection ${connection.id}`)
              onProgress(93, 'Saving ad-level insight data…')
              rawAdCount = await upsertMetaAdsAdMetrics(db, connection.id, clientId, rawRows)
            },
            preloadedAdsetData
          )
          console.log(`[sync] Meta ad-level (enriched): ${adRows.length} rows for connection ${connection.id}`)
          if (adRows.length > 0) {
            onProgress(96, 'Saving ad creatives…')
            const adCount = await upsertMetaAdsAdMetrics(db, connection.id, clientId, adRows)
            recordCount += adCount
          } else {
            recordCount += rawAdCount
          }
        } catch (adErr) {
          const adErrMsg = adErr instanceof Error ? adErr.message : JSON.stringify(adErr)
          adLevelError = `Ad-level sync failed: ${adErrMsg}`
          console.error(`[sync] Meta ad-level sync failed for connection ${connection.id}:`, adErr)
          recordCount += rawAdCount  // count any rows saved by the early upsert
        }
        onProgress(100, 'Done')
      } else if (connection.connector.type === 'ghl') {
        recordCount = await upsertGhlMetrics(
          db,
          connection.id,
          clientId,
          result.rows as unknown as GhlRawRow[]
        )

        // The posts we published to their social pages in this window. Best-effort: a token
        // without the Social Planner scope logs how to add it and the section stays hidden.
        const ghlKey = String((auth as Record<string, unknown>).api_key ?? '')
        if (ghlKey && connection.external_id) {
          try {
            const social = await fetchSocialPosts(
              ghlKey, connection.external_id, resolvedFrom, resolvedTo)
            if (social.posts.length > 0) {
              const stored = await upsertGhlSocialPosts(
                db, connection.id, clientId, connection.external_id, social.posts)
              console.log(`[sync] social posts: stored ${stored} for connection ${connection.id}`)
            }
          } catch (e) {
            console.error('[sync] social posts failed:', e)
          }
        }
      } else if (connection.connector.type === 'google_analytics') {
        recordCount = await upsertGA4Metrics(
          db,
          connection.id,
          clientId,
          result.rows as unknown as import('./connectors/google-analytics').GA4RawRow[]
        )
        if (result.extraRows?.ga4_source_metrics) {
          const srcCount = await upsertGA4SourceMetrics(
            db,
            connection.id,
            clientId,
            result.extraRows.ga4_source_metrics as import('./connectors/google-analytics').GA4SourceRow[]
          )
          recordCount += srcCount
        }
        if (result.extraRows?.ga4_dimension_metrics) {
          recordCount += await upsertGA4DimensionMetrics(
            db,
            connection.id,
            clientId,
            result.extraRows.ga4_dimension_metrics as import('./connectors/google-analytics').GA4DimensionRow[]
          )
        }
      } else if (connection.connector.type === 'google_search_console') {
        // Bypass the pre-fetched result — fetch in 30-day chunks to avoid timeouts
        // on large sites during backfills. Each chunk is upserted immediately.
        // Incremental syncs use a 2-day window and skip existing rows (ignoreDuplicates).
        let gscFrom = resolvedFrom
        if (jobType === 'incremental') {
          const d = new Date(); d.setDate(d.getDate() - GSC_INCREMENTAL_DAYS)
          gscFrom = d.toISOString().split('T')[0]
        }
        recordCount = await syncGSCInChunks(
          db, connection, auth, gscFrom, resolvedTo, clientId
        )
      } else if (connection.connector.type === 'google_business_profile') {
        const gbpRows = result.rows as unknown as import('./connectors/google-business-profile').GBPRawRow[]

        // One reviews call serves both: the running total and average go on the most recent day,
        // the reviews themselves into their own table. Best-effort — a listing that refuses
        // reviews still syncs its views and clicks.
        const gbpToken = String((auth as Record<string, unknown>).access_token ?? '')

        // How the listing is set up — categories, services, description, hours. A snapshot of the
        // present state rather than a daily series, so it goes on every row of the range and the
        // page reads the most recent. Best-effort: a refused field mask just leaves the panel out.
        if (gbpToken) {
          try {
            const profile = await fetchLocationProfile(connection.external_id, gbpToken)
            if (profile) {
              for (const row of gbpRows) {
                ;(row as unknown as { raw_data?: unknown }).raw_data = { profile }
              }
              console.log(`[sync] GBP listing setup captured for connection ${connection.id}`)
            }
          } catch (e) {
            console.error('[sync] GBP listing setup failed:', e)
          }
        }

        if (gbpToken) {
          try {
            const reviews = await fetchGBPReviews(connection.external_id, gbpToken)
            if (gbpRows.length > 0 && (reviews.count > 0 || reviews.reviews.length > 0)) {
              const latest = [...gbpRows].sort((a, b) => b.date.localeCompare(a.date))[0]
              latest.reviews_count      = reviews.count
              latest.reviews_avg_rating = reviews.avgRating
            }
            if (reviews.reviews.length > 0) {
              const stored = await upsertGBPReviews(
                db, connection.id, clientId, connection.external_id, reviews.reviews)
              console.log(`[sync] GBP reviews: stored ${stored} for connection ${connection.id}`)
            }
          } catch (e) {
            console.error('[sync] GBP reviews failed:', e)
          }
        }

        recordCount = await upsertGBPMetrics(db, connection.id, clientId, gbpRows)
      } else if (connection.connector.type === 'ahrefs') {
        recordCount = await upsertAhrefsMetrics(
          db,
          connection.id,
          clientId,
          result.rows as unknown as AhrefsRow[]
        )
        // Fetch keyword rankings + top pages snapshot for the end date
        const ahrefsDomain = connection.external_id
        const ahrefsApiKey = String((connection.connector.auth as Record<string, unknown> | null)?.api_key ?? '')
        if (ahrefsDomain && ahrefsApiKey) {
          const [kwResult, pgResult] = await Promise.allSettled([
            fetchAhrefsKeywords(ahrefsDomain, ahrefsApiKey, resolvedTo),
            fetchAhrefsPages(ahrefsDomain, ahrefsApiKey, resolvedTo),
          ])
          if (kwResult.status === 'fulfilled' && kwResult.value.length > 0) {
            console.log(`[sync] Ahrefs keywords: ${kwResult.value.length} rows for connection ${connection.id}`)
            await upsertAhrefsKeywords(db, connection.id, clientId, kwResult.value)
          } else if (kwResult.status === 'rejected') {
            console.error(`[sync] Ahrefs keywords failed for connection ${connection.id}:`, kwResult.reason)
          }
          if (pgResult.status === 'fulfilled' && pgResult.value.length > 0) {
            console.log(`[sync] Ahrefs pages: ${pgResult.value.length} rows for connection ${connection.id}`)
            await upsertAhrefsPages(db, connection.id, clientId, pgResult.value)
          } else if (pgResult.status === 'rejected') {
            console.error(`[sync] Ahrefs pages failed for connection ${connection.id}:`, pgResult.reason)
          }
        }
      }
      // WordPress connector: no metrics to sync (write-only connector)

      totalRecords += recordCount

      // Update last_synced_at on the connection
      await db
        .from('client_connections')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', connection.id)

      await completeSyncJob(db, jobId, 'success', recordCount, adLevelError)
    } catch (err) {
      await completeSyncJob(db, jobId, 'error', 0, String(err))
      // Don't throw — let remaining connections for this client still run
    }
  }

  return totalRecords
}

// ─────────────────────────────────────────────────────────────────────────────
// GSC chunked sync helper
// ─────────────────────────────────────────────────────────────────────────────

const GSC_CHUNK_DAYS        = 30
const GSC_CHUNK_CONCURRENCY = 1

/**
 * Fetches GSC data in 30-day windows and upserts each chunk immediately.
 * Chunks are fetched in parallel batches (GSC_CHUNK_CONCURRENCY at a time) to
 * keep 2-year backfills fast without hammering the GSC API or blowing memory.
 * ignoreDuplicates=false so re-syncs always overwrite with finalized GSC values.
 */
async function syncGSCInChunks(
  db:         ReturnType<typeof createAdminClient>,
  connection: ClientConnection & { connector: Connector },
  auth:       Record<string, unknown>,
  dateFrom:   string,
  dateTo:     string,
  clientId:   string,
): Promise<number> {
  const ignoreDuplicates = false

  // Build the full list of date-range chunks upfront.
  const chunks: Array<{ from: string; to: string }> = []
  let chunkStart = new Date(dateFrom)
  const end      = new Date(dateTo)
  while (chunkStart <= end) {
    const chunkEnd = new Date(chunkStart)
    chunkEnd.setDate(chunkEnd.getDate() + GSC_CHUNK_DAYS - 1)
    if (chunkEnd > end) chunkEnd.setTime(end.getTime())
    chunks.push({
      from: chunkStart.toISOString().split('T')[0],
      to:   chunkEnd.toISOString().split('T')[0],
    })
    chunkStart = new Date(chunkEnd)
    chunkStart.setDate(chunkStart.getDate() + 1)
  }

  let total = 0

  // Optional page filter from connection config — stored as page_filter_regex / page_filter_type.
  // Applied to page-dimension fetches only (pFetch and 3D). Daily totals and query ranks are
  // intentionally left unfiltered so overall site performance numbers remain accurate.
  const rawRegex = connection.config?.page_filter_regex
  const pageFilter: GSCPageFilter | undefined = rawRegex && typeof rawRegex === 'string' ? {
    regex: rawRegex,
    type:  ((connection.config?.page_filter_type as string | undefined) ?? 'exclude') as 'include' | 'exclude',
  } : undefined

  // Process chunks in parallel batches to avoid sequential API latency.
  // 5 concurrent chunks keeps a 2-year backfill (24 chunks) down to ~5 rounds.
  for (let i = 0; i < chunks.length; i += GSC_CHUNK_CONCURRENCY) {
    const batch = chunks.slice(i, i + GSC_CHUNK_CONCURRENCY)
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)

    const settled = await Promise.allSettled(
      batch.map(async ({ from: chunkFrom, to: chunkTo }) => {
        const accessToken = (auth.access_token as string | undefined) ?? ''
        if (!accessToken) return 0

        const siteUrl  = connection.external_id
        // Use 'final' for fully-processed historical data; 'all' only for the last 2 days
        const dataState: 'all' | 'final' = chunkTo >= twoDaysAgo ? 'all' : 'final'

        // Two parallel 2D fetches feed the aggregate tables (accurate impressions, no cross-product).
        // A 3D fetch is also run for chunks within the last 30 days so gsc_metrics stays current
        // for content tools (topic generation, internal links) that need the page-query relationship.
        // Backfill chunks older than 30 days skip the 3D call — content tools don't need that history.
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
        const needs3D = chunkTo >= thirtyDaysAgo

        const [qFetch, pFetch, rawRows, dailyRows] = await Promise.all([
          fetchSearchAnalytics(siteUrl, accessToken, chunkFrom, chunkTo, dataState, ['date', 'query']),
          fetchSearchAnalytics(siteUrl, accessToken, chunkFrom, chunkTo, dataState, ['date', 'page'], pageFilter),
          needs3D
            ? fetchSearchAnalytics(siteUrl, accessToken, chunkFrom, chunkTo, dataState, undefined, pageFilter)
            : Promise.resolve([] as GSCRawRow[]),
          fetchDailyTotals(siteUrl, accessToken, chunkFrom, chunkTo, dataState),
        ])

        // Query totals — qFetch rows ARE the date+query aggregates
        const queryRows: GSCQueryTotalRow[] = qFetch.map(r => ({
          date: r.date, query: r.query ?? '', clicks: r.clicks, impressions: r.impressions,
          ctr: r.ctr, position: r.position,
        }))

        // Page totals — pFetch rows ARE the date+page aggregates
        const pageRows: GSCPageTotalRow[] = pFetch.map(r => ({
          date: r.date, page: r.page ?? '', clicks: r.clicks, impressions: r.impressions,
          ctr: r.ctr, position: r.position,
        }))

        if (dailyRows.length > 0) {
          await upsertGSCDailyTotals(db, connection.id, clientId, dailyRows)
        }
        if (queryRows.length > 0) {
          await upsertGSCQueryTotals(db, connection.id, clientId, queryRows)
        }
        if (pageRows.length > 0) {
          await upsertGSCPageTotals(db, connection.id, clientId, pageRows)
        }
        if (rawRows.length > 0) {
          await upsertGSCMetrics(db, connection.id, clientId, rawRows, ignoreDuplicates)
        }
        console.log(`[sync] GSC chunk ${chunkFrom} → ${chunkTo} (${dataState}): ${qFetch.length} query rows, ${pFetch.length} page rows${needs3D ? `, ${rawRows.length} raw rows` : ''}`)
        return qFetch.length + pFetch.length
      })
    )
    for (const r of settled) {
      if (r.status === 'fulfilled') total += r.value
      else console.error('[sync] GSC chunk failed:', r.reason)
    }
  }

  return total
}

// ─────────────────────────────────────────────────────────────────────────────
// Source-specific upsert functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert Google Ads metrics into google_ads_metrics.
 * On conflict (connection_id, campaign_id, date) the row is updated.
 * Derived metrics (spend, roas, ctr, cpc, cpm) are computed from raw values.
 */
export async function upsertGoogleAdsMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: GoogleAdsRawRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date && r.campaign_id)
  if (!valid.length) return 0

  const mapped = valid.map(r => {
    const costMicros    = Number(r.cost_micros)    || 0
    const spend         = costMicros / 1_000_000
    const impressions   = Number(r.impressions)    || 0
    const clicks        = Number(r.clicks)         || 0
    const conversions   = Number(r.conversions)    || 0
    const convValue        = Number(r.conversions_value)     || 0
    const allConvValue     = Number(r.all_conversions_value) || 0
    const vtc              = Number(r.view_through_conversions) || 0
    const roasConvValue    = convValue  // stored ROAS uses primary conversions_value only

    return {
      connection_id:            connectionId,
      client_id:                clientId,
      campaign_id:              String(r.campaign_id),
      campaign_name:            String(r.campaign_name || ''),
      campaign_status:          r.campaign_status || null,
      campaign_type:            r.campaign_type   || null,
      date:                     String(r.date).split('T')[0],
      cost_micros:              costMicros,
      spend,
      impressions,
      clicks,
      conversions,
      conversions_value:        convValue,
      all_conversions_value:    allConvValue > 0 ? allConvValue : null,
      view_through_conversions: vtc,
      // Derived metrics computed from source values
      roas: spend > 0 ? roasConvValue / spend : 0,
      ctr:  impressions > 0 ? clicks / impressions : 0,
      cpc:  clicks > 0 ? spend / clicks : 0,
      cpm:  impressions > 0 ? (spend / impressions) * 1000 : 0,
      daily_budget: r.daily_budget_micros > 0 ? r.daily_budget_micros / 1_000_000 : null,
      // Impression share (Search campaigns only; null for all others)
      search_impression_share:         r.search_impression_share         ?? null,
      search_abs_top_impression_share: r.search_abs_top_impression_share ?? null,
      search_top_impression_share:     r.search_top_impression_share     ?? null,
      // Campaign start date — synced from campaign.start_date in GAQL
      campaign_start_date: (r as GoogleAdsRawRow).campaign_start_date || undefined,
    }
  })

  // Batch upsert in groups of 200 to avoid request size limits
  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('google_ads_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,campaign_id,date',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`[sync] google_ads_metrics upsert failed (batch ${i}): ${error.message}`)
  }

  // Auto-discover campaigns for client_campaign_assignments
  await upsertCampaignAssignments(db, clientId, 'google_ads', mapped)

  return mapped.length
}

/**
 * Upsert Meta Ads metrics into meta_ads_metrics.
 * Stores the full actions + action_values JSONB for live conversion remapping.
 * Derived conversions/roas are computed from Meta's "results" field (primary objective result).
 */
export async function upsertMetaAdsMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: MetaAdsRawRow[],
  discoveredActions: string[]
): Promise<number> {
  const valid = rows.filter(r => r.date && r.campaign_id)
  if (!valid.length) return 0

  const mapped = valid.map(r => {
    const spend       = Number(r.spend)       || 0
    const impressions = Number(r.impressions) || 0
    const clicks      = Number(r.clicks)      || 0

    // Default: use the total count across all actions as a proxy conversion count.
    // The actual conversion logic happens at query time using the stored actions JSONB.
    const conversionTotal = r.actions.reduce(
      (sum, a) => sum + parseFloat(a.value || '0'),
      0
    )
    const revenueTotal = r.action_values.reduce(
      (sum, a) => sum + parseFloat(a.value || '0'),
      0
    )

    return {
      connection_id:     connectionId,
      client_id:         clientId,
      campaign_id:       String(r.campaign_id),
      campaign_name:     String(r.campaign_name || ''),
      objective:         r.objective || null,
      campaign_status:   r.campaign_status || null,
      date:              String(r.date).split('T')[0],
      spend,
      impressions,
      clicks,
      reach:             Number(r.reach)      || 0,
      frequency:         Number(r.frequency)  || 0,
      actions:           r.actions,
      action_values:     r.action_values,
      // Derived (approximate — will be remapped at query time).
      // Clamped to DECIMAL(10,4) safe range (<1,000,000) to prevent overflow
      // when spend is near-zero (roas explosion) or action counts are huge.
      conversions:       Math.min(conversionTotal, 999_999),
      conversion_value:  revenueTotal,
      roas:              Math.min(spend > 0 && revenueTotal > 0 ? revenueTotal / spend : 0, 999_999),
      ctr:               impressions > 0 ? clicks / impressions : 0,
      cpc:               Math.min(clicks > 0 ? spend / clicks : 0, 999_999),
      cpm:               Math.min(impressions > 0 ? (spend / impressions) * 1000 : 0, 999_999),
      daily_budget:      r.daily_budget != null ? r.daily_budget : null,
      // Accumulated action types for the conversion selector UI.
      // Merged with existing discovered_actions on upsert.
      discovered_actions: discoveredActions,
    }
  })

  const dates = mapped.map(r => r.date).sort()
  const totalSpend = mapped.reduce((s, r) => s + (r.spend as number), 0)
  console.log(`[upsertMetaAdsMetrics] ${mapped.length} rows, dates ${dates[0]}–${dates[dates.length-1]}, spend=$${totalSpend.toFixed(2)}`)

  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('meta_ads_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,campaign_id,date',
        ignoreDuplicates: false,
      })
    if (error) {
      console.error(`[upsertMetaAdsMetrics] batch ${i}–${i+200} FAILED:`, error.message, error.details ?? '')
      throw new Error(`meta_ads_metrics upsert failed: ${error.message}`)
    }
  }

  await upsertCampaignAssignments(db, clientId, 'meta_ads', mapped)

  return mapped.length
}

/**
 * Upsert Google Ads ad-level metrics into google_ads_ad_metrics.
 * On conflict (connection_id, ad_id, date) the row is updated.
 */
export async function upsertGoogleAdsAdMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: GoogleAdsAdRawRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date && r.ad_id)
  if (!valid.length) return 0

  const mapped = valid.map(r => {
    const costMicros = Number(r.cost_micros) || 0
    const spend      = costMicros / 1_000_000
    return {
      connection_id:     connectionId,
      client_id:         clientId,
      campaign_id:       String(r.campaign_id),
      campaign_name:     String(r.campaign_name || ''),
      ad_group_id:       String(r.ad_group_id),
      ad_group_name:     String(r.ad_group_name || ''),
      ad_id:             String(r.ad_id),
      ad_name:           String(r.ad_name || ''),
      ad_type:           r.ad_type || null,
      ad_status:         r.ad_status || null,
      ad_strength:       r.ad_strength || null,
      headlines:         r.headlines?.length    ? r.headlines    : null,
      descriptions:      r.descriptions?.length ? r.descriptions : null,
      final_url:         r.final_url   || null,
      image_url:         r.image_url   || null,
      date:              String(r.date).split('T')[0],
      cost_micros:       costMicros,
      spend,
      impressions:       Number(r.impressions)      || 0,
      clicks:            Number(r.clicks)           || 0,
      conversions:           Number(r.conversions)          || 0,
      conversions_value:     Number(r.conversions_value)    || 0,
      all_conversions_value: Number(r.all_conversions_value) > 0 ? Number(r.all_conversions_value) : null,
    }
  })

  // Deduplicate by (ad_id, date) — Google Ads API can return duplicate rows
  // for the same ad in a single response, which causes ON CONFLICT errors
  const deduped = Array.from(
    new Map(mapped.map(r => [`${r.ad_id}:${r.date}`, r])).values()
  )

  for (let i = 0; i < deduped.length; i += 200) {
    const { error } = await db
      .from('google_ads_ad_metrics')
      .upsert(deduped.slice(i, i + 200), {
        onConflict: 'connection_id,ad_id,date',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`google_ads_ad_metrics upsert failed: ${error.message}`)
  }

  return deduped.length
}

/**
 * Upsert pMax asset group creative assets into google_ads_asset_group_assets.
 * On conflict (connection_id, asset_group_id, asset_id, field_type) the row is updated.
 */
export async function upsertGooglePMaxAssets(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: GooglePMaxAssetRawRow[]
): Promise<number> {
  const mapped = rows.map(r => ({
    connection_id:    connectionId,
    client_id:        clientId,
    campaign_id:      r.campaign_id,
    campaign_name:    r.campaign_name || null,
    asset_group_id:   r.asset_group_id,
    asset_group_name: r.asset_group_name || null,
    asset_id:         r.asset_id,
    field_type:       r.field_type,
    text_content:     r.text_content,
    image_url:        r.image_url,
    video_id:         r.video_id,
    synced_at:        new Date().toISOString(),
  }))

  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('google_ads_asset_group_assets')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,asset_group_id,asset_id,field_type',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`google_ads_asset_group_assets upsert failed: ${error.message}`)
  }

  return mapped.length
}

/**
 * Upsert Google Ads keyword-level metrics into google_ads_keywords.
 * On conflict (connection_id, keyword_id, date) the row is updated.
 */
export async function upsertGoogleAdsKeywords(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: GoogleAdsKeywordRawRow[]
): Promise<number> {
  const valid = rows.filter(r => r.keyword_id && r.date)
  if (!valid.length) return 0

  const mapped = valid.map(r => {
    const spend = Number(r.cost_micros) / 1_000_000
    return {
      connection_id:     connectionId,
      client_id:         clientId,
      campaign_id:       r.campaign_id,
      campaign_name:     r.campaign_name || null,
      ad_group_id:       r.ad_group_id,
      ad_group_name:     r.ad_group_name || null,
      keyword_id:        r.keyword_id,
      keyword_text:      r.keyword_text,
      match_type:        r.match_type || null,
      keyword_status:    r.keyword_status || null,
      date:              r.date,
      spend,
      impressions:       Number(r.impressions)      || 0,
      clicks:            Number(r.clicks)           || 0,
      conversions:       Number(r.conversions)      || 0,
      conversions_value: Number(r.conversions_value)|| 0,
      synced_at:         new Date().toISOString(),
    }
  })

  // Deduplicate by (keyword_id, date) — prevents ON CONFLICT errors from duplicate rows
  const deduped = Array.from(
    new Map(mapped.map(r => [`${r.keyword_id}:${r.date}`, r])).values()
  )

  for (let i = 0; i < deduped.length; i += 500) {
    const { error } = await db
      .from('google_ads_keywords')
      .upsert(deduped.slice(i, i + 500), {
        onConflict: 'connection_id,keyword_id,date',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`google_ads_keywords upsert failed: ${error.message}`)
  }

  return deduped.length
}

/**
 * Upsert Google Ads negative keywords into google_ads_negative_keywords.
 * On conflict (connection_id, keyword_id, level) the row is replaced — this is a
 * non-dated snapshot so each sync replaces the current state.
 */
export async function upsertGoogleAdsNegativeKeywords(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: GoogleAdsNegativeKeywordRawRow[]
): Promise<number> {
  const valid = rows.filter(r => r.keyword_id && r.keyword_text)
  if (!valid.length) return 0

  const mapped = valid.map(r => ({
    connection_id: connectionId,
    client_id:     clientId,
    campaign_id:   r.campaign_id,
    campaign_name: r.campaign_name || null,
    ad_group_id:   r.ad_group_id   || null,
    ad_group_name: r.ad_group_name || null,
    keyword_id:    r.keyword_id,
    keyword_text:  r.keyword_text,
    match_type:    r.match_type    || null,
    level:         r.level,
    synced_at:     new Date().toISOString(),
  }))

  // Deduplicate by (keyword_id, level) — prevents ON CONFLICT errors from duplicate rows
  const deduped = Array.from(
    new Map(mapped.map(r => [`${r.keyword_id}:${r.level}`, r])).values()
  )

  for (let i = 0; i < deduped.length; i += 500) {
    const { error } = await db
      .from('google_ads_negative_keywords')
      .upsert(deduped.slice(i, i + 500), {
        onConflict: 'connection_id,keyword_id,level',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`google_ads_negative_keywords upsert failed: ${error.message}`)
  }

  return deduped.length
}

/**
 * Upsert Google Ads search terms into google_ads_search_terms.
 * On conflict (connection_id, ad_group_id, search_term, date) the row is updated.
 */
export async function upsertGoogleSearchTerms(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: GoogleAdsSearchTermRawRow[]
): Promise<number> {
  const valid = rows.filter(r => r.search_term && r.date)
  if (!valid.length) return 0

  const mapped = valid.map(r => ({
    connection_id:    connectionId,
    client_id:        clientId,
    campaign_id:      r.campaign_id,
    campaign_name:    r.campaign_name || '',
    ad_group_id:      r.ad_group_id,
    ad_group_name:    r.ad_group_name || '',
    search_term:      r.search_term,
    match_type:       r.match_type || null,
    status:           r.status     || null,
    date:             String(r.date).split('T')[0],
    impressions:      Number(r.impressions)      || 0,
    clicks:           Number(r.clicks)           || 0,
    spend:            Number(r.cost_micros)      / 1_000_000,
    conversions:      Number(r.conversions)      || 0,
    conversion_value: Number(r.conversion_value) || 0,
  }))

  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('google_ads_search_terms')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,ad_group_id,search_term,date',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`google_ads_search_terms upsert failed: ${error.message}`)
  }

  return mapped.length
}

/**
 * Upsert Meta Ads ad-level metrics into meta_ads_ad_metrics.
 * On conflict (connection_id, ad_id, date) the row is updated.
 */
export async function upsertMetaAdsAdMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: MetaAdRawRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date && r.ad_id)
  if (!valid.length) return 0

  const mapped = valid.map(r => {
    // Use `|| undefined` for metadata fields so JSON.stringify omits them when empty.
    // Supabase's REST client serialises rows to JSON before sending; JSON.stringify
    // drops undefined values entirely, which means PostgREST's ON CONFLICT DO UPDATE
    // SET clause will NOT include those columns — preserving whatever the DB already
    // has rather than overwriting with empty/null.  This is the intended behaviour for
    // creative fields that arrive empty in the first sync pass (metrics-only) and get
    // populated in the second pass (creative enrichment).
    // NOTE: `null || undefined` evaluates to `undefined`, so legitimately-null fields
    // (e.g. adset_id for a campaign without an ad-set) are also omitted.  For new rows
    // the column gets its DB DEFAULT (NULL), which is correct; for existing rows the
    // stored value is kept unchanged — also correct since ad set membership is fixed.
    const row: Record<string, unknown> = {
      connection_id:    connectionId,
      client_id:        clientId,
      campaign_id:      String(r.campaign_id),
      campaign_name:    r.campaign_name || undefined,
      adset_id:         r.adset_id      || undefined,
      adset_name:       r.adset_name    || undefined,
      ad_id:            String(r.ad_id),
      ad_name:          r.ad_name       || undefined,
      // Creative fields: omit when empty so existing DB values are preserved
      thumbnail_url:    r.thumbnail_url     || undefined,
      image_url:        r.image_url         || undefined,
      video_id:         r.video_id          || undefined,
      video_thumb_url:  r.video_thumb_url   || undefined,
      creative_body:    r.creative_body     || undefined,
      creative_title:   r.creative_title    || undefined,
      creative_link_url:r.creative_link_url || undefined,
      ad_status:           r.ad_status            || undefined,
      adset_daily_budget:  r.adset_daily_budget   ?? undefined,
      // Metrics always overwrite (explicit values, never undefined)
      date:             String(r.date).split('T')[0],
      spend:            Number(r.spend)       || 0,
      impressions:      Number(r.impressions) || 0,
      clicks:           Number(r.clicks)      || 0,
      reach:            Number(r.reach)       || 0,
      actions:          r.actions,
      action_values:    r.action_values,
      conversions:      Number(r.conversions)      || 0,
      conversion_value: Number(r.conversion_value) || 0,
    }
    // Remove undefined keys so they're truly absent from JSON payload
    Object.keys(row).forEach(k => row[k] === undefined && delete row[k])
    return row
  })

  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('meta_ads_ad_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,ad_id,date',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`meta_ads_ad_metrics upsert failed: ${error.message}`)
  }

  return mapped.length
}

/**
 * Auto-insert newly discovered campaigns into client_campaign_assignments.
 * Uses ON CONFLICT DO NOTHING to preserve any admin-set category or config.
 */
async function upsertCampaignAssignments(
  db: ReturnType<typeof createAdminClient>,
  clientId: string,
  source: string,
  rows: { campaign_id: string; campaign_name: string }[]
) {
  const unique = Array.from(
    new Map(rows.map(r => [r.campaign_id, r])).values()
  )
  const assignments = unique.map(r => ({
    client_id:     clientId,
    source,
    campaign_id:   r.campaign_id,
    campaign_name: r.campaign_name,
    // category_id starts as NULL — admin assigns a category in the Campaign Categories UI
  }))

  if (assignments.length > 0) {
    await db
      .from('client_campaign_assignments')
      .upsert(assignments, {
        onConflict: 'client_id,source,campaign_id',
        ignoreDuplicates: true, // never overwrite admin-set fields
      })
  }
}

/**
 * Upsert GoHighLevel CRM metrics into ghl_metrics.
 * On conflict (connection_id, date) the row is updated.
 */
export async function upsertGhlMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: GhlRawRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date)
  if (!valid.length) return 0

  // What each of these days already holds. raw_data is written by more than one version of this
  // connector — an older build knows nothing about lead_sources or attribution — and replacing the
  // column wholesale let whichever ran last erase the other's work. Read first, merge below.
  const dates = Array.from(new Set(valid.map(r => String(r.date).split('T')[0])))
  const existingRaw = new Map<string, Record<string, unknown>>()
  try {
    for (let i = 0; i < dates.length; i += 500) {
      const { data } = await db
        .from('ghl_metrics')
        .select('date,raw_data')
        .eq('connection_id', connectionId)
        .in('date', dates.slice(i, i + 500))
      for (const row of (data ?? []) as { date: string; raw_data: unknown }[]) {
        if (row.raw_data && typeof row.raw_data === 'object') {
          existingRaw.set(String(row.date).split('T')[0], row.raw_data as Record<string, unknown>)
        }
      }
    }
  } catch (e) {
    // A failed read must not cost the sync. Worst case we write what we have, as before.
    console.error('[sync] ghl_metrics raw_data preload failed:', e)
  }

  const mapped = valid.map(r => ({
    connection_id:    connectionId,
    client_id:        clientId,
    date:             String(r.date).split('T')[0],
    contacts_created: r.contacts_created,
    total_calls:      r.total_calls,
    incoming_calls:   r.incoming_calls,
    outgoing_calls:   r.outgoing_calls,
    missed_calls:     r.missed_calls,
    forms_submitted:  r.forms_submitted,
    reviews_sent:     r.reviews_sent,
    reviews_received: r.reviews_received,
    spam_leads:       r.spam_leads,
    emails_sent:        r.emails_sent,
    sms_sent:           r.sms_sent,
    new_opportunities:  r.new_opportunities,
    won_opportunities:  r.won_opportunities,
    lost_opportunities: r.lost_opportunities,
    won_value:          r.won_value,
    // Keys this sync produced win, including empty ones — a day with no leads has to be able to
    // write lead_sources: {} over yesterday's. Keys it says nothing about are left alone.
    raw_data:           { ...(existingRaw.get(String(r.date).split('T')[0]) ?? {}), ...(r.raw_data ?? {}) },
    synced_at:        new Date().toISOString(),
  }))

  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('ghl_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,date',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`ghl_metrics upsert failed: ${error.message}`)
  }

  return mapped.length
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync job helpers
// ─────────────────────────────────────────────────────────────────────────────

async function startSyncJob(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  jobType: SyncJobType,
  dateFrom: string,
  dateTo: string,
  triggeredBy?: 'cron' | 'admin' | 'system'
): Promise<string> {
  const { data } = await db
    .from('sync_jobs')
    .insert({
      connection_id: connectionId,
      client_id:     clientId,
      job_type:      jobType,
      status:        'running',
      date_from:     dateFrom,
      date_to:       dateTo,
      triggered_by:  triggeredBy ?? null,
    })
    .select('id')
    .single()
  return data?.id || ''
}

async function completeSyncJob(
  db: ReturnType<typeof createAdminClient>,
  jobId: string,
  status: 'success' | 'error',
  records: number,
  errorMessage?: string
) {
  if (!jobId) return
  await db.from('sync_jobs').update({
    status,
    records_synced: records,
    error_message:  errorMessage,
    completed_at:   new Date().toISOString(),
  }).eq('id', jobId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Date range helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns [dateFrom, dateTo] as YYYY-MM-DD strings for a trailing window ending today. */
function computeDateRange(days: number): [string, string] {
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - (days - 1))
  return [fmt(from), fmt(to)]
}

// ─────────────────────────────────────────────────────────────────────────────
// GA4 / GSC / GBP upsert functions
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertGA4Metrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: import('./connectors/google-analytics').GA4RawRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date)
  if (!valid.length) return 0

  const mapped = valid.map(r => ({
    connection_id:        connectionId,
    client_id:            clientId,
    date:                 r.date,
    channel_group:        r.channel_group || '',
    sessions:             r.sessions,
    users:                r.users,
    new_users:            r.new_users,
    page_views:           r.page_views,
    conversions:          r.conversions,
    bounce_rate:          r.bounce_rate,
    avg_session_duration: r.avg_session_duration,
    engaged_sessions:     r.engaged_sessions ?? 0,
    synced_at:            new Date().toISOString(),
  }))

  // Delete existing rows for the synced date range before upserting.
  // Required because the channel_group value for unattributed sessions changed from
  // 'Direct' (old sync.ts fallback) to '' — the UNIQUE key is (connection_id, date, channel_group)
  // so old and new rows have different conflict keys and both would accumulate without a delete.
  const minDate = mapped.reduce((m, r) => r.date < m ? r.date : m, mapped[0].date)
  const maxDate = mapped.reduce((m, r) => r.date > m ? r.date : m, mapped[0].date)
  const { error: delErr } = await db
    .from('ga4_metrics')
    .delete()
    .eq('connection_id', connectionId)
    .gte('date', minDate)
    .lte('date', maxDate)
  if (delErr) {
    console.error('[sync] ga4_metrics pre-delete error:', delErr)
    throw new Error(`[sync] ga4_metrics pre-delete failed: ${delErr.message}`)
  }

  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('ga4_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,date,channel_group',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`[sync] ga4_metrics upsert failed (batch ${i}): ${error.message}`)
  }
  return mapped.length
}

export async function upsertGA4SourceMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: import('./connectors/google-analytics').GA4SourceRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date)
  if (!valid.length) return 0

  const mapped = valid.map(r => ({
    connection_id:    connectionId,
    client_id:        clientId,
    date:             r.date,
    source:           r.source,
    medium:           r.medium,
    campaign:         r.campaign,
    sessions:         r.sessions,
    users:            r.users,
    new_users:        r.new_users,
    page_views:       r.page_views,
    conversions:      r.conversions,
    engaged_sessions: r.engaged_sessions,
    synced_at:        new Date().toISOString(),
  }))

  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('ga4_source_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,date,source,medium,campaign',
        ignoreDuplicates: false,
      })
    if (error) console.error(`[sync] ga4_source_metrics upsert error (batch ${i}):`, error)
  }
  return mapped.length
}

/**
 * GA4 detail by device, city, landing page and key event. Best-effort: a failure is logged and
 * the rest of the GA4 sync still succeeds, including before migration 217 is applied.
 * The synced dates are cleared first, because values drop out between syncs (an event stops
 * being a key event, a page stops being a top landing page) and would otherwise linger.
 */
export async function upsertGA4DimensionMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: import('./connectors/google-analytics').GA4DimensionRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date && r.value)
  if (!valid.length) return 0

  const syncedAt = new Date().toISOString()
  const mapped = valid.map(r => ({
    connection_id:    connectionId,
    client_id:        clientId,
    date:             r.date,
    dimension:        r.dimension,
    value:            r.value,
    sessions:         r.sessions,
    users:            r.users,
    conversions:      r.conversions,
    engaged_sessions: r.engaged_sessions,
    event_count:      r.event_count,
    synced_at:        syncedAt,
  }))

  try {
    const minDate = mapped.reduce((m, r) => (r.date < m ? r.date : m), mapped[0].date)
    const maxDate = mapped.reduce((m, r) => (r.date > m ? r.date : m), mapped[0].date)
    const { error: delErr } = await db
      .from('ga4_dimension_metrics')
      .delete()
      .eq('connection_id', connectionId)
      .gte('date', minDate)
      .lte('date', maxDate)
    if (delErr) {
      console.error('[sync] ga4_dimension_metrics pre-delete error:', delErr.message)
      return 0
    }
    for (let i = 0; i < mapped.length; i += 500) {
      const { error } = await db
        .from('ga4_dimension_metrics')
        .upsert(mapped.slice(i, i + 500), { onConflict: 'connection_id,date,dimension,value', ignoreDuplicates: false })
      if (error) {
        console.error(`[sync] ga4_dimension_metrics upsert error (batch ${i}):`, error.message)
        return i
      }
    }
  } catch (e) {
    console.error('[sync] ga4_dimension_metrics failed:', e)
    return 0
  }
  return mapped.length
}

/**
 * Calls from Google Ads per campaign per day. Best-effort, like the GA4 detail: a failure is logged
 * and the rest of the Ads sync still succeeds, including before migration 218 is applied.
 * The synced dates are cleared first, so a day whose calls dropped to zero doesn't keep old counts.
 */
export async function upsertGoogleAdsCallMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: import('./connectors/google-ads').GoogleAdsCallRawRow[],
  dateFrom: string,
  dateTo: string
): Promise<number> {
  try {
    const { error: delErr } = await db
      .from('google_ads_call_metrics')
      .delete()
      .eq('connection_id', connectionId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
    if (delErr) {
      console.error('[sync] google_ads_call_metrics pre-delete error:', delErr.message)
      return 0
    }
    const syncedAt = new Date().toISOString()
    const mapped = rows.filter(r => r.date).map(r => ({
      connection_id: connectionId, client_id: clientId, date: r.date,
      campaign_id: r.campaign_id, campaign_name: r.campaign_name || null,
      phone_calls: r.phone_calls, calls_received: r.calls_received, calls_missed: r.calls_missed,
      call_seconds: r.call_seconds, calls_from_ad: r.calls_from_ad, calls_from_site: r.calls_from_site,
      synced_at: syncedAt,
    }))
    for (let i = 0; i < mapped.length; i += 500) {
      const { error } = await db
        .from('google_ads_call_metrics')
        .upsert(mapped.slice(i, i + 500), { onConflict: 'connection_id,date,campaign_id', ignoreDuplicates: false })
      if (error) {
        console.error(`[sync] google_ads_call_metrics upsert error (batch ${i}):`, error.message)
        return i
      }
    }
    return mapped.length
  } catch (e) {
    console.error('[sync] google_ads_call_metrics failed:', e)
    return 0
  }
}

/**
 * Stores a location's reviews, replies included.
 *
 * Reviews are edited and replied to after the fact, so every row is upserted rather than inserted
 * once: a reply written today lands on a review left last year. Nothing is deleted first — a
 * review Google stops returning (page cap, or the reviewer removed it) keeps the history intact.
 */
export async function upsertGBPReviews(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  locationId: string,
  reviews: import('./connectors/google-business-profile').GBPReview[]
): Promise<number> {
  const valid = reviews.filter(r => r.review_id && r.created_at)
  if (valid.length === 0) return 0
  try {
    const syncedAt = new Date().toISOString()
    const mapped = valid.map(r => ({
      connection_id: connectionId,
      client_id:     clientId,
      location_id:   locationId,
      review_id:     r.review_id,
      reviewer_name: r.reviewer_name || null,
      star_rating:   r.star_rating,
      comment:       r.comment || null,
      created_at:    r.created_at,
      updated_at:    r.updated_at,
      reply_comment: r.reply_comment,
      replied_at:    r.replied_at,
      synced_at:     syncedAt,
    }))
    for (let i = 0; i < mapped.length; i += 200) {
      const { error } = await db
        .from('gbp_reviews')
        .upsert(mapped.slice(i, i + 200), { onConflict: 'connection_id,review_id', ignoreDuplicates: false })
      if (error) {
        console.error(`[sync] gbp_reviews upsert error (batch ${i}):`, error.message)
        return i
      }
    }
    return mapped.length
  } catch (e) {
    console.error('[sync] gbp_reviews failed:', e)
    return 0
  }
}

/**
 * Normalises text down to the letters and digits, so a review quoted inside a post still matches
 * after the copy has been rewrapped, re-punctuated or had emoji dropped into it.
 */
function socialNormalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Which review each post was sharing, where the post quotes it.
 *
 * A review's own words are a strong enough fingerprint on their own: a run of 60 normalised
 * characters from a real review does not appear in unrelated copy by accident. Short reviews are
 * skipped entirely rather than guessed at — "Great service" would match half the posts ever
 * written, and a wrong link here would misreport our own work.
 */
function matchPostsToReviews(
  posts: { post_id: string; summary: string }[],
  reviews: { review_id: string; comment: string | null }[],
): Map<string, string> {
  const MIN_FINGERPRINT = 40
  const usable = reviews
    .map(r => ({ review_id: r.review_id, text: socialNormalise(r.comment ?? '') }))
    .filter(r => r.text.length >= MIN_FINGERPRINT)

  const byPost = new Map<string, string>()
  if (usable.length === 0) return byPost

  for (const p of posts) {
    const hay = socialNormalise(p.summary)
    if (hay.length < MIN_FINGERPRINT) continue
    // The longest match wins, so a review that quotes another review's opening line loses to the
    // one that matches further in.
    let best = '', bestLen = 0
    for (const r of usable) {
      const probe = r.text.slice(0, 120)
      if (probe.length > bestLen && hay.includes(probe.slice(0, MIN_FINGERPRINT))
          && hay.includes(probe.slice(0, Math.min(probe.length, 80)))) {
        best = r.review_id; bestLen = probe.length
      }
    }
    if (best) byPost.set(p.post_id, best)
  }
  return byPost
}

/**
 * Stores the posts we published on a client's behalf, one row per post — never one per network,
 * so a post that went to two pages cannot double-count its own engagement.
 *
 * Before migration 221 the write fails quietly and the rest of the GHL sync is unaffected.
 */
export async function upsertGhlSocialPosts(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  locationId: string,
  posts: import('./connectors/ghl').GhlSocialPost[]
): Promise<number> {
  const valid = posts.filter(p => p.post_id)
  if (valid.length === 0) return 0
  try {
    // The reviews we already hold for this client, to tie each post back to what it was sharing.
    let reviews: { review_id: string; comment: string | null }[] = []
    try {
      const { data } = await db
        .from('gbp_reviews')
        .select('review_id,comment')
        .eq('client_id', clientId)
        .not('comment', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1000)
      reviews = (data ?? []) as { review_id: string; comment: string | null }[]
    } catch { /* no reviews table yet, or none stored — posts still report on their own */ }

    const matched = matchPostsToReviews(valid, reviews)
    const syncedAt = new Date().toISOString()
    const mapped = valid.map(p => ({
      connection_id: connectionId,
      client_id:     clientId,
      location_id:   locationId,
      post_id:       p.post_id,
      status:        p.status,
      platforms:     p.platforms,
      account_names: p.account_names,
      summary:       p.summary || null,
      media_url:     p.media_url,
      post_url:      p.post_url,
      created_at:    p.created_at,
      published_at:  p.published_at,
      likes:         p.likes,
      comments:      p.comments,
      shares:        p.shares,
      review_id:     matched.get(p.post_id) ?? null,
      raw:           p.raw,
      synced_at:     syncedAt,
    }))
    console.log(`[sync] social posts: ${matched.size} of ${mapped.length} matched to a review`)

    for (let i = 0; i < mapped.length; i += 200) {
      const { error } = await db
        .from('ghl_social_posts')
        .upsert(mapped.slice(i, i + 200), { onConflict: 'connection_id,post_id', ignoreDuplicates: false })
      if (error) {
        console.error(`[sync] ghl_social_posts upsert error (batch ${i}):`, error.message)
        return i
      }
    }
    return mapped.length
  } catch (e) {
    console.error('[sync] ghl_social_posts failed:', e)
    return 0
  }
}

/**
 * Stores what each campaign's conversions were actually made of, by conversion action.
 *
 * Conversions are written as Google reports them, fractions and all. Under data-driven attribution
 * a single conversion is split across the campaigns that contributed to it — 2.5 and 4.9971 are
 * real values from a live account — and rounding them on the way in would quietly invent a
 * precision the figure does not have.
 *
 * Before migration 222 the write fails quietly and the rest of the Google sync is unaffected.
 */
export async function upsertGoogleAdsConversionActions(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: import('./connectors/google-ads').GoogleAdsConversionActionRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date && r.action_name)
  if (valid.length === 0) return 0
  try {
    const syncedAt = new Date().toISOString()
    // One row per campaign-day-action; Google can return the same triple more than once across
    // pages, and the last value for a triple is the one to keep.
    const byKey = new Map<string, Record<string, unknown>>()
    for (const r of valid) {
      byKey.set(`${r.campaign_id}|${r.date}|${r.action_name}`, {
        connection_id:   connectionId,
        client_id:       clientId,
        campaign_id:     r.campaign_id,
        campaign_name:   r.campaign_name || null,
        date:            r.date,
        action_name:     r.action_name,
        action_category: r.action_category || null,
        conversions:     r.conversions,
        synced_at:       syncedAt,
      })
    }
    const mapped = Array.from(byKey.values())
    for (let i = 0; i < mapped.length; i += 500) {
      const { error } = await db
        .from('google_ads_conversion_actions')
        .upsert(mapped.slice(i, i + 500), {
          onConflict: 'connection_id,campaign_id,date,action_name',
          ignoreDuplicates: false,
        })
      if (error) {
        console.error(`[sync] google_ads_conversion_actions upsert error (batch ${i}):`, error.message)
        return i
      }
    }
    return mapped.length
  } catch (e) {
    console.error('[sync] google_ads_conversion_actions failed:', e)
    return 0
  }
}

/**
 * Stores Google's individual calls, so the CRM sync can match them to contacts by time.
 *
 * The range is cleared first rather than upserted: two calls can genuinely share a start second,
 * a duration and a campaign, so there is no natural key to conflict on and no need for one.
 */
export async function upsertGoogleAdsCallEvents(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  events: import('./connectors/google-ads').GoogleAdsCallEvent[],
  dateFrom: string,
  dateTo: string
): Promise<number> {
  try {
    const { error: delErr } = await db
      .from('google_ads_calls')
      .delete()
      .eq('connection_id', connectionId)
      .gte('started_at', `${dateFrom}T00:00:00Z`)
      .lte('started_at', `${dateTo}T23:59:59Z`)
    if (delErr) {
      console.error('[sync] google_ads_calls pre-delete error:', delErr.message)
      return 0
    }
    const valid = events.filter(e => e.started_at)
    if (valid.length === 0) return 0

    const syncedAt = new Date().toISOString()
    const mapped = valid.map(e => ({
      connection_id: connectionId,
      client_id:     clientId,
      // Google sends "YYYY-MM-DD HH:MM:SS" in the ad account's timezone. Stored as written, with a
      // Z so Postgres will take it; the matcher works the real offset out from the data.
      started_at:    `${e.started_at.replace(' ', 'T')}Z`,
      duration_seconds: e.duration_seconds,
      call_status:   e.call_status || null,
      from_ad:       e.from_ad,
      campaign_id:   e.campaign_id || null,
      synced_at:     syncedAt,
    }))
    for (let i = 0; i < mapped.length; i += 500) {
      const { error } = await db.from('google_ads_calls').insert(mapped.slice(i, i + 500))
      if (error) {
        console.error(`[sync] google_ads_calls insert error (batch ${i}):`, error.message)
        return i
      }
    }
    return mapped.length
  } catch (e) {
    console.error('[sync] google_ads_calls failed:', e)
    return 0
  }
}

export async function upsertGSCMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: import('./connectors/google-search-console').GSCRawRow[],
  ignoreDuplicates = false
): Promise<number> {
  const valid = rows.filter(r => r.date)
  if (!valid.length) return 0

  const mapped = valid.map(r => ({
    connection_id: connectionId,
    client_id:     clientId,
    date:          r.date,
    query:         r.query ?? '',
    page:          r.page  ?? '',
    // country: removed — no longer fetched (dropped from GSC API dimensions)
    clicks:        r.clicks,
    impressions:   r.impressions,
    ctr:           r.ctr,
    position:      r.position,
    synced_at:     new Date().toISOString(),
  }))

  for (let i = 0; i < mapped.length; i += 1000) {
    const { error } = await db
      .from('gsc_metrics')
      .upsert(mapped.slice(i, i + 1000), {
        onConflict: 'connection_id,date,query,page',
        ignoreDuplicates,
      })
    if (error) console.error(`[sync] gsc_metrics upsert error (batch ${i}):`, error)
  }
  return mapped.length
}

export async function upsertGSCDailyTotals(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: GSCDailyTotalRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date)
  if (!valid.length) return 0

  const mapped = valid.map(r => ({
    connection_id: connectionId,
    client_id:     clientId,
    date:          r.date,
    clicks:        r.clicks,
    impressions:   r.impressions,
    ctr:           r.ctr,
    position:      r.position,
    synced_at:     new Date().toISOString(),
  }))

  for (let i = 0; i < mapped.length; i += 500) {
    const { error } = await db
      .from('gsc_daily_totals')
      .upsert(mapped.slice(i, i + 500), {
        onConflict: 'connection_id,date',
        ignoreDuplicates: false,
      })
    if (error) console.error(`[sync] gsc_daily_totals upsert error (batch ${i}):`, error)
  }
  return mapped.length
}

export async function upsertGSCQueryTotals(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: GSCQueryTotalRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date && r.query)
  if (!valid.length) return 0

  const mapped = valid.map(r => ({
    connection_id: connectionId,
    client_id:     clientId,
    date:          r.date,
    query:         r.query,
    clicks:        r.clicks,
    impressions:   r.impressions,
    ctr:           r.ctr,
    position:      r.position,
    synced_at:     new Date().toISOString(),
  }))

  for (let i = 0; i < mapped.length; i += 500) {
    const { error } = await db
      .from('gsc_query_totals')
      .upsert(mapped.slice(i, i + 500), {
        onConflict: 'connection_id,date,query',
        ignoreDuplicates: false,
      })
    if (error) console.error(`[sync] gsc_query_totals upsert error (batch ${i}):`, error)
  }
  return mapped.length
}

export async function upsertGSCPageTotals(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: GSCPageTotalRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date && r.page)
  if (!valid.length) return 0

  const mapped = valid.map(r => ({
    connection_id: connectionId,
    client_id:     clientId,
    date:          r.date,
    page:          r.page,
    clicks:        r.clicks,
    impressions:   r.impressions,
    ctr:           r.ctr,
    position:      r.position,
    synced_at:     new Date().toISOString(),
  }))

  for (let i = 0; i < mapped.length; i += 500) {
    const { error } = await db
      .from('gsc_page_totals')
      .upsert(mapped.slice(i, i + 500), {
        onConflict: 'connection_id,date,page',
        ignoreDuplicates: false,
      })
    if (error) console.error(`[sync] gsc_page_totals upsert error (batch ${i}):`, error)
  }
  return mapped.length
}

export async function upsertGBPMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: import('./connectors/google-business-profile').GBPRawRow[]
): Promise<number> {
  const valid = rows.filter(r => r.date && r.location_id)
  if (!valid.length) return 0

  const mapped = valid.map(r => {
    const row: Record<string, unknown> = {
    connection_id:      connectionId,
    client_id:          clientId,
    date:               r.date,
    location_id:        r.location_id,
    location_name:      r.location_name || null,
    views_search:       r.views_search,
    views_maps:         r.views_maps,
    website_clicks:     r.website_clicks,
    call_clicks:        r.call_clicks,
    direction_clicks:   r.direction_clicks,
    reviews_count:      r.reviews_count,
    reviews_avg_rating: r.reviews_avg_rating || null,
    synced_at:          new Date().toISOString(),
    }
    // Only sent when this sync captured the listing setup. Sending null when the fetch failed
    // would upsert over a good snapshot and empty the panel until some later sync happened to
    // succeed — a transient refusal should cost nothing.
    const snapshot = (r as unknown as { raw_data?: unknown }).raw_data
    if (snapshot) row.raw_data = snapshot
    return row
  })

  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('gbp_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,location_id,date',
        ignoreDuplicates: false,
      })
    if (error) console.error(`[sync] gbp_metrics upsert error (batch ${i}):`, error)
  }
  return mapped.length
}

export async function upsertAhrefsMetrics(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: AhrefsRow[]
): Promise<number> {
  if (!rows.length) return 0
  const mapped = rows.map(r => ({
    connection_id:          connectionId,
    client_id:              clientId,
    date:                   r.date,
    domain_rating:          r.domain_rating          ?? null,
    ahrefs_rank:            r.ahrefs_rank            ?? null,
    backlinks:              r.backlinks              ?? null,
    referring_domains:      r.referring_domains      ?? null,
    organic_keywords:       r.organic_keywords       ?? null,
    organic_traffic:        r.organic_traffic        ?? null,
    traffic_value:          r.traffic_value          ?? null,
    paid_keywords:          r.paid_keywords          ?? null,
    paid_traffic:           r.paid_traffic           ?? null,
    new_backlinks:          r.new_backlinks          ?? null,
    lost_backlinks:         r.lost_backlinks         ?? null,
    new_referring_domains:  r.new_referring_domains  ?? null,
    lost_referring_domains: r.lost_referring_domains ?? null,
    synced_at:              new Date().toISOString(),
  }))
  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('ahrefs_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,date',
        ignoreDuplicates: false,
      })
    if (error) console.error(`[sync] ahrefs_metrics upsert error (batch ${i}):`, error)
  }
  return mapped.length
}

export async function upsertAhrefsKeywords(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: AhrefsKeywordRow[]
): Promise<void> {
  if (!rows.length) return
  const mapped = rows.map(r => ({
    connection_id: connectionId,
    client_id:     clientId,
    date:          r.date,
    keyword:       r.keyword,
    position:      r.position   ?? null,
    volume:        r.volume     ?? null,
    traffic:       r.traffic    ?? null,
    difficulty:    r.difficulty ?? null,
    synced_at:     new Date().toISOString(),
  }))
  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('ahrefs_keywords')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,date,keyword',
        ignoreDuplicates: false,
      })
    if (error) console.error(`[sync] ahrefs_keywords upsert error (batch ${i}):`, error)
  }
}

export async function upsertAhrefsPages(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  rows: AhrefsPageRow[]
): Promise<void> {
  if (!rows.length) return
  const mapped = rows.map(r => ({
    connection_id:    connectionId,
    client_id:        clientId,
    date:             r.date,
    url:              r.url,
    organic_traffic:  r.organic_traffic  ?? null,
    organic_keywords: r.organic_keywords ?? null,
    synced_at:        new Date().toISOString(),
  }))
  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('ahrefs_pages')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,date,url',
        ignoreDuplicates: false,
      })
    if (error) console.error(`[sync] ahrefs_pages upsert error (batch ${i}):`, error)
  }
}
