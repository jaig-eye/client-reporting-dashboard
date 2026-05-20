// Hourly cron — checks ad fuel balances and sends Discord alerts when low.
// Fires at $0 always + once per day per client when below their optional threshold.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sendDiscordMessage } from '@/lib/discord'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Round 1: agency settings (need cutoffDate before RPC params)
  const agencyRes = await db.from('agency_settings').select('ad_fuel_cut, ad_fuel_cutoff_date, discord_bot_token').single()

  const botToken   = agencyRes.data?.discord_bot_token
  if (!botToken) return NextResponse.json({ skipped: true, reason: 'No discord_bot_token configured' })

  const agencyCut  = agencyRes.data?.ad_fuel_cut ?? 0.20
  const cutoffDate = agencyRes.data?.ad_fuel_cutoff_date ?? '2025-01-01'
  const cutoffMs   = new Date(cutoffDate + 'T00:00:00Z').getTime()

  type SumRow    = { client_id: string; spend: number }
  type LedgerRow = { client_id: string; amount_af: number; split_override: number | null; date_of_payment: string }
  type ClientRow = { id: string; name: string; ad_fuel_cut: number | null; historic_bill_day: number | null; discord_channel_id: string | null; ad_fuel_alert_threshold: number | null; last_fuel_alert_at: string | null; last_fuel_alert_balance: number | null }

  // Round 2: remaining queries using correct cutoffDate
  const [clientsRes, ledgerRes, gSpendRes, mSpendRes] = await Promise.all([
    db.from('clients').select('id, name, ad_fuel_cut, historic_bill_day, discord_channel_id, ad_fuel_alert_threshold, last_fuel_alert_at, last_fuel_alert_balance').not('discord_channel_id', 'is', null),
    db.from('ad_fuel_ledger').select('client_id, amount_af, split_override, date_of_payment'),
    db.rpc('sum_google_spend_by_client', { from_date: cutoffDate }),
    db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate }),
  ])

  const gMap: Record<string, number> = {}
  const mMap: Record<string, number> = {}
  for (const r of (gSpendRes.data ?? []) as SumRow[]) gMap[r.client_id] = Number(r.spend ?? 0)
  for (const r of (mSpendRes.data ?? []) as SumRow[]) mMap[r.client_id] = Number(r.spend ?? 0)

  // Apply historic_bill_day gap adjustment — same logic as dashboard and auto-pause
  const clients        = (clientsRes.data ?? []) as ClientRow[]
  const historicClients = clients.filter(c => c.historic_bill_day != null)
  const gapAdjustGoogle: Record<string, number> = {}
  const gapAdjustMeta:   Record<string, number> = {}

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

  const now    = new Date()
  const alerts: string[] = []

  for (const client of clients) {
    if (!client.discord_channel_id) continue

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

    const afBalance = afPurchased - afSpend

    const atZero         = afBalance <= 0
    const belowThreshold = client.ad_fuel_alert_threshold != null && afBalance < client.ad_fuel_alert_threshold

    if (!atZero && !belowThreshold) continue

    // Only alert when the balance has actually changed — suppresses daily spam
    // when balance is stuck at the same negative value.
    const roundedBalance = Math.round(afBalance)
    if (client.last_fuel_alert_balance != null && client.last_fuel_alert_balance === roundedBalance) continue

    const balanceStr = `$${afBalance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    let message: string
    if (atZero) {
      message = `⚠️ **Ad Fuel — ${client.name}**: Balance is ${balanceStr}. Please top up to avoid campaign pauses.`
    } else {
      const threshold = `$${client.ad_fuel_alert_threshold!.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
      message = `🔔 **Ad Fuel — ${client.name}**: Balance is ${balanceStr}, below the ${threshold} alert threshold.`
    }

    try {
      await sendDiscordMessage(botToken, client.discord_channel_id, message)
      await db.from('clients').update({
        last_fuel_alert_at:      now.toISOString(),
        last_fuel_alert_balance: roundedBalance,
      }).eq('id', client.id)
      alerts.push(client.name)
    } catch (err) {
      console.error(`[ad-fuel-alerts] Discord send failed for ${client.name}:`, err)
    }
  }

  return NextResponse.json({ checked: clients.length, alerted: alerts })
}
