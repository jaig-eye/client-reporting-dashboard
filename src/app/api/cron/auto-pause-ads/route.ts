// Hourly cron — auto-pauses or auto-resumes campaigns based on Ad Fuel balance.
// Only acts on clients with auto_pause_ads = true.
// Sends Discord notification and logs every action to ad_pause_log.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare } from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import { sendDiscordMessage }        from '@/lib/discord'
import { pauseGoogleCampaigns, resumeGoogleCampaigns } from '@/lib/connectors/google-ads'
import { pauseMetaCampaigns,  resumeMetaCampaigns  }   from '@/lib/connectors/meta-ads'

export const maxDuration = 300

// Discord messages are capped at 2000 chars — truncate long campaign name lists.
function fmtNames(names: string[], max = 10): string {
  if (names.length <= max) return names.join(', ')
  return names.slice(0, max).join(', ') + ` …+${names.length - max} more`
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!timingSafeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Round 1: agency settings (need cutoffDate before RPC params)
  const agencyRes = await db.from('agency_settings').select('ad_fuel_cut, ad_fuel_cutoff_date, discord_bot_token').single()

  type AgencyRow  = { ad_fuel_cut: number | null; ad_fuel_cutoff_date: string | null; discord_bot_token: string | null }
  type ClientRow  = { id: string; name: string; ad_fuel_cut: number | null; historic_bill_day: number | null; discord_channel_id: string | null; auto_pause_ads: boolean; auto_resume_ads: boolean; campaigns_paused_at: string | null }
  type SumRow     = { client_id: string; spend: number }
  type LedgerRow  = { client_id: string; amount_af: number; split_override: number | null; date_of_payment: string }

  const agencyCut  = (agencyRes.data as AgencyRow | null)?.ad_fuel_cut ?? 0.20
  const cutoffDate = (agencyRes.data as AgencyRow | null)?.ad_fuel_cutoff_date ?? '2025-01-01'
  const botToken   = (agencyRes.data as AgencyRow | null)?.discord_bot_token ?? null
  const cutoffMs   = new Date(cutoffDate + 'T00:00:00Z').getTime()

  // Round 2: all other queries using the correct cutoffDate
  const [clientsRes, ledgerRes, gSpendRes, mSpendRes] = await Promise.all([
    db.from('clients')
      .select('id, name, ad_fuel_cut, historic_bill_day, discord_channel_id, auto_pause_ads, auto_resume_ads, campaigns_paused_at')
      .eq('auto_pause_ads', true),
    db.from('ad_fuel_ledger').select('client_id, amount_af, split_override, date_of_payment'),
    db.rpc('sum_google_spend_by_client', { from_date: cutoffDate }),
    db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate }),
  ])

  const clients = (clientsRes.data ?? []) as ClientRow[]
  if (clients.length === 0) return NextResponse.json({ checked: 0, paused: [], resumed: [] })

  const gMap: Record<string, number> = {}
  const mMap: Record<string, number> = {}
  for (const r of (gSpendRes.data ?? []) as SumRow[]) gMap[r.client_id] = Number(r.spend ?? 0)
  for (const r of (mSpendRes.data ?? []) as SumRow[]) mMap[r.client_id] = Number(r.spend ?? 0)

  const getEffectiveCutoff = (cd: string, hbd: number): string => {
    const c = new Date(cd + 'T00:00:00Z')
    const y = c.getUTCFullYear(), m = c.getUTCMonth(), d = c.getUTCDate()
    if (d <= hbd) return new Date(Date.UTC(y, m, hbd)).toISOString().slice(0, 10)
    return new Date(Date.UTC(y, m + 1, hbd)).toISOString().slice(0, 10)
  }
  const subtractOneDay = (date: string): string => {
    const d = new Date(date + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }

  // Apply historic_bill_day gap adjustment — same logic as dashboard route
  // Subtracts spend from cutoffDate → (effectiveCutoff - 1) for clients that started mid-cycle
  const historicClients = clients.filter(c => c.historic_bill_day != null)
  const gapAdjustGoogle: Record<string, number> = {}
  const gapAdjustMeta:   Record<string, number> = {}
  if (historicClients.length > 0) {
    const gapGroups: Record<string, string[]> = {}
    for (const c of historicClients) {
      const eff = getEffectiveCutoff(cutoffDate, c.historic_bill_day!)
      if (eff > cutoffDate) {
        const gapEnd = subtractOneDay(eff)
        if (!gapGroups[gapEnd]) gapGroups[gapEnd] = []
        gapGroups[gapEnd].push(c.id)
      }
    }
    await Promise.all(Object.entries(gapGroups).map(async ([gapEnd, ids]) => {
      const [gGap, mGap] = await Promise.all([
        db.rpc('sum_google_spend_by_client', { from_date: cutoffDate, to_date: gapEnd }),
        db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate, to_date: gapEnd }),
      ])
      for (const r of (gGap.data ?? []) as SumRow[]) if (ids.includes(r.client_id)) gapAdjustGoogle[r.client_id] = Number(r.spend ?? 0)
      for (const r of (mGap.data ?? []) as SumRow[]) if (ids.includes(r.client_id)) gapAdjustMeta[r.client_id]   = Number(r.spend ?? 0)
    }))
  }

  const ledgerByClient: Record<string, LedgerRow[]> = {}
  for (const r of (ledgerRes.data ?? []) as LedgerRow[]) {
    if (!ledgerByClient[r.client_id]) ledgerByClient[r.client_id] = []
    ledgerByClient[r.client_id].push(r)
  }

  // Load active google_ads + meta_ads connections for these clients (with connector auth/config)
  const clientIds = clients.map(c => c.id)
  const { data: connectionsData } = await db
    .from('client_connections')
    .select('client_id, external_id, connector:connectors!inner(type, auth, config)')
    .in('client_id', clientIds)
    .eq('status', 'active')
    .in('connector.type', ['google_ads', 'meta_ads'])

  type ConnRow = {
    client_id:   string
    external_id: string
    connector:   { type: string; auth: Record<string, unknown>; config: Record<string, unknown> }
  }
  const connections = (connectionsData ?? []) as unknown as ConnRow[]

  const googleByClient: Record<string, ConnRow> = {}
  const metaByClient:   Record<string, ConnRow> = {}
  for (const c of connections) {
    if (c.connector.type === 'google_ads') googleByClient[c.client_id] = c
    if (c.connector.type === 'meta_ads')   metaByClient[c.client_id]   = c
  }

  const paused:  string[] = []
  const resumed: string[] = []

  for (const client of clients) {
    const cut   = client.ad_fuel_cut ?? agencyCut
    const split = 1 - cut

    const rawSpend = (gMap[client.id] ?? 0) + (mMap[client.id] ?? 0)
                   - (gapAdjustGoogle[client.id] ?? 0) - (gapAdjustMeta[client.id] ?? 0)
    const afSpend  = split > 0 ? rawSpend / split : 0

    let afPurchased = 0
    for (const e of ledgerByClient[client.id] ?? []) {
      const eMs = new Date(e.date_of_payment + 'T00:00:00Z').getTime()
      if (eMs >= cutoffMs) afPurchased += Number(e.amount_af)
    }

    const balance          = afPurchased - afSpend
    const isPaused         = client.campaigns_paused_at !== null
    const googleConn       = googleByClient[client.id]
    const metaConn         = metaByClient[client.id]

    // ── AUTO-PAUSE ────────────────────────────────────────────────────────────
    if (balance < 0 && !isPaused) {
      let googleCount = 0, metaCount = 0
      let googleError: string | undefined, metaError: string | undefined
      let googleResourceNames: string[] = [], metaCampaignIds: string[] = []
      let googleCampaignNames: string[] = [], metaCampaignNames: string[] = []

      if (googleConn) {
        const result = await pauseGoogleCampaigns(googleConn.external_id, googleConn.connector.auth, googleConn.connector.config)
        googleCount         = result.paused
        googleError         = result.error
        googleResourceNames = result.resourceNames
        googleCampaignNames = result.campaignNames
      }
      if (metaConn) {
        const result = await pauseMetaCampaigns(metaConn.external_id, metaConn.connector.auth)
        metaCount        = result.paused
        metaError        = result.error
        metaCampaignIds  = result.campaignIds
        metaCampaignNames = result.campaignNames
      }

      const anySuccess = googleCount > 0 || metaCount > 0
      const errorMsg   = [googleError, metaError].filter(Boolean).join('; ') || null

      await Promise.all([
        db.from('clients').update({ campaigns_paused_at: new Date().toISOString() }).eq('id', client.id),
        db.from('ad_pause_log').insert({
          client_id:                 client.id,
          action:                    anySuccess ? 'paused' : 'pause_failed',
          trigger:                   'auto',
          balance:                   Number(balance.toFixed(2)),
          google_campaigns_affected: googleCount,
          meta_campaigns_affected:   metaCount,
          paused_campaign_ids:       { google: googleResourceNames, meta: metaCampaignIds },
          paused_campaign_names:     { google: googleCampaignNames, meta: metaCampaignNames },
          error:                     errorMsg,
        }),
      ])

      if (botToken && client.discord_channel_id) {
        const total  = googleCount + metaCount
        const balStr = `$${Math.abs(balance).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        const nameLines = [
          googleCampaignNames.length > 0 ? `Google: ${fmtNames(googleCampaignNames)}` : '',
          metaCampaignNames.length   > 0 ? `Meta: ${fmtNames(metaCampaignNames)}`     : '',
        ].filter(Boolean).join('\n')
        const msg = `🚨 **Ad Fuel Auto-Pause — ${client.name}**: Balance is -${balStr}. ${total} campaign(s) paused (${googleCount} Google, ${metaCount} Meta).${nameLines ? `\n${nameLines}` : ''}${errorMsg ? `\n⚠️ Errors: ${errorMsg}` : ''}`
        try { await sendDiscordMessage(botToken, client.discord_channel_id, msg) } catch {}
      }

      paused.push(client.name)
    }

    // ── AUTO-RESUME ────────────────────────────────────────────────────────────
    else if (balance >= 0 && isPaused && client.auto_resume_ads) {
      // Look up stored campaign IDs + names from the most recent pause log
      const { data: lastLog } = await db
        .from('ad_pause_log')
        .select('paused_campaign_ids, paused_campaign_names, google_campaigns_affected, meta_campaigns_affected')
        .eq('client_id', client.id)
        .eq('action', 'paused')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      type PausedIds   = { google?: string[]; meta?: string[] }
      type PausedNames = { google?: string[]; meta?: string[] }
      const storedIds   = (lastLog?.paused_campaign_ids   ?? {}) as PausedIds
      const storedNames = (lastLog?.paused_campaign_names ?? {}) as PausedNames
      const storedGoogleCount = (lastLog?.google_campaigns_affected ?? 0) as number
      const storedMetaCount   = (lastLog?.meta_campaigns_affected   ?? 0) as number
      const totalStored = storedGoogleCount + storedMetaCount

      // Guard: if 0 campaigns were actually paused, don't call resume APIs.
      // Just clear the paused state and send a manual-action Discord message.
      if (totalStored === 0) {
        const balStr = `$${balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        await Promise.all([
          db.from('clients').update({ campaigns_paused_at: null }).eq('id', client.id),
          db.from('ad_pause_log').insert({
            client_id:                 client.id,
            action:                    'resumed',
            trigger:                   'auto',
            balance:                   Number(balance.toFixed(2)),
            google_campaigns_affected: 0,
            meta_campaigns_affected:   0,
          }),
        ])
        if (botToken && client.discord_channel_id) {
          const msg = `✅ **Ad Fuel Balance Restored — ${client.name}**: Balance is ${balStr}. No campaigns were recorded from auto-pause — please re-enable campaigns manually if needed.`
          try { await sendDiscordMessage(botToken, client.discord_channel_id, msg) } catch {}
        }
        resumed.push(client.name)
        continue
      }

      let googleCount = 0, metaCount = 0
      let googleError: string | undefined, metaError: string | undefined

      if (googleConn) {
        const result = await resumeGoogleCampaigns(googleConn.external_id, googleConn.connector.auth, googleConn.connector.config, storedIds.google)
        googleCount = result.resumed
        googleError = result.error
      }
      if (metaConn) {
        const result = await resumeMetaCampaigns(metaConn.external_id, metaConn.connector.auth, storedIds.meta)
        metaCount = result.resumed
        metaError = result.error
      }

      const anySuccess = googleCount > 0 || metaCount > 0
      const errorMsg   = [googleError, metaError].filter(Boolean).join('; ') || null

      await Promise.all([
        db.from('clients').update({ campaigns_paused_at: null }).eq('id', client.id),
        db.from('ad_pause_log').insert({
          client_id:                 client.id,
          action:                    anySuccess ? 'resumed' : 'resume_failed',
          trigger:                   'auto',
          balance:                   Number(balance.toFixed(2)),
          google_campaigns_affected: googleCount,
          meta_campaigns_affected:   metaCount,
          error:                     errorMsg,
        }),
      ])

      if (botToken && client.discord_channel_id) {
        const total     = googleCount + metaCount
        const balStr    = `$${balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        const gNames    = storedNames.google ?? []
        const mNames    = storedNames.meta   ?? []
        const nameLines = [
          gNames.length > 0 ? `Google: ${fmtNames(gNames)}` : '',
          mNames.length > 0 ? `Meta: ${fmtNames(mNames)}`   : '',
        ].filter(Boolean).join('\n')
        const msg = `✅ **Ad Fuel Auto-Resume — ${client.name}**: Balance restored to ${balStr}. ${total} campaign(s) resumed (${googleCount} Google, ${metaCount} Meta).${nameLines ? `\n${nameLines}` : ''}${errorMsg ? `\n⚠️ Errors: ${errorMsg}` : ''}`
        try { await sendDiscordMessage(botToken, client.discord_channel_id, msg) } catch {}
      }

      resumed.push(client.name)
    }
  }

  return NextResponse.json({ checked: clients.length, paused, resumed })
}
