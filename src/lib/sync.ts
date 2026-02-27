import { createAdminClient } from './supabase/server'
import { fetchGoogleCampaignMetrics, refreshGoogleToken } from './google-ads'
import { fetchMetaCampaignMetrics } from './meta-ads'
import type { AdAccount } from './types'

export async function syncClient(clientId: string, days = 30): Promise<number> {
  const db = createAdminClient()

  const { data: accounts } = await db
    .from('ad_accounts')
    .select('*')
    .eq('client_id', clientId) as { data: AdAccount[] | null }

  if (!accounts?.length) return 0

  const toDate = new Date()
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const dateStart = fmt(fromDate)
  const dateEnd = fmt(toDate)

  let totalRecords = 0

  for (const account of accounts) {
    const logId = await startSyncLog(db, clientId, account.id, account.platform, dateStart, dateEnd)

    try {
      let metrics: ReturnType<typeof fetchGoogleCampaignMetrics> extends Promise<infer T> ? T : never

      if (account.platform === 'google') {
        let token = account.access_token || ''
        // Refresh token if expired or missing
        if (account.refresh_token && (!token || isTokenExpired(account.token_expires_at))) {
          token = await refreshGoogleToken(account.refresh_token)
          await db.from('ad_accounts').update({
            access_token: token,
            token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          }).eq('id', account.id)
        }
        metrics = await fetchGoogleCampaignMetrics(account.account_id, token, dateStart, dateEnd)
      } else {
        metrics = await fetchMetaCampaignMetrics(account.account_id, account.access_token || '', dateStart, dateEnd)
      }

      if (metrics.length > 0) {
        const rows = metrics.map(m => ({
          client_id: clientId,
          ad_account_id: account.id,
          platform: account.platform,
          ...m,
        }))

        // Upsert in batches of 100
        for (let i = 0; i < rows.length; i += 100) {
          await db.from('campaign_metrics').upsert(
            rows.slice(i, i + 100),
            { onConflict: 'ad_account_id,campaign_id,date' }
          )
        }
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

function isTokenExpired(expiresAt?: string): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() < Date.now() + 5 * 60 * 1000 // 5 min buffer
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
  await db.from('sync_logs').update({
    status,
    records_synced: records,
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  }).eq('id', logId)
}
