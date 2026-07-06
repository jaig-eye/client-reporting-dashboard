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
import { fetchGoogleSearchTerms } from './connectors/google-ads'
import { fetchMetaAdMetrics } from './connectors/meta-ads'
import type { GhlRawRow } from './connectors/ghl'
import type { ClientConnection, Connector, SyncJobType } from './types'
import type { GoogleAdsRawRow, MetaAdsRawRow } from './connectors/types'
import { fetchAhrefsKeywords, fetchAhrefsPages } from './connectors/ahrefs'
import type { AhrefsKeywordRow, AhrefsPageRow } from './connectors/ahrefs'
import { fetchSearchAnalytics } from './connectors/google-search-console'
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
export const INCREMENTAL_DAYS = 7

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

      // Fetch source-specific metrics
      const onProgress = (pct: number, note: string) => {
        db.from('sync_jobs').update({ progress_pct: pct, progress_note: note }).eq('id', jobId).then(() => {})
      }
      const result = await adapter.fetchMetrics(
        connection.external_id,
        auth,
        connection.connector.config,
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
        const [adResult, assetResult, kwResult, negResult, stResult] = await Promise.allSettled([
          fetchGoogleAdMetrics(connection.external_id, auth, connection.connector.config, resolvedFrom, resolvedTo),
          fetchGooglePMaxAssets(connection.external_id, auth, connection.connector.config),
          fetchGoogleSearchKeywords(connection.external_id, auth, connection.connector.config, resolvedFrom, resolvedTo),
          fetchGoogleNegativeKeywords(connection.external_id, auth, connection.connector.config),
          fetchGoogleSearchTerms(connection.external_id, auth, connection.connector.config, resolvedFrom, resolvedTo),
        ])

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
        recordCount = await upsertGBPMetrics(
          db,
          connection.id,
          clientId,
          result.rows as unknown as import('./connectors/google-business-profile').GBPRawRow[]
        )
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

        const [qFetch, pFetch, rawRows] = await Promise.all([
          fetchSearchAnalytics(siteUrl, accessToken, chunkFrom, chunkTo, dataState, ['date', 'query']),
          fetchSearchAnalytics(siteUrl, accessToken, chunkFrom, chunkTo, dataState, ['date', 'page'], pageFilter),
          needs3D
            ? fetchSearchAnalytics(siteUrl, accessToken, chunkFrom, chunkTo, dataState, undefined, pageFilter)
            : Promise.resolve([] as GSCRawRow[]),
        ])

        // Daily totals — aggregate query rows by date
        type DailyAcc = { date: string; clicks: number; impressions: number; posSum: number }
        const dailyMap = new Map<string, DailyAcc>()
        for (const r of qFetch) {
          const d = dailyMap.get(r.date) ?? { date: r.date, clicks: 0, impressions: 0, posSum: 0 }
          d.clicks += r.clicks; d.impressions += r.impressions; d.posSum += r.position * r.impressions
          dailyMap.set(r.date, d)
        }
        const dailyRows: GSCDailyTotalRow[] = Array.from(dailyMap.values()).map(d => ({
          date: d.date, clicks: d.clicks, impressions: d.impressions,
          ctr:      d.impressions > 0 ? d.clicks / d.impressions : 0,
          position: d.impressions > 0 ? d.posSum / d.impressions : 0,
        }))

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
    await db
      .from('google_ads_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,campaign_id,date',
        ignoreDuplicates: false,
      })
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
    raw_data:           r.raw_data ?? {},
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
  if (delErr) console.error('[sync] ga4_metrics pre-delete error:', delErr)

  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('ga4_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,date,channel_group',
        ignoreDuplicates: false,
      })
    if (error) console.error(`[sync] ga4_metrics upsert error (batch ${i}):`, error)
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

  const mapped = valid.map(r => ({
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
  }))

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
    await db
      .from('ahrefs_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,date',
        ignoreDuplicates: false,
      })
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
