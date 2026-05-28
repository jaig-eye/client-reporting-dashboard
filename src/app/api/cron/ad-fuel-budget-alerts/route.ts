// Daily cron — intelligent ad fuel budget & runway alerts.
//
// Complements the hourly ad-fuel-alerts cron (which handles balance ≤ $0).
// This cron projects forward using burn rate + billing cycle to answer:
//   "At current spend, will the client run out of budget/balance BEFORE rebill?"
//   "Is the client pacing significantly over or under their monthly budget?"
//
// Two analysis paths per client:
//   Path A (monthly_budget set) — pace vs budget is the primary signal.
//     Alerts: budget-overpace, budget-runway, budget-underpace, low-fuel-vs-budget.
//   Path B (no monthly_budget, but has bill_day) — balance runway vs rebill date.
//     Alert: balance-runway (balance runs out ≥2 days before rebill).
//   Path C (no bill_day) — one-time / open-ended client.
//     Alert: one-time-depletion (balance runs out in <14 days).
//
// Discord messages are written by Claude AI (fast haiku model) using the agency's
// configured AI key from agency_settings. Falls back to deterministic templates
// if no AI key is set or the API call fails.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 120

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers — copied from /api/admin/ad-fuel/route.ts
// ─────────────────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function getCycleStart(today: Date, billDay: number): Date {
  const d = today.getDate()
  if (d >= billDay) return new Date(today.getFullYear(), today.getMonth(), billDay)
  return new Date(today.getFullYear(), today.getMonth() - 1, billDay)
}

function getCycleEnd(cycleStart: Date): Date {
  return new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, cycleStart.getDate())
}

function getEffectiveCutoff(cutoffDate: string, historicBillDay: number): string {
  const c    = new Date(cutoffDate + 'T00:00:00Z')
  const year = c.getUTCFullYear(), month = c.getUTCMonth(), day = c.getUTCDate()
  if (day <= historicBillDay) return new Date(Date.UTC(year, month, historicBillDay)).toISOString().slice(0, 10)
  return new Date(Date.UTC(year, month + 1, historicBillDay)).toISOString().slice(0, 10)
}

function subtractOneDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function fmt$(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

// ─────────────────────────────────────────────────────────────────────────────
// AI message generation
// ─────────────────────────────────────────────────────────────────────────────

interface AlertData {
  afBalance:          number
  avgDailyAf:         number
  projectedDailyAf:   number
  setDailyAf:         number
  daysToRebill:       number
  rebillDate:         string
  monthlyBudget:      number | null
  afSinceBill:        number
  budgetImpliedDaily: number
  budgetRemaining:    number
  recommendedDaily:   number
  paceRatio:          number
  budgetRunoutDays:   number
  budgetDaysEarly:    number
  runoutDays:         number
  daysEarly:          number
  triggers:           string[]
}

async function generateAlertMessage(
  provider: string,
  apiKey:   string,
  client:   string,
  d:        AlertData,
): Promise<string> {
  const sys = `You are an ad operations assistant for a marketing agency. Write a concise Discord alert (3–5 lines, plain text, **bold** for key numbers only). Lead with the most urgent issue. Be specific and always end with one actionable recommendation. No greetings, no sign-off.`

  let usr = `Client: ${client}
Ad Fuel balance: ${fmt$(d.afBalance)} | Trailing avg: ${fmt$(d.avgDailyAf)}/day | Campaign budgets imply: ${fmt$(d.setDailyAf)}/day | Using for projection: ${fmt$(d.projectedDailyAf)}/day | Rebill: ${d.rebillDate} (${d.daysToRebill} days away)`

  if (d.monthlyBudget) {
    usr += `
Monthly budget: ${fmt$(d.monthlyBudget)} | Budget target: ${fmt$(d.budgetImpliedDaily)}/day
Budget spent this cycle: ${fmt$(d.afSinceBill)} | Budget remaining: ${fmt$(d.budgetRemaining)}
Recommended daily budget (to hit target by rebill): ${fmt$(d.recommendedDaily)}/day
Pace: ${Math.round(d.paceRatio * 100)}% of budget target
Budget exhausted in: ~${Math.round(d.budgetRunoutDays)} days (${d.budgetDaysEarly > 0 ? `${Math.round(d.budgetDaysEarly)} days BEFORE rebill` : 'on time'})`
  } else {
    usr += `
Balance runway: ~${Math.round(d.runoutDays)} days (${d.daysEarly > 0 ? `${Math.round(d.daysEarly)} days BEFORE rebill` : `${Math.round(Math.abs(d.daysEarly))} days of buffer after rebill`})
Recommended daily rate to last until rebill: ${fmt$(d.recommendedDaily)}/day`
  }
  usr += `\nActive triggers: ${d.triggers.join(', ')}`

  const model = provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini'

  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body:    JSON.stringify({ model, max_tokens: 300, system: sys, messages: [{ role: 'user', content: usr }] }),
      })
      if (!res.ok) throw new Error(`AI ${res.status}`)
      const data = await res.json() as { content?: { type: string; text: string }[] }
      return data.content?.find(b => b.type === 'text')?.text ?? ''
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify({ model, max_tokens: 300, messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] }),
      })
      if (!res.ok) throw new Error(`AI ${res.status}`)
      const data = await res.json() as { choices?: { message: { content: string } }[] }
      return data.choices?.[0]?.message?.content ?? ''
    }
  } catch {
    return ''
  }
}

function buildFallbackTitle(clientName: string, triggers: string[]): string {
  if (triggers.includes('budget-runway') || triggers.includes('balance-runway')) return `Budget runway alert — ${clientName}`
  if (triggers.includes('budget-overpace')) return `Overpacing budget — ${clientName}`
  if (triggers.includes('low-fuel-vs-budget'))  return `Low Ad Fuel vs budget — ${clientName}`
  if (triggers.includes('one-time-depletion'))  return `Balance depleting soon — ${clientName}`
  return `Budget underpace — ${clientName}`
}

function buildFallbackMessage(clientName: string, d: AlertData): string {
  const { triggers, monthlyBudget, afBalance, projectedDailyAf, budgetRunoutDays, budgetDaysEarly,
          paceRatio, budgetImpliedDaily, recommendedDaily, runoutDays, daysEarly, rebillDate } = d

  if (triggers.includes('budget-runway') || triggers.includes('balance-runway')) {
    const days  = monthlyBudget ? Math.round(budgetRunoutDays) : Math.round(runoutDays)
    const early = monthlyBudget ? Math.round(budgetDaysEarly)  : Math.round(daysEarly)
    return `🔴 **Ad Fuel — ${clientName}**: At **${fmt$(projectedDailyAf)}/day**, ${monthlyBudget ? 'budget' : 'balance'} runs out in ~**${days} days** — **${early} days before** rebill (${rebillDate}).\nRecommended daily budget: **${fmt$(recommendedDaily)}/day** to make it to rebill.`
  }
  if (triggers.includes('budget-overpace')) {
    return `⚠️ **Ad Fuel — ${clientName}**: Spending **${fmt$(projectedDailyAf)}/day** — **${Math.round(paceRatio * 100)}%** of the **${fmt$(budgetImpliedDaily)}/day** budget target. At this pace, budget exhausted **${Math.round(budgetDaysEarly)} days early** (rebill: ${rebillDate}).\nRecommended: reduce to **${fmt$(recommendedDaily)}/day** to land on budget.`
  }
  if (triggers.includes('low-fuel-vs-budget')) {
    return `🔋 **Ad Fuel — ${clientName}**: Balance is **${fmt$(afBalance)}** but **${fmt$(d.budgetRemaining)}** of budget remains this cycle. Top up to keep campaigns running — recommended spend is **${fmt$(recommendedDaily)}/day** through rebill (${rebillDate}).`
  }
  if (triggers.includes('one-time-depletion')) {
    return `⚠️ **Ad Fuel — ${clientName}**: Balance of **${fmt$(afBalance)}** will be depleted in ~**${Math.round(runoutDays)} days** at the current **${fmt$(projectedDailyAf)}/day** rate. Top up or reduce daily spend to extend runway.`
  }
  // underpace
  return `📉 **Ad Fuel — ${clientName}**: Spending **${fmt$(projectedDailyAf)}/day** — only **${Math.round(paceRatio * 100)}%** of the **${fmt$(budgetImpliedDaily)}/day** needed to hit the ${fmt$(monthlyBudget!)}/mo budget. Recommended: **${fmt$(recommendedDaily)}/day** for remaining ${Math.round(d.daysToRebill)} days.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const agencyRes = await db
    .from('agency_settings')
    .select('ad_fuel_cut, ad_fuel_cutoff_date, ai_provider, ai_model, ai_api_key')
    .single()

  type AgencyRow = {
    ad_fuel_cut: number | null; ad_fuel_cutoff_date: string | null
    ai_provider: string | null; ai_model: string | null; ai_api_key: string | null
  }
  const agency = agencyRes.data as AgencyRow | null

  const agencyCut  = agency?.ad_fuel_cut          ?? 0.20
  const cutoffDate = agency?.ad_fuel_cutoff_date   ?? '2025-01-01'
  const cutoffMs   = new Date(cutoffDate + 'T00:00:00Z').getTime()
  const aiProvider = agency?.ai_provider           || 'anthropic'
  const aiApiKey   = agency?.ai_api_key            || ''

  const today      = startOfDay(new Date())
  const yesterday  = new Date(today.getTime() - 86_400_000)
  const cycleFloor = new Date(today.getTime() - 65 * 86_400_000).toISOString().slice(0, 10)

  type SumRow    = { client_id: string; spend: number }
  type DayRow    = { client_id: string; date: string; spend: number }
  type LedgerRow = { client_id: string; amount_af: number; split_override: number | null; date_of_payment: string }
  type BudgetRow = { client_id: string; campaign_id: string; daily_budget: number; date: string; spend: number }
  type ClientRow = {
    id: string; name: string; bill_day: number | null; historic_bill_day: number | null
    monthly_budget: number | null; ad_fuel_cut: number | null
    discord_channel_id: string | null; ad_fuel_alert_muted: boolean | null
    last_runway_alert_at: string | null; last_runway_alert_days: number | null
  }

  const [clientsRes, ledgerRes, gSumRes, mSumRes, gCycleRes, mCycleRes] = await Promise.all([
    db.from('clients')
      .select('id, name, bill_day, historic_bill_day, monthly_budget, ad_fuel_cut, discord_channel_id, ad_fuel_alert_muted, last_runway_alert_at, last_runway_alert_days')
      .not('discord_channel_id', 'is', null),
    db.from('ad_fuel_ledger').select('client_id, amount_af, split_override, date_of_payment'),
    db.rpc('sum_google_spend_by_client', { from_date: cutoffDate }),
    db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate }),
    db.rpc('daily_google_spend_by_client', { floor_date: cycleFloor }),
    db.rpc('daily_meta_spend_by_client',   { floor_date: cycleFloor }),
  ])

  const gSumMap: Record<string, number> = {}
  const mSumMap: Record<string, number> = {}
  for (const r of (gSumRes.data ?? []) as SumRow[]) gSumMap[r.client_id] = Number(r.spend ?? 0)
  for (const r of (mSumRes.data ?? []) as SumRow[]) mSumMap[r.client_id] = Number(r.spend ?? 0)

  const clients = (clientsRes.data ?? []) as ClientRow[]

  // ── Hybrid burn rate: fetch most-recent daily_budget per active campaign ──
  const threeDaysAgo = new Date(today.getTime() - 3 * 86_400_000).toISOString().slice(0, 10)
  const [gBudgetRes, mBudgetRes] = await Promise.all([
    db.from('google_ads_metrics')
      .select('client_id, campaign_id, daily_budget, date, spend')
      .gte('date', threeDaysAgo)
      .gt('spend', 0)
      .gt('daily_budget', 0)
      .order('date', { ascending: false }),
    db.from('meta_ads_metrics')
      .select('client_id, campaign_id, daily_budget, date, spend')
      .gte('date', threeDaysAgo)
      .gt('spend', 0)
      .gt('daily_budget', 0)
      .order('date', { ascending: false }),
  ])

  // Aggregate: latest row per (client_id, campaign_id) → sum raw daily_budget per client
  const setDailyRawByClient: Record<string, number> = {}
  const seenCampaigns = new Set<string>()
  for (const r of [...((gBudgetRes.data ?? []) as BudgetRow[]), ...((mBudgetRes.data ?? []) as BudgetRow[])]) {
    const key = `${r.client_id}:${r.campaign_id}`
    if (seenCampaigns.has(key)) continue   // already have a newer row (sorted DESC)
    seenCampaigns.add(key)
    setDailyRawByClient[r.client_id] = (setDailyRawByClient[r.client_id] ?? 0) + Number(r.daily_budget)
  }

  // Historic bill_day gap adjustments (same pattern as ad-fuel-alerts cron)
  const historicClients = clients.filter(c => c.historic_bill_day != null)
  const gapGoogle: Record<string, number> = {}
  const gapMeta:   Record<string, number> = {}

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
      const [gG, mG] = await Promise.all([
        db.rpc('sum_google_spend_by_client', { from_date: cutoffDate, to_date: gapEnd }),
        db.rpc('sum_meta_spend_by_client',   { from_date: cutoffDate, to_date: gapEnd }),
      ])
      for (const r of (gG.data ?? []) as SumRow[]) if (ids.includes(r.client_id)) gapGoogle[r.client_id] = Number(r.spend ?? 0)
      for (const r of (mG.data ?? []) as SumRow[]) if (ids.includes(r.client_id)) gapMeta[r.client_id]   = Number(r.spend ?? 0)
    }))
  }

  const ledgerByClient: Record<string, LedgerRow[]> = {}
  for (const r of (ledgerRes.data ?? []) as LedgerRow[]) {
    if (!ledgerByClient[r.client_id]) ledgerByClient[r.client_id] = []
    ledgerByClient[r.client_id].push(r)
  }

  const gCycleRows = (gCycleRes.data ?? []) as DayRow[]
  const mCycleRows = (mCycleRes.data ?? []) as DayRow[]
  const now        = new Date()
  const alerted: { name: string; triggers: string[] }[] = []

  for (const client of clients) {
    if (!client.discord_channel_id) continue
    if (client.ad_fuel_alert_muted) continue

    // ── Balance ─────────────────────────────────────────────────────────────
    const cut   = client.ad_fuel_cut ?? agencyCut
    const split = 1 - cut

    const rawSpend = (gSumMap[client.id] ?? 0) + (mSumMap[client.id] ?? 0)
                   - (gapGoogle[client.id] ?? 0) - (gapMeta[client.id] ?? 0)
    const afSpend  = split > 0 ? rawSpend / split : 0

    let afPurchased = 0
    for (const e of ledgerByClient[client.id] ?? []) {
      if (new Date(e.date_of_payment + 'T00:00:00Z').getTime() >= cutoffMs)
        afPurchased += Number(e.amount_af)
    }

    const afBalance = afPurchased - afSpend
    if (afBalance <= 0) continue  // existing ad-fuel-alerts cron handles $0

    // ── Burn rate ────────────────────────────────────────────────────────────
    let avgDailyAf  = 0
    let afSinceBill = 0
    let daysSoFar   = 0
    let daysToRebill = 0
    let daysInCycle  = 0
    let cycleEnd: Date | null = null

    const billDay = client.bill_day
    if (billDay) {
      const cycleStart = getCycleStart(today, billDay)
      cycleEnd         = getCycleEnd(cycleStart)
      const cutoff     = yesterday < cycleEnd ? yesterday : new Date(cycleEnd.getTime() - 86_400_000)

      if (cutoff >= cycleStart) {
        const csMs = cycleStart.getTime()
        const ctMs = cutoff.getTime()
        let cycleRaw = 0
        for (const r of gCycleRows) {
          if (r.client_id !== client.id) continue
          const t = new Date(r.date + 'T00:00:00Z').getTime()
          if (t >= csMs && t <= ctMs) cycleRaw += Number(r.spend ?? 0)
        }
        for (const r of mCycleRows) {
          if (r.client_id !== client.id) continue
          const t = new Date(r.date + 'T00:00:00Z').getTime()
          if (t >= csMs && t <= ctMs) cycleRaw += Number(r.spend ?? 0)
        }
        afSinceBill  = split > 0 ? cycleRaw / split : 0
        daysSoFar    = Math.max(1, Math.floor((cutoff.getTime() - cycleStart.getTime()) / 86_400_000) + 1)
        avgDailyAf   = afSinceBill / daysSoFar
        daysInCycle  = Math.floor((cycleEnd.getTime() - cycleStart.getTime()) / 86_400_000)
        daysToRebill = Math.max(1, Math.ceil((cycleEnd.getTime() - today.getTime()) / 86_400_000))
      }
    } else {
      // No bill_day — 30-day rolling window for burn rate
      const thirtyAgo = new Date(today.getTime() - 30 * 86_400_000)
      const csMs = thirtyAgo.getTime()
      const ctMs = yesterday.getTime()
      let raw30 = 0
      for (const r of gCycleRows) {
        if (r.client_id !== client.id) continue
        const t = new Date(r.date + 'T00:00:00Z').getTime()
        if (t >= csMs && t <= ctMs) raw30 += Number(r.spend ?? 0)
      }
      for (const r of mCycleRows) {
        if (r.client_id !== client.id) continue
        const t = new Date(r.date + 'T00:00:00Z').getTime()
        if (t >= csMs && t <= ctMs) raw30 += Number(r.spend ?? 0)
      }
      afSinceBill = split > 0 ? raw30 / split : 0
      daysSoFar   = 30
      avgDailyAf  = afSinceBill / 30
    }

    if (avgDailyAf <= 0) continue

    // ── Hybrid burn rate — max(trailing avg, set campaign budgets) ───────────
    const setDailyRaw      = setDailyRawByClient[client.id] ?? 0
    const setDailyAf       = split > 0 ? setDailyRaw / split : 0
    const projectedDailyAf = Math.max(avgDailyAf, setDailyAf)

    // ── Alert logic ──────────────────────────────────────────────────────────
    const triggers: string[] = []
    const monthlyBudget = client.monthly_budget

    let budgetImpliedDaily = 0
    let budgetRemaining    = 0
    let recommendedDaily   = 0
    let paceRatio          = 0
    let budgetRunoutDays   = 0
    let budgetDaysEarly    = 0
    let runoutDays         = 0
    let daysEarly          = 0

    if (monthlyBudget && daysInCycle > 0 && daysToRebill > 0) {
      // Path A: budget-first analysis
      budgetImpliedDaily = monthlyBudget / daysInCycle
      budgetRemaining    = Math.max(0, monthlyBudget - afSinceBill)
      recommendedDaily   = budgetRemaining / daysToRebill
      paceRatio          = budgetImpliedDaily > 0 ? projectedDailyAf / budgetImpliedDaily : 0
      budgetRunoutDays   = projectedDailyAf > 0 ? budgetRemaining / projectedDailyAf : Infinity
      budgetDaysEarly    = daysToRebill - budgetRunoutDays

      if (paceRatio > 1.20)                     triggers.push('budget-overpace')
      if (budgetDaysEarly >= 2)                 triggers.push('budget-runway')
      if (paceRatio < 0.60 && daysSoFar >= 5)   triggers.push('budget-underpace')
      // Low physical fuel relative to budget remaining — needs a top-up
      if (budgetRemaining > 500 && afBalance < budgetRemaining * 0.15)
                                                triggers.push('low-fuel-vs-budget')

    } else if (billDay && daysToRebill > 0) {
      // Path B: no budget — balance runway vs rebill
      runoutDays       = afBalance / projectedDailyAf
      daysEarly        = daysToRebill - runoutDays
      recommendedDaily = afBalance / daysToRebill

      if (daysEarly >= 2) triggers.push('balance-runway')

    } else {
      // Path C: one-time / open-ended
      runoutDays       = afBalance / projectedDailyAf
      recommendedDaily = projectedDailyAf

      if (runoutDays < 14) triggers.push('one-time-depletion')
    }

    if (triggers.length === 0) continue

    // ── Dedup ────────────────────────────────────────────────────────────────
    const currentDaysEarly = monthlyBudget ? Math.round(budgetDaysEarly) : Math.round(daysEarly)
    const lastAt   = client.last_runway_alert_at ? new Date(client.last_runway_alert_at) : null
    const lastDays = client.last_runway_alert_days

    if (lastAt) {
      const hoursElapsed = (now.getTime() - lastAt.getTime()) / 3_600_000
      const daysDelta    = currentDaysEarly - (lastDays ?? -999)
      const crossedToRed = (lastDays ?? -999) < 0 && currentDaysEarly >= 0
      if (!crossedToRed && hoursElapsed < 23 && daysDelta < 3) continue
    }

    // ── Message ──────────────────────────────────────────────────────────────
    const rebillDate = cycleEnd
      ? cycleEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'N/A'

    const alertData: AlertData = {
      afBalance, avgDailyAf, projectedDailyAf, setDailyAf, daysToRebill, rebillDate,
      monthlyBudget, afSinceBill,
      budgetImpliedDaily, budgetRemaining, recommendedDaily,
      paceRatio, budgetRunoutDays, budgetDaysEarly,
      runoutDays, daysEarly, triggers,
    }

    let message = ''
    if (aiApiKey) {
      message = await generateAlertMessage(aiProvider, aiApiKey, client.name, alertData)
    }
    if (!message) {
      message = buildFallbackMessage(client.name, alertData)
    }

    try {
      await db.from('admin_alerts').insert({
        type:        'ad_fuel',
        severity:    triggers.some(t => t.includes('runway')) ? 'critical' : 'warning',
        client_id:   client.id,
        client_name: client.name,
        title:       buildFallbackTitle(client.name, triggers),
        body:        message,
        meta:        { triggers, avgDailyAf, projectedDailyAf, setDailyAf, afBalance, daysToRebill, recommendedDaily, paceRatio, monthlyBudget },
        link_url:    '/admin/ad-fuel',
      })
      await db.from('clients').update({
        last_runway_alert_at:   now.toISOString(),
        last_runway_alert_days: currentDaysEarly,
      }).eq('id', client.id)
      alerted.push({ name: client.name, triggers })
      console.log(`[ad-fuel-budget-alerts] ${client.name}: ${triggers.join(', ')}`)
    } catch (err) {
      console.error(`[ad-fuel-budget-alerts] admin_alerts insert failed for ${client.name}:`, err)
    }
  }

  return NextResponse.json({ checked: clients.length, alerted })
}
