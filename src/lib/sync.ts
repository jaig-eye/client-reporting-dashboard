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
import type { ClientConnection, Connector, SyncJobType } from './types'
import type { GoogleAdsRawRow, MetaAdsRawRow } from './connectors/types'
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
  dateTo?: string
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
    const adapter = getConnectorAdapter(connection.connector.type)
    if (!adapter) {
      // Connector type exists in DB but has no implementation yet (e.g. Search Console)
      continue
    }

    const jobId = await startSyncJob(db, connection.id, clientId, jobType, resolvedFrom, resolvedTo)

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
        // Ad-level sync (best-effort — records error in job but doesn't fail it)
        try {
          const adRows = await fetchGoogleAdMetrics(
            connection.external_id,
            auth,
            connection.connector.config,
            resolvedFrom,
            resolvedTo
          )
          console.log(`[sync] Google Ads ad-level: ${adRows.length} rows for connection ${connection.id}`)
          if (adRows.length > 0) {
            await upsertGoogleAdsAdMetrics(db, connection.id, clientId, adRows)
          } else {
            // 0 rows is not an error — common for Performance Max accounts
            // (PMax uses asset_group, not ad_group_ad)
            adLevelError = 'Ad-level: 0 rows returned — account may use Performance Max campaigns (PMax ads are not supported at ad-group level)'
          }
        } catch (adErr) {
          adLevelError = `Ad-level sync failed: ${String(adErr)}`
          console.error(`[sync] Google Ads ad-level sync failed for connection ${connection.id}:`, adErr)
        }
        // pMax asset group assets (best-effort — not date-ranged, fetches current active set)
        try {
          const assetRows = await fetchGooglePMaxAssets(
            connection.external_id,
            auth,
            connection.connector.config
          )
          console.log(`[sync] Google Ads pMax assets: ${assetRows.length} rows for connection ${connection.id}`)
          if (assetRows.length > 0) {
            await upsertGooglePMaxAssets(db, connection.id, clientId, assetRows)
          }
        } catch (assetErr) {
          // non-fatal — accounts with no pMax campaigns will error here
          console.error(`[sync] Google Ads pMax asset sync failed for connection ${connection.id}:`, assetErr)
        }
        // Keyword-level metrics for Search campaigns (best-effort)
        try {
          const kwRows = await fetchGoogleSearchKeywords(
            connection.external_id,
            auth,
            connection.connector.config,
            resolvedFrom,
            resolvedTo
          )
          console.log(`[sync] Google Ads keywords: ${kwRows.length} rows for connection ${connection.id}`)
          if (kwRows.length > 0) {
            await upsertGoogleAdsKeywords(db, connection.id, clientId, kwRows)
          }
        } catch (kwErr) {
          console.error(`[sync] Google Ads keyword sync failed for connection ${connection.id}:`, kwErr)
        }
        // Negative keywords (best-effort, non-dated snapshot)
        try {
          const negRows = await fetchGoogleNegativeKeywords(
            connection.external_id,
            auth,
            connection.connector.config
          )
          console.log(`[sync] Google Ads negative keywords: ${negRows.length} rows for connection ${connection.id}`)
          if (negRows.length > 0) {
            await upsertGoogleAdsNegativeKeywords(db, connection.id, clientId, negRows)
          }
        } catch (negErr) {
          console.error(`[sync] Google Ads negative keyword sync failed for connection ${connection.id}:`, negErr)
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
      }

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
    const convValue     = Number(r.conversions_value) || 0
    const vtc           = Number(r.view_through_conversions) || 0

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
      view_through_conversions: vtc,
      // Derived metrics computed from source values
      roas: spend > 0 ? convValue / spend : 0,
      ctr:  impressions > 0 ? clicks / impressions : 0,
      cpc:  clicks > 0 ? spend / clicks : 0,
      cpm:  impressions > 0 ? (spend / impressions) * 1000 : 0,
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
      conversions:       Number(r.conversions)      || 0,
      conversions_value: Number(r.conversions_value)|| 0,
    }
  })

  for (let i = 0; i < mapped.length; i += 200) {
    const { error } = await db
      .from('google_ads_ad_metrics')
      .upsert(mapped.slice(i, i + 200), {
        onConflict: 'connection_id,ad_id,date',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`google_ads_ad_metrics upsert failed: ${error.message}`)
  }

  return mapped.length
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

  for (let i = 0; i < mapped.length; i += 500) {
    const { error } = await db
      .from('google_ads_keywords')
      .upsert(mapped.slice(i, i + 500), {
        onConflict: 'connection_id,keyword_id,date',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`google_ads_keywords upsert failed: ${error.message}`)
  }

  return mapped.length
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

  for (let i = 0; i < mapped.length; i += 500) {
    const { error } = await db
      .from('google_ads_negative_keywords')
      .upsert(mapped.slice(i, i + 500), {
        onConflict: 'connection_id,keyword_id,level',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`google_ads_negative_keywords upsert failed: ${error.message}`)
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

// ─────────────────────────────────────────────────────────────────────────────
// Sync job helpers
// ─────────────────────────────────────────────────────────────────────────────

async function startSyncJob(
  db: ReturnType<typeof createAdminClient>,
  connectionId: string,
  clientId: string,
  jobType: SyncJobType,
  dateFrom: string,
  dateTo: string
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
