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
import type { GooglePMaxAssetRawRow, GoogleAdsKeywordRawRow, GoogleAdsNegativeKeywordRawRow } from './connectors/google-ads'
import { fetchMetaAdMetrics } from './connectors/meta-ads'
import type { GhlRawRow } from './connectors/ghl'
import type { ClientConnection, Connector, SyncJobType } from './types'
import type { GoogleAdsRawRow, MetaAdsRawRow } from './connectors/types'
import { fetchAhrefsKeywords, fetchAhrefsPages } from './connectors/ahrefs'
import type { AhrefsKeywordRow, AhrefsPageRow } from './connectors/ahrefs'

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
export const INCREMENTAL_DAYS = 3

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
      const result = await adapter.fetchMetrics(
        connection.external_id,
        auth,
        connection.connector.config,
        resolvedFrom,
        resolvedTo
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
        const [adResult, assetResult, kwResult, negResult] = await Promise.allSettled([
          fetchGoogleAdMetrics(connection.external_id, auth, connection.connector.config, resolvedFrom, resolvedTo),
          fetchGooglePMaxAssets(connection.external_id, auth, connection.connector.config),
          fetchGoogleSearchKeywords(connection.external_id, auth, connection.connector.config, resolvedFrom, resolvedTo),
          fetchGoogleNegativeKeywords(connection.external_id, auth, connection.connector.config),
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
      } else if (connection.connector.type === 'meta_ads') {
        recordCount = await upsertMetaAdsMetrics(
          db,
          connection.id,
          clientId,
          result.rows as MetaAdsRawRow[],
          result.discoveredActions ?? []
        )
        // Ad-level sync (best-effort)
        try {
          const adRows = await fetchMetaAdMetrics(
            connection.external_id,
            auth,
            resolvedFrom,
            resolvedTo
          )
          console.log(`[sync] Meta ad-level: ${adRows.length} rows for connection ${connection.id}`)
          if (adRows.length > 0) {
            await upsertMetaAdsAdMetrics(db, connection.id, clientId, adRows)
          }
        } catch (adErr) {
          adLevelError = `Ad-level sync failed: ${String(adErr)}`
          console.error(`[sync] Meta ad-level sync failed for connection ${connection.id}:`, adErr)
        }
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
          db, adapter, connection, auth, gscFrom, resolvedTo, clientId, jobType
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
      throw err
    }
  }

  return totalRecords
}

// ─────────────────────────────────────────────────────────────────────────────
// GSC chunked sync helper
// ─────────────────────────────────────────────────────────────────────────────

const GSC_CHUNK_DAYS        = 30
const GSC_CHUNK_CONCURRENCY = 2

/**
 * Fetches GSC data in 30-day windows and upserts each chunk immediately.
 * Chunks are fetched in parallel batches (GSC_CHUNK_CONCURRENCY at a time) to
 * keep 2-year backfills fast without hammering the GSC API or blowing memory.
 * ignoreDuplicates=false so re-syncs always overwrite with finalized GSC values.
 */
async function syncGSCInChunks(
  db:           ReturnType<typeof createAdminClient>,
  adapter:      import('./connectors/types').ConnectorAdapter,
  connection:   ClientConnection & { connector: Connector },
  auth:         Record<string, unknown>,
  dateFrom:     string,
  dateTo:       string,
  clientId:     string,
  jobType:      SyncJobType = 'manual'
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

  // Process chunks in parallel batches to avoid sequential API latency.
  // 4 concurrent chunks keeps a 2-year backfill (24 chunks) down to ~6 rounds.
  for (let i = 0; i < chunks.length; i += GSC_CHUNK_CONCURRENCY) {
    const batch = chunks.slice(i, i + GSC_CHUNK_CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(async ({ from: chunkFrom, to: chunkTo }) => {
        const chunkResult = await adapter.fetchMetrics(
          connection.external_id, auth, connection.connector.config, chunkFrom, chunkTo
        )
        let written = 0
        if (chunkResult.rows.length > 0) {
          written = await upsertGSCMetrics(
            db, connection.id, clientId,
            chunkResult.rows as unknown as import('./connectors/google-search-console').GSCRawRow[],
            ignoreDuplicates
          )
        }
        console.log(`[sync] GSC chunk ${chunkFrom} → ${chunkTo}: ${chunkResult.rows.length} rows`)
        return written
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
      // Derived (approximate — will be remapped at query time)
      conversions:       conversionTotal,
      conversion_value:  revenueTotal,
      roas:              spend > 0 && revenueTotal > 0 ? revenueTotal / spend : 0,
      ctr:               impressions > 0 ? clicks / impressions : 0,
      cpc:               clicks > 0 ? spend / clicks : 0,
      cpm:               impressions > 0 ? (spend / impressions) * 1000 : 0,
      daily_budget:      r.daily_budget != null ? r.daily_budget : null,
      // Accumulated action types for the conversion selector UI.
      // Merged with existing discovered_actions on upsert.
      discovered_actions: discoveredActions,
    }
  })

  for (let i = 0; i < mapped.length; i += 200) {
    await db
      .from('meta_ads_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,campaign_id,date',
        ignoreDuplicates: false,
      })
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

  const mapped = valid.map(r => ({
    connection_id:     connectionId,
    client_id:         clientId,
    campaign_id:       String(r.campaign_id),
    campaign_name:     String(r.campaign_name || ''),
    adset_id:          r.adset_id   || null,
    adset_name:        r.adset_name || null,
    ad_id:             String(r.ad_id),
    ad_name:           String(r.ad_name || ''),
    thumbnail_url:     r.thumbnail_url     || null,
    image_url:         r.image_url         || null,
    video_id:          r.video_id          || null,
    video_thumb_url:   r.video_thumb_url   || null,
    creative_body:     r.creative_body     || null,
    creative_title:    r.creative_title    || null,
    creative_link_url: r.creative_link_url || null,
    ad_status:         r.ad_status         || null,
    date:              String(r.date).split('T')[0],
    spend:             Number(r.spend)       || 0,
    impressions:       Number(r.impressions) || 0,
    clicks:            Number(r.clicks)      || 0,
    reach:             Number(r.reach)       || 0,
    actions:           r.actions,
    action_values:     r.action_values,
    conversions:       Number(r.conversions)       || 0,
    conversion_value:  Number(r.conversion_value)  || 0,
  }))

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
    missed_calls:     r.missed_calls,
    forms_submitted:  r.forms_submitted,
    reviews_sent:     r.reviews_sent,
    reviews_received: r.reviews_received,
    spam_leads:       r.spam_leads,
    emails_sent:      r.emails_sent,
    sms_sent:         r.sms_sent,
    raw_data:         r.raw_data ?? {},
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

/** Returns [dateFrom, dateTo] as YYYY-MM-DD strings for a trailing window ending yesterday. */
function computeDateRange(days: number): [string, string] {
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  // Sync up to yesterday — today's data is incomplete mid-day
  const to = new Date()
  to.setDate(to.getDate() - 1)
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
    channel_group:        r.channel_group || 'Direct',
    sessions:             r.sessions,
    users:                r.users,
    new_users:            r.new_users,
    page_views:           r.page_views,
    conversions:          r.conversions,
    bounce_rate:          r.bounce_rate,
    avg_session_duration: r.avg_session_duration,
    synced_at:            new Date().toISOString(),
  }))

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
