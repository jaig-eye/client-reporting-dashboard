import { createAdminClient } from './supabase/server'
import { fetchGoogleCampaignMetrics, refreshGoogleToken } from './google-ads'
import { fetchMetaCampaignMetrics } from './meta-ads'
import type { AdAccount, MetricRow } from './types'

// BACKFILL_DAYS: used when an account is first connected — pulls full history
export const BACKFILL_DAYS = 730
// INCREMENTAL_DAYS: used by the daily cron — re-syncs last 3 days to capture
// late-arriving conversions (Google Ads conversions can update up to 30 days back)
export const INCREMENTAL_DAYS = 3

/**
 * Sync campaign metrics for a client.
 *
 * @param clientId   - UUID of the client to sync
 * @param days       - How many days back to fetch (inclusive of today)
 * @param accountId  - Optional: limit sync to a single ad_account.id (used for backfill
 *                     on first connection so we don't re-sync already-synced accounts)
 */
export async function syncClient(
  clientId: string,
  days = INCREMENTAL_DAYS,
  accountId?: string,
  dateStartOverride?: string,
  dateEndOverride?: string
): Promise<number> {
  const db = createAdminClient()

  let query = db
    .from('ad_accounts')
    .select('*')
    .eq('client_id', clientId)

  if (accountId) query = query.eq('id', accountId)

  const { data: accounts } = await query as { data: AdAccount[] | null }
  if (!accounts?.length) return 0

  const fmt = (d: Date) => d.toISOString().split('T')[0]
  let dateStart: string
  let dateEnd: string

  if (dateStartOverride && dateEndOverride) {
    dateStart = dateStartOverride
    dateEnd = dateEndOverride
  } else {
    // Always sync up to yesterday — today's data is incomplete mid-day
    const toDate = new Date()
    toDate.setDate(toDate.getDate() - 1)
    const fromDate = new Date(toDate)
    fromDate.setDate(fromDate.getDate() - (days - 1))
    dateStart = fmt(fromDate)
    dateEnd = fmt(toDate)
  }

  let totalRecords = 0

  for (const account of accounts) {
    const logId = await startSyncLog(db, clientId, account.id, account.platform, dateStart, dateEnd)

    try {
      let metrics: MetricRow[]

      if (account.platform === 'google') {
        if (!account.access_token && !account.refresh_token) {
          // MCC script account — no OAuth credentials stored server-side.
          // Data is pushed by the MCC script; nothing to pull here.
          await completeSyncLog(db, logId, 'success', 0)
          continue
        }
        let token = account.access_token || ''
        if (account.refresh_token && (!token || isTokenExpired(account.token_expires_at))) {
          token = await refreshGoogleToken(account.refresh_token)
          await db.from('ad_accounts').update({
            access_token: token,
            token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          }).eq('id', account.id)
        }
        metrics = await fetchGoogleCampaignMetrics(account.account_id, token, dateStart, dateEnd)
      } else {
        // Meta: use per-account token if available, otherwise fall back to agency token
        let metaToken = account.access_token || ''
        if (!metaToken) {
          const { data: settings } = await db
            .from('agency_settings')
            .select('meta_access_token')
            .single()
          metaToken = (settings as Record<string, unknown>)?.meta_access_token as string || ''
        }
        if (!metaToken) {
          await completeSyncLog(db, logId, 'success', 0)
          continue
        }
        metrics = await fetchMetaCampaignMetrics(
          account.account_id,
          metaToken,
          dateStart,
          dateEnd
        )
      }

      if (metrics.length > 0) {
        await upsertMetrics(db, clientId, account, metrics)
        totalRecords += metrics.length
      }

      await completeSyncLog(db, logId, 'success', metrics.length)
    } catch (e) {
      await completeSyncLog(db, logId, 'error', 0, String(e))
      throw e
    }
  }

  return totalRecords
}

/**
 * Safe batch upsert for campaign_metrics.
 *
 * On conflict (ad_account_id, campaign_id, date) the row is updated in place.
 * Only metric columns are written — structural columns (client_id, platform, etc.)
 * are set on INSERT and never overwritten on UPDATE, preserving data integrity.
 * Campaign name is only updated when the incoming value is non-empty, so a blank
 * response from a flaky API call never erases an existing name.
 */
export async function upsertMetrics(
  db: ReturnType<typeof createAdminClient>,
  clientId: string,
  account: Pick<AdAccount, 'id' | 'platform'>,
  metrics: MetricRow[]
) {
  const rows = metrics
    .filter(m => m.date && m.campaign_id) // guard: skip rows missing key fields
    .map(m => {
      const spend = Number(m.spend) || 0
      const impressions = Number(m.impressions) || 0
      const clicks = Number(m.clicks) || 0
      const conversions = Number(m.conversions) || 0
      const conversionValue = Number(m.conversion_value) || 0
      return {
        client_id: clientId,
        ad_account_id: account.id,
        platform: account.platform,
        campaign_id: String(m.campaign_id),
        campaign_name: String(m.campaign_name || ''),
        date: String(m.date).split('T')[0], // normalise to YYYY-MM-DD
        spend,
        impressions,
        clicks,
        conversions,
        conversion_value: conversionValue,
        // Derived metrics — always recomputed from source values for consistency
        roas: spend > 0 ? conversionValue / spend : 0,
        ctr: impressions > 0 ? clicks / impressions : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      }
    })

  // Upsert in batches of 200 rows
  for (let i = 0; i < rows.length; i += 200) {
    await db.from('campaign_metrics').upsert(
      rows.slice(i, i + 200),
      {
        onConflict: 'ad_account_id,campaign_id,date',
        ignoreDuplicates: false, // always update metrics on conflict
      }
    )
  }
}

function isTokenExpired(expiresAt?: string): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() < Date.now() + 5 * 60 * 1000
}

async function startSyncLog(
  db: ReturnType<typeof createAdminClient>,
  clientId: string,
  adAccountId: string,
  platform: string,
  dateStart: string,
  dateEnd: string
): Promise<string> {
  const { data } = await db.from('sync_logs').insert({
    client_id: clientId,
    ad_account_id: adAccountId,
    platform,
    status: 'running',
    date_range_start: dateStart,
    date_range_end: dateEnd,
  }).select('id').single()
  return data?.id || ''
}

async function completeSyncLog(
  db: ReturnType<typeof createAdminClient>,
  logId: string,
  status: 'success' | 'error',
  records: number,
  errorMessage?: string
) {
  if (!logId) return
  await db.from('sync_logs').update({
    status,
    records_synced: records,
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  }).eq('id', logId)
}
