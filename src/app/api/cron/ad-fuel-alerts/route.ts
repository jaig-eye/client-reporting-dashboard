// Hourly cron — checks ad fuel balances and sends Discord alerts when low.
// Fires at most twice per depletion cycle: once when first crossing below
// threshold, once when depleted. Includes runway estimate from campaign budgets.

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

  const floor14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)

  type SumRow      = { client_id: string; spend: number }
  type DayRow      = { client_id: string; date: string; spend: number }
  type BudgetRow   = { client_id: string; google_daily_budget: number; meta_daily_budget: number }
  type LedgerRow   = { client_id: string; amount_af: number; split_override: number | null; date_of_payment: string }
  type ClientRow   = { id: string; name: string; ad_fuel_cut: number | null; historic_bill_day: number | null; discord_channel_id: string | null; ad_fuel_alert_threshold: number | null; ad_fuel_alert_muted: boolean | null; last_fuel_alert_at: string | null; last_fuel_alert_balance: number | null }

  // Round 2: remaining queries using correct cutoffDate
  const [clientsRes, ledgerRes, gSpendRes, mSpendRes, gDailyRes, mDailyRes, budgetRes] = await Promise.all([
    db.from('clients').select('id, name, ad_fuel_cut, historic_bill_day, discord_channel_id, ad_fuel_alert_threshold, ad_fuel_alert_muted, last_fuel_alert_at, last_fuel_alert_balance').not('discord_channel_id', 'is', null),
    db.from('ad_fuel_ledger').select('client_id, amount_af, split_override, date_of_payment'),
    db.rpc('sum_google_spend_by_client', { from_date: cutoffDate }),
    db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate }),
    db.rpc('daily_google_spend_by_client', { floor_date: floor14 }),
    db.rpc('daily_meta_spend_by_client',   { floor_date: floor14 }),
    db.rpc('latest_campaign_budget_by_client'),
  ])

  const gMap: Record<string, number> = {}
  const mMap: Record<string, number> = {}
  for (const r of (gSpendRes.data ?? []) as SumRow[]) gMap[r.client_id] = Number(r.spend ?? 0)
  for (const r of (mSpendRes.data ?? []) as SumRow[]) mMap[r.client_id] = Number(r.spend ?? 0)

  // Trailing 14-day avg daily spend per client (raw platform spend)
  const gDailyTotals: Record<string, { sum: number; days: Set<string> }> = {}
  const mDailyTotals: Record<string, { sum: number; days: Set<string> }> = {}
  for (const r of (gDailyRes.data ?? []) as DayRow[]) {
    if (!gDailyTotals[r.client_id]) gDailyTotals[r.client_id] = { sum: 0, days: new Set() }
    gDailyTotals[r.client_id].sum += Number(r.spend ?? 0)
    gDailyTotals[r.client_id].days.add(r.date)
  }
  for (const r of (mDailyRes.data ?? []) as DayRow[]) {
    if (!mDailyTotals[r.client_id]) mDailyTotals[r.client_id] = { sum: 0, days: new Set() }
    mDailyTotals[r.client_id].sum += Number(r.spend ?? 0)
    mDailyTotals[r.client_id].days.add(r.date)
  }

  // Latest campaign daily budgets per client (set spend rate)
  const setBudgetMap: Record<string, number> = {}
  for (const r of (budgetRes.data ?? []) as BudgetRow[]) {
    setBudgetMap[r.client_id] = Number(r.google_daily_budget ?? 0) + Number(r.meta_daily_budget ?? 0)
  }

  // Apply historic_bill_day gap adjustment — same logic as dashboard and auto-pause
  const clients         = (clientsRes.data ?? []) as ClientRow[]
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
    if (client.ad_fuel_alert_muted) continue

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

    const roundedBalance = Math.round(afBalance)
    const lastBalance    = client.last_fuel_alert_balance

    // Tier-crossing dedup — at most 2 alerts per depletion cycle:
    //   1. First time below threshold  (lastBalance null OR was depleted and recovered)
    //   2. When depleted               (lastBalance > 0 → ≤ 0)
    // Suppress if same tier as before.
    if (lastBalance != null) {
      const prevDepleted = lastBalance <= 0
      const nowDepleted  = roundedBalance <= 0

      const crossedIntoDepleted = !prevDepleted && nowDepleted
      // Recovered from zero but still below threshold → re-fire low warning
      const recoveredStillLow   = prevDepleted && !nowDepleted

      if (!crossedIntoDepleted && !recoveredStillLow) continue
    }

    // ── Runway estimate ────────────────────────────────────────────────────
    let runwayLine = ''
    if (!atZero) {
      const gDaily   = gDailyTotals[client.id]
      const mDaily   = mDailyTotals[client.id]
      const allDays  = new Set(Array.from(gDaily?.days ?? []).concat(Array.from(mDaily?.days ?? [])))
      const numDays  = allDays.size || 14
      const avgRaw   = ((gDaily?.sum ?? 0) + (mDaily?.sum ?? 0)) / numDays
      const setRaw   = setBudgetMap[client.id] ?? 0
      const projRaw  = Math.max(avgRaw, setRaw)
      const projAf   = split > 0 ? projRaw / split : 0
      if (projAf > 0) {
        const daysLeft = Math.floor(afBalance / projAf)
        const perDay   = `$${Math.round(projAf).toLocaleString('en-US')}/day`
        runwayLine = ` Est. ~${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining at ${perDay}.`
      }
    }

    // ── Build message (plain text — no Discord markdown) ───────────────────
    const balanceStr  = `$${Math.abs(afBalance).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}${afBalance < 0 ? ' overdrawn' : ''}`
    const thresholdStr = client.ad_fuel_alert_threshold != null
      ? `$${client.ad_fuel_alert_threshold.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
      : null

    let message: string
    if (atZero) {
      message = `⚠️ Ad Fuel — ${client.name}: Balance is ${afBalance < 0 ? '-' : ''}${balanceStr}. Please top up to avoid campaign pauses.`
    } else {
      message = `🔔 Ad Fuel — ${client.name}: Balance is $${roundedBalance}${thresholdStr ? `, below the ${thresholdStr} threshold` : ''}.${runwayLine}`
    }

    try {
      await sendDiscordMessage(botToken, client.discord_channel_id, message)
      await Promise.all([
        db.from('clients').update({
          last_fuel_alert_at:      now.toISOString(),
          last_fuel_alert_balance: roundedBalance,
        }).eq('id', client.id),
        db.from('admin_alerts').insert({
          type:        'ad_fuel',
          severity:    atZero ? 'critical' : 'warning',
          client_id:   client.id,
          client_name: client.name,
          title:       atZero ? `Ad Fuel depleted — ${client.name}` : `Ad Fuel low — ${client.name}`,
          body:        message,
          meta:        { afBalance, atZero, threshold: client.ad_fuel_alert_threshold },
          link_url:    '/admin/ad-fuel',
        }),
      ])
      alerts.push(client.name)
    } catch (err) {
      console.error(`[ad-fuel-alerts] Discord send failed for ${client.name}:`, err)
    }
  }

  return NextResponse.json({ checked: clients.length, alerted: alerts })
}
