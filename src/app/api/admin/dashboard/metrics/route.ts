// Admin Dashboard Metrics API — runs the expensive per-period and ad-fuel queries
// server-side and returns computed per-client metric data for progressive loading.

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import { resolveMetaConversions, applyAdFuel, calcDelta } from '@/lib/metrics'
import { calcEfficiencyScore }       from '@/lib/agency-settings'
import type { AgencySettings }       from '@/lib/types'

// ─── types ───────────────────────────────────────────────────────────────────

type AfSumRow    = { client_id: string; spend: number }
type AfLedgerRow = { client_id: string; amount_af: number; date_of_payment: string }
type MetaSpendRow = { client_id: string; spend: number }

type ClientConfigRow = {
  id: string
  benchmark_roas?: number | null
  benchmark_ctr?: number | null
  benchmark_cpc?: number | null
  benchmark_conv_rate?: number | null
  enabled_benchmarks?: string[] | null
  lead_action?: string | null
  lead_action_fallback?: string | null
  purchase_action?: string | null
  purchase_action_fallback?: string | null
  ad_fuel_cut?: number | null
  historic_bill_day?: number | null
}

export type ClientMetricData = {
  spend: number
  conversions: number
  clicks: number
  impressions: number
  ctr: number
  roas: number | null
  cpl: number | null
  showRoas: boolean
  efficiencyScore: number | null
  deltaSpend?: number
  deltaConv?: number
  deltaCtr?: number
  deltaClicks?: number
  deltaImpr?: number
  deltaRoas?: number
  deltaCpl?: number
  afBalance: number
  pendingAch: number
  hasAfLedger: boolean
}

export type MetricsApiResponse = {
  clientMetrics: Record<string, ClientMetricData>
  totalSpend: number
  totalAdFuelBalance: number
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function getAfEffectiveCutoff(cutoffDate: string, historicBillDay: number): string {
  const c = new Date(cutoffDate + 'T00:00:00Z')
  const year = c.getUTCFullYear(), month = c.getUTCMonth(), day = c.getUTCDate()
  if (day <= historicBillDay) return new Date(Date.UTC(year, month, historicBillDay)).toISOString().slice(0, 10)
  return new Date(Date.UTC(year, month + 1, historicBillDay)).toISOString().slice(0, 10)
}

function subtractOneDayStr(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

type PlatformTotals = { spend: number; clicks: number; conv: number; value: number; impressions: number }

function emptyTotals(): PlatformTotals {
  return { spend: 0, clicks: 0, conv: 0, value: 0, impressions: 0 }
}

// ─── GET /api/admin/dashboard/metrics ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const dateFrom    = searchParams.get('from')         || ''
  const dateTo      = searchParams.get('to')           || ''
  const compareFrom = searchParams.get('compare_from') || ''
  const compareTo   = searchParams.get('compare_to')   || ''
  const hasCompare  = !!(compareFrom && compareTo)

  const db = createAdminClient()

  // ── Round 1 (parallel): client config + current-period metric queries ──────
  const [
    clientsRes,
    settingsRes,
    googleMetricsRes,
    metaMetricsRes,
    metaSpendRpcRes,
    campaignAssignmentsRes,
  ] = await Promise.all([
    db.from('clients')
      .select('id, benchmark_roas, benchmark_ctr, benchmark_cpc, benchmark_conv_rate, enabled_benchmarks, lead_action, lead_action_fallback, purchase_action, purchase_action_fallback, ad_fuel_cut, historic_bill_day')
      .order('name'),

    db.from('agency_settings')
      .select('benchmark_roas, benchmark_ctr, benchmark_cpc, benchmark_conv_rate, ad_fuel_cut, ad_fuel_cutoff_date, default_lead_action, default_lead_action_fallback, default_purchase_action, default_purchase_action_fallback')
      .single(),

    db.rpc('get_google_metrics_by_client', { from_date: dateFrom, to_date: dateTo }),

    db.from('meta_ads_metrics')
      .select('client_id, campaign_id, spend, clicks, impressions, actions, action_values')
      .gte('date', dateFrom)
      .lte('date', dateTo),

    db.rpc('sum_meta_spend_by_client', { from_date: dateFrom, to_date: dateTo }),

    db.from('client_campaign_assignments').select('client_id, campaign_id, display_mode'),
  ])

  // ── Round 2 (parallel, only if compare present): prior-period metrics ──────
  const [priorGoogleRes, priorMetaRes, priorMetaSpendRpcRes] = hasCompare
    ? await Promise.all([
        db.rpc('get_google_metrics_by_client', { from_date: compareFrom, to_date: compareTo }),
        db.from('meta_ads_metrics')
          .select('client_id, campaign_id, spend, clicks, impressions, actions, action_values')
          .gte('date', compareFrom)
          .lte('date', compareTo),
        db.rpc('sum_meta_spend_by_client', { from_date: compareFrom, to_date: compareTo }),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  // ── Parse settings ────────────────────────────────────────────────────────
  const rawSettings = settingsRes.data as Record<string, unknown> | null
  const globalSettings = (rawSettings as Pick<AgencySettings, 'benchmark_roas' | 'benchmark_ctr' | 'benchmark_cpc' | 'benchmark_conv_rate'> | null) ?? {
    benchmark_roas: 3.0, benchmark_ctr: 0.03, benchmark_cpc: 3.0, benchmark_conv_rate: 0.03,
  }
  const agencyAdFuelCut    = (rawSettings?.ad_fuel_cut         as number | null) ?? 0.20
  const afCutoffDate       = (rawSettings?.ad_fuel_cutoff_date as string | null) ?? '2025-01-01'
  const afCutoffMs         = new Date(afCutoffDate + 'T00:00:00Z').getTime()
  const defaultLeadAction  = (rawSettings?.default_lead_action as string | null)         ?? 'onsite_conversion.lead_grouped'
  const defaultLeadFallback    = (rawSettings?.default_lead_action_fallback     as string | null) ?? 'lead'
  const defaultPurchaseAction  = (rawSettings?.default_purchase_action          as string | null) ?? 'purchase'
  const defaultPurchaseFallback = (rawSettings?.default_purchase_action_fallback as string | null) ?? null

  const clients = (clientsRes.data ?? []) as ClientConfigRow[]

  // ── Campaign display mode map ─────────────────────────────────────────────
  const campaignModeMap = new Map<string, string>()
  for (const a of (campaignAssignmentsRes.data ?? []) as { client_id: string; campaign_id: string; display_mode: string }[]) {
    campaignModeMap.set(`${a.client_id}:${a.campaign_id}`, a.display_mode)
  }

  // Derive whether each client has any ecom campaign
  const clientHasEcomMap = new Map<string, boolean>()
  for (const [key, mode] of Array.from(campaignModeMap.entries())) {
    const cid = key.split(':')[0]
    if (mode === 'ecommerce') clientHasEcomMap.set(cid, true)
    else if (!clientHasEcomMap.has(cid)) clientHasEcomMap.set(cid, false)
  }

  // Per-client conversion action config (client override → agency default)
  const clientConfigMap = new Map<string, {
    leadAction: string; leadFallback: string | null
    purchaseAction: string; purchaseFallback: string | null
  }>()
  for (const c of clients) {
    clientConfigMap.set(c.id, {
      leadAction:      c.lead_action      ?? defaultLeadAction,
      leadFallback:    c.lead_action_fallback  ?? defaultLeadFallback,
      purchaseAction:  c.purchase_action   ?? defaultPurchaseAction,
      purchaseFallback: c.purchase_action_fallback ?? defaultPurchaseFallback,
    })
  }

  // ── Aggregate Google metrics (current period) ─────────────────────────────
  const googleByClient = new Map<string, PlatformTotals>()
  for (const row of (googleMetricsRes.data ?? [])) {
    const cid = row.client_id as string
    if (!googleByClient.has(cid)) googleByClient.set(cid, emptyTotals())
    const m = googleByClient.get(cid)!
    m.spend       += (row.spend             as number) ?? 0
    m.clicks      += (row.clicks            as number) ?? 0
    m.conv        += (row.conversions       as number) ?? 0
    m.value       += (row.conversions_value as number) ?? 0
    m.impressions += (row.impressions       as number) ?? 0
  }

  // ── Aggregate Meta metrics (current period) ───────────────────────────────
  const metaByClient = new Map<string, PlatformTotals>()
  for (const row of (metaMetricsRes.data ?? [])) {
    const cid = row.client_id as string
    if (!metaByClient.has(cid)) metaByClient.set(cid, emptyTotals())
    const m = metaByClient.get(cid)!
    m.spend       += (row.spend       as number) ?? 0
    m.clicks      += (row.clicks      as number) ?? 0
    m.impressions += (row.impressions as number) ?? 0
    const cfg      = clientConfigMap.get(cid)
    const campMode = campaignModeMap.get(`${cid}:${row.campaign_id as string}`) ?? 'lead_gen'
    const isEcom   = campMode === 'ecommerce'
    const primary  = isEcom ? (cfg?.purchaseAction  ?? defaultPurchaseAction)  : (cfg?.leadAction    ?? defaultLeadAction)
    const fallback = isEcom ? (cfg?.purchaseFallback ?? defaultPurchaseFallback) : (cfg?.leadFallback ?? defaultLeadFallback)
    if (Array.isArray(row.actions)) {
      const resolved = resolveMetaConversions(
        row.actions as { action_type: string; value: string }[],
        (row.action_values as { action_type: string; value: string }[] | null) ?? [],
        primary,
        fallback,
      )
      m.conv  += resolved.conversions
      m.value += resolved.conversionValue
    }
  }

  // Override Meta spend with RPC totals (exact, from ad-level table)
  for (const r of ((metaSpendRpcRes.data ?? []) as MetaSpendRow[])) {
    const entry = metaByClient.get(r.client_id)
    if (entry) entry.spend = Number(r.spend ?? 0)
    else metaByClient.set(r.client_id, { spend: Number(r.spend ?? 0), clicks: 0, conv: 0, value: 0, impressions: 0 })
  }

  // ── Aggregate Google metrics (prior period) ───────────────────────────────
  const priorGoogleByClient = new Map<string, PlatformTotals>()
  for (const row of (priorGoogleRes.data ?? [])) {
    const cid = row.client_id as string
    if (!priorGoogleByClient.has(cid)) priorGoogleByClient.set(cid, emptyTotals())
    const m = priorGoogleByClient.get(cid)!
    m.spend       += (row.spend             as number) ?? 0
    m.clicks      += (row.clicks            as number) ?? 0
    m.conv        += (row.conversions       as number) ?? 0
    m.value       += (row.conversions_value as number) ?? 0
    m.impressions += (row.impressions       as number) ?? 0
  }

  // ── Aggregate Meta metrics (prior period) ─────────────────────────────────
  const priorMetaByClient = new Map<string, PlatformTotals>()
  for (const row of (priorMetaRes.data ?? [])) {
    const cid = row.client_id as string
    if (!priorMetaByClient.has(cid)) priorMetaByClient.set(cid, emptyTotals())
    const m = priorMetaByClient.get(cid)!
    m.spend       += (row.spend       as number) ?? 0
    m.clicks      += (row.clicks      as number) ?? 0
    m.impressions += (row.impressions as number) ?? 0
    const cfg      = clientConfigMap.get(cid)
    const campMode = campaignModeMap.get(`${cid}:${row.campaign_id as string}`) ?? 'lead_gen'
    const isEcom   = campMode === 'ecommerce'
    const primary  = isEcom ? (cfg?.purchaseAction  ?? defaultPurchaseAction)  : (cfg?.leadAction    ?? defaultLeadAction)
    const fallback = isEcom ? (cfg?.purchaseFallback ?? defaultPurchaseFallback) : (cfg?.leadFallback ?? defaultLeadFallback)
    if (Array.isArray(row.actions)) {
      const resolved = resolveMetaConversions(
        row.actions as { action_type: string; value: string }[],
        (row.action_values as { action_type: string; value: string }[] | null) ?? [],
        primary,
        fallback,
      )
      m.conv  += resolved.conversions
      m.value += resolved.conversionValue
    }
  }

  // Override prior-period Meta spend with RPC totals
  for (const r of ((priorMetaSpendRpcRes?.data ?? []) as MetaSpendRow[])) {
    const entry = priorMetaByClient.get(r.client_id)
    if (entry) entry.spend = Number(r.spend ?? 0)
    else priorMetaByClient.set(r.client_id, { spend: Number(r.spend ?? 0), clicks: 0, conv: 0, value: 0, impressions: 0 })
  }

  // ── Round 3 (parallel): ad fuel cumulative queries ────────────────────────
  const [afGoogleRes, afMetaRes, afLedgerRes, afPendingRes] = await Promise.all([
    db.rpc('sum_google_spend_by_client', { from_date: afCutoffDate }),
    db.rpc('sum_meta_spend_by_client',   { from_date: afCutoffDate }),
    db.from('ad_fuel_ledger').select('client_id, amount_af, date_of_payment'),
    db.from('ad_fuel_ach_pending').select('client_id, amount_af'),
  ])

  const afGMap: Record<string, number> = {}
  const afMMap: Record<string, number> = {}
  for (const r of (afGoogleRes.data ?? []) as AfSumRow[]) afGMap[r.client_id] = Number(r.spend ?? 0)
  for (const r of (afMetaRes.data  ?? []) as AfSumRow[]) afMMap[r.client_id]  = Number(r.spend ?? 0)

  const afLedgerByClient: Record<string, AfLedgerRow[]> = {}
  for (const r of (afLedgerRes.data ?? []) as AfLedgerRow[]) {
    if (!afLedgerByClient[r.client_id]) afLedgerByClient[r.client_id] = []
    afLedgerByClient[r.client_id].push(r)
  }

  const pendingAchByClient: Record<string, number> = {}
  for (const r of (afPendingRes.data ?? []) as { client_id: string; amount_af: number }[]) {
    pendingAchByClient[r.client_id] = (pendingAchByClient[r.client_id] ?? 0) + Number(r.amount_af)
  }

  // ── Round 4: gap spend queries for historic_bill_day clients ──────────────
  const afGapGoogle: Record<string, number> = {}
  const afGapMeta:   Record<string, number> = {}
  const historicAfClients = clients.filter(c => c.historic_bill_day != null)
  if (historicAfClients.length > 0) {
    const gapGroups: Record<string, string[]> = {}
    for (const c of historicAfClients) {
      const eff = getAfEffectiveCutoff(afCutoffDate, c.historic_bill_day!)
      if (eff > afCutoffDate) {
        const gapEnd = subtractOneDayStr(eff)
        if (!gapGroups[gapEnd]) gapGroups[gapEnd] = []
        gapGroups[gapEnd].push(c.id)
      }
    }
    await Promise.all(Object.entries(gapGroups).map(async ([gapEnd, ids]) => {
      const [gGap, mGap] = await Promise.all([
        db.rpc('sum_google_spend_by_client', { from_date: afCutoffDate, to_date: gapEnd }),
        db.rpc('sum_meta_spend_by_client',   { from_date: afCutoffDate, to_date: gapEnd }),
      ])
      for (const r of (gGap.data ?? []) as AfSumRow[]) {
        if (ids.includes(r.client_id)) afGapGoogle[r.client_id] = Number(r.spend ?? 0)
      }
      for (const r of (mGap.data ?? []) as AfSumRow[]) {
        if (ids.includes(r.client_id)) afGapMeta[r.client_id] = Number(r.spend ?? 0)
      }
    }))
  }

  // ── Compute ad fuel balance per client ────────────────────────────────────
  const afBalanceByClient: Record<string, number> = {}
  for (const client of clients) {
    const cut   = client.ad_fuel_cut ?? agencyAdFuelCut
    const split = 1 - cut
    const gAdj  = afGapGoogle[client.id] ?? 0
    const mAdj  = afGapMeta[client.id]   ?? 0
    const rawSpend  = Math.max(0, (afGMap[client.id] ?? 0) - gAdj) + Math.max(0, (afMMap[client.id] ?? 0) - mAdj)
    const afSpend   = split > 0 ? rawSpend / split : 0
    let afPurchased = 0
    for (const e of afLedgerByClient[client.id] ?? []) {
      const eMs = new Date(e.date_of_payment + 'T00:00:00Z').getTime()
      if (eMs >= afCutoffMs) afPurchased += Number(e.amount_af)
    }
    afBalanceByClient[client.id] = afPurchased - afSpend
  }

  // ── Build clientMetrics ───────────────────────────────────────────────────
  const clientMetrics: Record<string, ClientMetricData> = {}
  let totalSpend = 0

  for (const client of clients) {
    const gData  = googleByClient.get(client.id)
    const mData  = metaByClient.get(client.id)
    const cut    = client.ad_fuel_cut ?? agencyAdFuelCut
    const rawSpd = (gData?.spend ?? 0) + (mData?.spend ?? 0)
    const spend  = cut > 0 ? applyAdFuel(rawSpd, cut) : rawSpd

    const clicks       = (gData?.clicks ?? 0) + (mData?.clicks ?? 0)
    const impressions  = (gData?.impressions ?? 0) + (mData?.impressions ?? 0)
    const conversions  = Math.round((gData?.conv ?? 0) + (mData?.conv ?? 0))
    const totalValue   = (gData?.value ?? 0) + (mData?.value ?? 0)

    const enabledBenchmarks = client.enabled_benchmarks ?? null
    const showRoas = enabledBenchmarks
      ? enabledBenchmarks.includes('roas')
      : clientHasEcomMap.get(client.id) === true

    const roas = showRoas && spend > 0 && totalValue > 0 ? totalValue / spend : null
    const ctr  = impressions > 0 ? clicks / impressions : 0
    const cpl  = conversions > 0 ? spend / conversions  : null

    const benchmarks = {
      benchmark_roas:      client.benchmark_roas      ?? globalSettings.benchmark_roas,
      benchmark_ctr:       client.benchmark_ctr       ?? globalSettings.benchmark_ctr,
      benchmark_cpc:       client.benchmark_cpc       ?? globalSettings.benchmark_cpc,
      benchmark_conv_rate: client.benchmark_conv_rate ?? globalSettings.benchmark_conv_rate,
    }
    const efficiencyScore = spend > 0 && (roas !== null || ctr > 0)
      ? calcEfficiencyScore(
          { roas: roas ?? 0, ctr, cpc: clicks > 0 ? spend / clicks : 0, convRate: clicks > 0 ? conversions / clicks : 0 },
          benchmarks,
        )
      : null

    // Prior period
    const pgData  = priorGoogleByClient.get(client.id)
    const pmData  = priorMetaByClient.get(client.id)
    const priorRawSpd      = (pgData?.spend ?? 0) + (pmData?.spend ?? 0)
    const priorSpend       = cut > 0 ? applyAdFuel(priorRawSpd, cut) : priorRawSpd
    const priorConversions = Math.round((pgData?.conv ?? 0) + (pmData?.conv ?? 0))
    const priorImpr        = (pgData?.impressions ?? 0) + (pmData?.impressions ?? 0)
    const priorClicks      = (pgData?.clicks ?? 0) + (pmData?.clicks ?? 0)
    const priorValue       = (pgData?.value ?? 0) + (pmData?.value ?? 0)
    const priorRoas        = showRoas && priorSpend > 0 && priorValue > 0 ? priorValue / priorSpend : null
    const priorCpl         = priorConversions > 0 ? priorSpend / priorConversions : null
    const priorCtr         = priorImpr > 0 ? priorClicks / priorImpr : 0

    const deltaSpend  = hasCompare && priorSpend > 0       ? calcDelta(spend,       priorSpend)       : undefined
    const deltaConv   = hasCompare && priorConversions > 0 ? calcDelta(conversions, priorConversions) : undefined
    const deltaCtr    = hasCompare && priorCtr > 0         ? calcDelta(ctr,         priorCtr)         : undefined
    const deltaClicks = hasCompare && priorClicks > 0      ? calcDelta(clicks,      priorClicks)      : undefined
    const deltaImpr   = hasCompare && priorImpr > 0        ? calcDelta(impressions, priorImpr)        : undefined
    const deltaRoas   = hasCompare && roas !== null && priorRoas !== null ? calcDelta(roas, priorRoas) : undefined
    const deltaCpl    = hasCompare && cpl  !== null && priorCpl  !== null ? calcDelta(cpl,  priorCpl)  : undefined

    const afBalance   = afBalanceByClient[client.id] ?? 0
    const pendingAch  = pendingAchByClient[client.id] ?? 0
    const hasAfLedger = (afLedgerByClient[client.id]?.length ?? 0) > 0

    totalSpend += spend

    clientMetrics[client.id] = {
      spend, conversions, clicks, impressions, ctr, roas, cpl, showRoas, efficiencyScore,
      deltaSpend, deltaConv, deltaCtr, deltaClicks, deltaImpr, deltaRoas, deltaCpl,
      afBalance, pendingAch, hasAfLedger,
    }
  }

  const totalAdFuelBalance = clients
    .filter(c => (afLedgerByClient[c.id]?.length ?? 0) > 0)
    .reduce((s, c) => s + (afBalanceByClient[c.id] ?? 0), 0)

  return NextResponse.json({ clientMetrics, totalSpend, totalAdFuelBalance } satisfies MetricsApiResponse)
}
