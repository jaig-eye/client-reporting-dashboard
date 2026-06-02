// Admin Overview — /admin/dashboard
// Merged clients + overview: sortable table of all clients with key metrics.

import { unstable_noStore as noStore } from 'next/cache'
import { Suspense }                  from 'react'
import { createAdminClient }         from '@/lib/supabase/server'
import Link                          from 'next/link'
import type { ConnectorType }        from '@/lib/types'
import { ConnectorLogo }             from '@/components/ConnectorLogo'
import { GearSix }                   from '@phosphor-icons/react/dist/ssr'
import DateRangePicker               from '@/components/DateRangePicker'
import AdminDateSync                 from './AdminDateSync'
import { calcEfficiencyScore }       from '@/lib/agency-settings'
import type { AgencySettings }       from '@/lib/types'
import { resolveMetaConversions, calcDelta } from '@/lib/metrics'

export const dynamic = 'force-dynamic'

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function subtractDays(d: Date, n: number) { return new Date(d.getTime() - n * 86_400_000) }

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

function getMtdFrom() {
  const now = new Date()
  return fmtDate(new Date(now.getFullYear(), now.getMonth(), 1))
}

function fmtSpend(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%` }
function fmtX(n: number)   { return `${n.toFixed(2)}x` }
function fmtBalance(n: number) {
  const neg = n < 0
  const abs = Math.abs(n)
  const str = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(1)}M`
             : abs >= 1_000    ? `$${(abs / 1_000).toFixed(1)}k`
             : `$${Math.round(abs).toLocaleString()}`
  return neg ? `-${str}` : str
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; sort?: string; dir?: string; compare?: string }>
}) {
  noStore()
  const today    = new Date()
  const params   = await searchParams
  const dateFrom = params.from  ?? getMtdFrom()
  const dateTo   = params.to    ?? fmtDate(today)
  const sortCol  = params.sort  ?? ''
  const sortDir  = params.dir   === 'asc' ? 'asc' : 'desc'
  const compare  = params.compare ?? 'none'

  // Prior period date range
  let priorFromStr = ''
  let priorToStr   = ''
  if (compare !== 'none') {
    const fromDate = new Date(dateFrom)
    const toDate   = new Date(dateTo)
    if (compare === 'last_year') {
      priorFromStr = fmtDate(new Date(fromDate.getFullYear() - 1, fromDate.getMonth(), fromDate.getDate()))
      priorToStr   = fmtDate(new Date(toDate.getFullYear() - 1, toDate.getMonth(), toDate.getDate()))
    } else {
      const periodMs  = toDate.getTime() - fromDate.getTime()
      const priorTo   = new Date(fromDate.getTime() - 86_400_000)
      const priorFrom = new Date(priorTo.getTime() - periodMs)
      priorFromStr = fmtDate(priorFrom)
      priorToStr   = fmtDate(priorTo)
    }
  }

  const db = createAdminClient()

  const [
    clientsRes,
    connectionsRes,
    syncJobsRes,
    googleMetricsRes,
    metaMetricsRes,
    settingsRes,
    campaignAssignmentsRes,
    metaSpendRpcRes,
  ] = await Promise.all([
    db.from('clients')
      .select('id, name, logo_url, benchmark_roas, benchmark_ctr, benchmark_cpc, benchmark_conv_rate, enabled_benchmarks, lead_action, lead_action_fallback, purchase_action, purchase_action_fallback, ad_fuel_cut, historic_bill_day')
      .order('name'),

    db.from('client_connections')
      .select('client_id, connector:connectors(id, type, label, status)')
      .eq('status', 'active'),

    // Fetch recent sync jobs (last 7 days) — we take the most recent per client
    db.from('sync_jobs')
      .select('id, client_id, status, completed_at')
      .gte('started_at', subtractDays(today, 7).toISOString())
      .order('completed_at', { ascending: false }),

    db.from('google_ads_metrics')
      .select('client_id, spend, clicks, impressions, conversions, conversions_value')
      .gte('date', dateFrom)
      .lte('date', dateTo),

    // meta_ads_metrics (campaign-level) for impressions/clicks/conversions — manageable row
    // count vs ad-level which can exceed PostgREST's row cap across all clients.
    db.from('meta_ads_metrics')
      .select('client_id, campaign_id, spend, clicks, impressions, actions, action_values')
      .gte('date', dateFrom)
      .lte('date', dateTo),

    db.from('agency_settings')
      .select('benchmark_roas, benchmark_ctr, benchmark_cpc, benchmark_conv_rate, overview_columns, default_lead_action, default_lead_action_fallback, default_purchase_action, default_purchase_action_fallback, ad_fuel_cut, ad_fuel_cutoff_date')
      .single(),

    db.from('client_campaign_assignments')
      .select('client_id, campaign_id, display_mode'),

    // RPC for exact Meta spend per client — aggregates meta_ads_ad_metrics at DB level,
    // no row cap. Used to override the spend field from the campaign-level table above.
    db.rpc('sum_meta_spend_by_client', { from_date: dateFrom, to_date: dateTo }),
  ])

  // Prior period queries — only fetched when comparison is active
  const [priorGoogleRes, priorMetaRes, priorMetaSpendRpcRes] = compare !== 'none' && priorFromStr
    ? await Promise.all([
        db.from('google_ads_metrics')
          .select('client_id, spend, clicks, impressions, conversions, conversions_value')
          .gte('date', priorFromStr).lte('date', priorToStr),
        db.from('meta_ads_metrics')
          .select('client_id, campaign_id, spend, clicks, impressions, actions, action_values')
          .gte('date', priorFromStr).lte('date', priorToStr),
        db.rpc('sum_meta_spend_by_client', { from_date: priorFromStr, to_date: priorToStr }),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  interface ConnRow {
    client_id: string
    connector: { id: string; type: string; label: string; status: string }
  }

  interface SyncJobRow {
    id: string
    client_id: string
    status: string
    completed_at: string | null
  }

  type ClientRow = {
    id: string; name: string; logo_url?: string
    benchmark_roas?: number | null; benchmark_ctr?: number | null
    benchmark_cpc?: number | null; benchmark_conv_rate?: number | null
    enabled_benchmarks?: string[] | null
    lead_action?: string | null; lead_action_fallback?: string | null
    purchase_action?: string | null; purchase_action_fallback?: string | null
    ad_fuel_cut?: number | null
    historic_bill_day?: number | null
  }

  const clients     = (clientsRes.data     ?? []) as ClientRow[]
  const connections = (connectionsRes.data ?? []) as unknown as ConnRow[]
  const syncJobs    = (syncJobsRes.data    ?? []) as SyncJobRow[]
  const googleRows  = googleMetricsRes.data ?? []
  const metaRows    = metaMetricsRes.data   ?? []
  const rawSettings = settingsRes.data as Record<string, unknown> | null
  const globalSettings = (rawSettings as Pick<AgencySettings, 'benchmark_roas' | 'benchmark_ctr' | 'benchmark_cpc' | 'benchmark_conv_rate'> | null) ?? {
    benchmark_roas: 3.0, benchmark_ctr: 0.03, benchmark_cpc: 3.0, benchmark_conv_rate: 0.03,
  }
  const defaultLeadAction         = (rawSettings?.default_lead_action         as string | null) ?? 'onsite_conversion.lead_grouped'
  const defaultLeadFallback       = (rawSettings?.default_lead_action_fallback as string | null) ?? 'lead'
  const defaultPurchaseAction     = (rawSettings?.default_purchase_action      as string | null) ?? 'purchase'
  const defaultPurchaseFallback   = (rawSettings?.default_purchase_action_fallback as string | null) ?? null
  const DEFAULT_COLS = ['spend', 'roas', 'cpa', 'conversions', 'ctr', 'sync_status']
  const rawCols: string[] = Array.isArray(rawSettings?.overview_columns)
    ? rawSettings!.overview_columns as string[]
    : DEFAULT_COLS
  // Expand legacy 'roas_cpl' column into separate 'roas' + 'cpa' columns
  const overviewCols: string[] = rawCols.flatMap(c => c === 'roas_cpl' ? ['roas', 'cpa'] : [c])

  // Ad fuel balance queries — separate from period-filtered metrics
  const afCutoffDate    = (rawSettings?.ad_fuel_cutoff_date as string | null) ?? '2025-01-01'
  const afCutoffMs      = new Date(afCutoffDate + 'T00:00:00Z').getTime()
  const agencyAdFuelCut = (rawSettings?.ad_fuel_cut as number | null) ?? 0.20

  const [afGoogleRes, afMetaRes, afLedgerRes] = await Promise.all([
    db.rpc('sum_google_spend_by_client', { from_date: afCutoffDate }),
    db.rpc('sum_meta_spend_by_client',   { from_date: afCutoffDate }),
    db.from('ad_fuel_ledger').select('client_id, amount_af, date_of_payment'),
  ])

  type AfSumRow    = { client_id: string; spend: number }
  type AfLedgerRow = { client_id: string; amount_af: number; date_of_payment: string }

  const afGMap: Record<string, number> = {}
  const afMMap: Record<string, number> = {}
  for (const r of (afGoogleRes.data ?? []) as AfSumRow[]) afGMap[r.client_id] = Number(r.spend ?? 0)
  for (const r of (afMetaRes.data  ?? []) as AfSumRow[]) afMMap[r.client_id]  = Number(r.spend ?? 0)

  const afLedgerByClient: Record<string, AfLedgerRow[]> = {}
  for (const r of (afLedgerRes.data ?? []) as AfLedgerRow[]) {
    if (!afLedgerByClient[r.client_id]) afLedgerByClient[r.client_id] = []
    afLedgerByClient[r.client_id].push(r)
  }

  // Mirror the Ad Fuel page: subtract gap spend (cutoff → effectiveCutoff-1) for clients
  // with a historic_bill_day so the balance starts from the first real billing cycle.
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
      for (const r of (gGap.data ?? []) as AfSumRow[]) if (ids.includes(r.client_id)) afGapGoogle[r.client_id] = Number(r.spend ?? 0)
      for (const r of (mGap.data ?? []) as AfSumRow[]) if (ids.includes(r.client_id)) afGapMeta[r.client_id]   = Number(r.spend ?? 0)
    }))
  }

  const afBalanceByClient: Record<string, number> = {}
  for (const client of clients) {
    const cut    = client.ad_fuel_cut ?? agencyAdFuelCut
    const split  = 1 - cut
    const gAdj = afGapGoogle[client.id] ?? 0
    const mAdj = afGapMeta[client.id]   ?? 0
    const rawSpend = Math.max(0, (afGMap[client.id] ?? 0) - gAdj) + Math.max(0, (afMMap[client.id] ?? 0) - mAdj)
    const afSpend  = split > 0 ? rawSpend / split : 0
    let afPurchased = 0
    for (const e of afLedgerByClient[client.id] ?? []) {
      const eMs = new Date(e.date_of_payment + 'T00:00:00Z').getTime()
      if (eMs >= afCutoffMs) afPurchased += Number(e.amount_af)
    }
    afBalanceByClient[client.id] = afPurchased - afSpend
  }

  // Campaign display_mode map: `${clientId}:${campaignId}` → 'ecommerce' | 'lead_gen'
  const campaignModeMap = new Map<string, string>()
  for (const a of (campaignAssignmentsRes.data ?? []) as { client_id: string; campaign_id: string; display_mode: string }[]) {
    campaignModeMap.set(`${a.client_id}:${a.campaign_id}`, a.display_mode)
  }

  // Derive whether each client has any ecom campaign (across all sources)
  const clientHasEcomMap = new Map<string, boolean>()
  for (const [key, mode] of Array.from(campaignModeMap.entries())) {
    const cid = key.split(':')[0]
    if (mode === 'ecommerce') clientHasEcomMap.set(cid, true)
    else if (!clientHasEcomMap.has(cid)) clientHasEcomMap.set(cid, false)
  }

  // Build per-client conversion action config (client override → agency default)
  const clientConfigMap = new Map<string, { leadAction: string; leadFallback: string | null; purchaseAction: string; purchaseFallback: string | null }>()
  for (const c of clients) {
    clientConfigMap.set(c.id, {
      leadAction:      c.lead_action      ?? defaultLeadAction,
      leadFallback:    c.lead_action_fallback  ?? defaultLeadFallback,
      purchaseAction:  c.purchase_action   ?? defaultPurchaseAction,
      purchaseFallback: c.purchase_action_fallback ?? defaultPurchaseFallback,
    })
  }


  // Group connections by client_id
  const connsByClient = new Map<string, ConnRow[]>()
  for (const conn of connections) {
    if (!connsByClient.has(conn.client_id)) connsByClient.set(conn.client_id, [])
    connsByClient.get(conn.client_id)!.push(conn)
  }

  // Most recent sync job per client
  const latestSyncByClient = new Map<string, SyncJobRow>()
  for (const job of syncJobs) {
    const cid = job.client_id
    if (!latestSyncByClient.has(cid)) {
      // syncJobs is ordered by completed_at DESC, so first entry per client = most recent
      latestSyncByClient.set(cid, job)
    }
  }

  // Aggregate Google Ads metrics per client
  const googleByClient = new Map<string, { spend: number; clicks: number; conv: number; value: number; impressions: number }>()
  for (const row of googleRows) {
    const cid = row.client_id as string
    if (!googleByClient.has(cid)) googleByClient.set(cid, { spend: 0, clicks: 0, conv: 0, value: 0, impressions: 0 })
    const m = googleByClient.get(cid)!
    m.spend       += (row.spend             as number) ?? 0
    m.clicks      += (row.clicks            as number) ?? 0
    m.conv        += (row.conversions       as number) ?? 0
    m.value       += (row.conversions_value as number) ?? 0
    m.impressions += (row.impressions       as number) ?? 0
  }

  // Aggregate Meta Ads metrics per client — apply per-client conversion mapping
  const metaByClient = new Map<string, { spend: number; clicks: number; conv: number; value: number; impressions: number }>()
  for (const row of metaRows) {
    const cid = row.client_id as string
    if (!metaByClient.has(cid)) metaByClient.set(cid, { spend: 0, clicks: 0, conv: 0, value: 0, impressions: 0 })
    const m = metaByClient.get(cid)!
    m.spend       += (row.spend        as number) ?? 0
    m.clicks      += (row.clicks       as number) ?? 0
    m.impressions += (row.impressions  as number) ?? 0
    // Apply client-specific conversion mapping (same logic as client dashboard)
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

  // Override Meta spend with RPC totals (exact, from ad-level table via RPC)
  type MetaSpendRow = { client_id: string; spend: number }
  for (const r of ((metaSpendRpcRes.data ?? []) as MetaSpendRow[])) {
    const entry = metaByClient.get(r.client_id)
    if (entry) entry.spend = Number(r.spend ?? 0)
    else metaByClient.set(r.client_id, { spend: Number(r.spend ?? 0), clicks: 0, conv: 0, value: 0, impressions: 0 })
  }

  // Aggregate prior-period Google Ads metrics per client
  const priorGoogleByClient = new Map<string, { spend: number; clicks: number; conv: number; value: number; impressions: number }>()
  for (const row of (priorGoogleRes.data ?? [])) {
    const cid = row.client_id as string
    if (!priorGoogleByClient.has(cid)) priorGoogleByClient.set(cid, { spend: 0, clicks: 0, conv: 0, value: 0, impressions: 0 })
    const m = priorGoogleByClient.get(cid)!
    m.spend       += (row.spend             as number) ?? 0
    m.clicks      += (row.clicks            as number) ?? 0
    m.conv        += (row.conversions       as number) ?? 0
    m.value       += (row.conversions_value as number) ?? 0
    m.impressions += (row.impressions       as number) ?? 0
  }

  // Aggregate prior-period Meta Ads metrics per client
  const priorMetaByClient = new Map<string, { spend: number; clicks: number; conv: number; value: number; impressions: number }>()
  for (const row of (priorMetaRes.data ?? [])) {
    const cid = row.client_id as string
    if (!priorMetaByClient.has(cid)) priorMetaByClient.set(cid, { spend: 0, clicks: 0, conv: 0, value: 0, impressions: 0 })
    const m = priorMetaByClient.get(cid)!
    m.spend       += (row.spend        as number) ?? 0
    m.clicks      += (row.clicks       as number) ?? 0
    m.impressions += (row.impressions  as number) ?? 0
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

  // Summary totals
  const googleSpendTotal  = Array.from(googleByClient.values()).reduce((s, m) => s + m.spend, 0)
  const metaSpendTotal    = Array.from(metaByClient.values()).reduce((s, m) => s + m.spend, 0)
  const totalSpend        = googleSpendTotal + metaSpendTotal
  const syncErrorCount    = syncJobs.filter(j => j.status === 'error').length
  const clientsWithErrors = new Set(syncJobs.filter(j => j.status === 'error').map(j => j.client_id)).size
  // Only sum clients that have ledger entries (others haven't been set up for ad fuel)
  const totalAdFuelBalance = clients
    .filter(c => (afLedgerByClient[c.id]?.length ?? 0) > 0)
    .reduce((s, c) => s + (afBalanceByClient[c.id] ?? 0), 0)

  // Build per-client row data
  let clientRows = clients.map(client => {
    const conns        = connsByClient.get(client.id) ?? []
    const gData        = googleByClient.get(client.id)
    const mData        = metaByClient.get(client.id)
    const spend        = (gData?.spend ?? 0) + (mData?.spend ?? 0)
    const clicks       = (gData?.clicks ?? 0) + (mData?.clicks ?? 0)
    const impressions  = (gData?.impressions ?? 0) + (mData?.impressions ?? 0)
    const conversions  = Math.round((gData?.conv ?? 0) + (mData?.conv ?? 0))
    const enabledBenchmarks = client.enabled_benchmarks ?? null
    const showRoas     = enabledBenchmarks
      ? enabledBenchmarks.includes('roas')
      : clientHasEcomMap.get(client.id) === true
    const totalValue   = (gData?.value ?? 0) + (mData?.value ?? 0)
    const totalAdSpend = (gData?.spend ?? 0) + (mData?.spend ?? 0)
    const roas         = showRoas && totalAdSpend > 0 && totalValue > 0 ? totalValue / totalAdSpend : null
    const ctr          = impressions > 0 ? clicks / impressions : 0
    const cpl          = conversions > 0 ? spend / conversions : null

    const benchmarks = {
      benchmark_roas:      client.benchmark_roas      ?? globalSettings.benchmark_roas,
      benchmark_ctr:       client.benchmark_ctr       ?? globalSettings.benchmark_ctr,
      benchmark_cpc:       client.benchmark_cpc       ?? globalSettings.benchmark_cpc,
      benchmark_conv_rate: client.benchmark_conv_rate ?? globalSettings.benchmark_conv_rate,
    }

    const efficiencyScore = spend > 0 && (roas !== null || ctr > 0)
      ? calcEfficiencyScore({ roas: roas ?? 0, ctr, cpc: clicks > 0 ? spend / clicks : 0, convRate: clicks > 0 ? conversions / clicks : 0 }, benchmarks)
      : null

    // Use most recent sync job for status dot
    const latestJob = latestSyncByClient.get(client.id) ?? null
    const syncStatus: 'success' | 'error' | 'none' = latestJob
      ? (latestJob.status === 'error' ? 'error' : 'success')
      : 'none'
    const completedAt = latestJob?.completed_at ? new Date(latestJob.completed_at) : null
    const hoursStale  = completedAt ? (Date.now() - completedAt.getTime()) / 3_600_000 : Infinity

    const syncErrCount = syncJobs.filter(j => j.client_id === client.id && j.status === 'error').length

    // Prior period metrics + deltas
    const pgData   = priorGoogleByClient.get(client.id)
    const pmData   = priorMetaByClient.get(client.id)
    const priorSpend       = (pgData?.spend ?? 0) + (pmData?.spend ?? 0)
    const priorConversions = Math.round((pgData?.conv ?? 0) + (pmData?.conv ?? 0))
    const priorImpr        = (pgData?.impressions ?? 0) + (pmData?.impressions ?? 0)
    const priorClicks      = (pgData?.clicks ?? 0) + (pmData?.clicks ?? 0)
    const priorValue       = (pgData?.value ?? 0) + (pmData?.value ?? 0)
    const priorAdSpend     = (pgData?.spend ?? 0) + (pmData?.spend ?? 0)
    const priorRoas        = showRoas && priorAdSpend > 0 && priorValue > 0 ? priorValue / priorAdSpend : null
    const priorCpl         = priorConversions > 0 ? priorSpend / priorConversions : null
    const priorCtr         = priorImpr > 0 ? priorClicks / priorImpr : 0

    const deltaSpend       = compare !== 'none' && priorSpend > 0       ? calcDelta(spend, priorSpend)             : undefined
    const deltaConv        = compare !== 'none' && priorConversions > 0 ? calcDelta(conversions, priorConversions) : undefined
    const deltaCtr         = compare !== 'none' && priorCtr > 0         ? calcDelta(ctr, priorCtr)                : undefined
    const deltaClicks      = compare !== 'none' && priorClicks > 0      ? calcDelta(clicks, priorClicks)          : undefined
    const deltaImpr        = compare !== 'none' && priorImpr > 0        ? calcDelta(impressions, priorImpr)       : undefined
    const deltaRoas        = compare !== 'none' && roas !== null && priorRoas !== null ? calcDelta(roas, priorRoas) : undefined
    const deltaCpl         = compare !== 'none' && cpl !== null && priorCpl !== null   ? calcDelta(cpl, priorCpl)  : undefined

    const afBalance   = afBalanceByClient[client.id] ?? 0
    const hasAfLedger = (afLedgerByClient[client.id]?.length ?? 0) > 0

    return {
      id: client.id, name: client.name, logoUrl: client.logo_url ?? null,
      connectors: conns.map(c => ({ type: c.connector.type as ConnectorType, label: c.connector.label })),
      spend, conversions, clicks, impressions, ctr, roas, cpl, showRoas, efficiencyScore, hoursStale, syncStatus, syncErrCount,
      deltaSpend, deltaConv, deltaCtr, deltaClicks, deltaImpr, deltaRoas, deltaCpl,
      afBalance, hasAfLedger,
    }
  })

  // Sort
  if (sortCol) {
    clientRows = clientRows.sort((a, b) => {
      let av: number, bv: number
      if (sortCol === 'spend') {
        av = a.spend; bv = b.spend
      } else if (sortCol === 'roas_cpl' || sortCol === 'roas') {
        av = a.roas ?? -1; bv = b.roas ?? -1
      } else if (sortCol === 'cpa') {
        av = a.cpl ?? Infinity; bv = b.cpl ?? Infinity
      } else if (sortCol === 'conversions') {
        av = a.conversions; bv = b.conversions
      } else if (sortCol === 'ctr') {
        av = a.ctr; bv = b.ctr
      } else if (sortCol === 'clicks') {
        av = a.clicks; bv = b.clicks
      } else if (sortCol === 'impressions') {
        av = a.impressions; bv = b.impressions
      } else if (sortCol === 'ad_fuel') {
        av = a.hasAfLedger ? a.afBalance : -Infinity
        bv = b.hasAfLedger ? b.afBalance : -Infinity
      } else if (sortCol === 'name') {
        return sortDir === 'asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name)
      } else {
        return 0
      }
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }

  function sortHref(col: string) {
    const newDir = sortCol === col && sortDir === 'desc' ? 'asc' : 'desc'
    const base = new URLSearchParams()
    if (params.from)    base.set('from', params.from)
    if (params.to)      base.set('to',   params.to)
    if (compare !== 'none') base.set('compare', compare)
    base.set('sort', col)
    base.set('dir',  newDir)
    return `/admin/dashboard?${base}`
  }

  function SortArrow({ col }: { col: string }) {
    if (sortCol !== col) return <span style={{ opacity: 0.3, marginLeft: 3 }}>↕</span>
    return <span style={{ marginLeft: 3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div>
      <Suspense fallback={null}>
        <AdminDateSync />
      </Suspense>

      {/* Page header */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="page-title">Clients</h1>
        <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
          <Suspense fallback={null}>
            <DateRangePicker from={dateFrom} to={dateTo} compare={compare} />
          </Suspense>
          <Link href="/admin/clients/new" className="btn btn-primary">+ Add Client</Link>
        </div>
      </div>

      {/* Stat cards — only Sync Errors is clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <StatCard label="Total Clients"        value={String(clients.length)} />
        <StatCard label="Active Connectors"    value={String(connections.length)} color="blue" />
        <StatCard label="Sync Errors (7d)"     value={String(clientsWithErrors)} href="/admin/system" color={clientsWithErrors > 0 ? 'red' : 'default'} />
        <StatCard label="Total Spend (period)" value={fmtSpend(totalSpend)} color="blue" />
        <StatCard label="Total Ad Fuel"        value={fmtBalance(totalAdFuelBalance)} color={totalAdFuelBalance > 500 ? 'green' : totalAdFuelBalance < 0 ? 'red' : 'default'} href="/admin/ad-fuel" />
      </div>

      {/* Row hover via CSS — server component can't use onMouseEnter/Leave */}
      <style>{`.client-row:hover { background: var(--bg-muted) !important; }`}</style>

      {/* Client table */}
      {clients.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No clients yet</p>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Add your first client to start managing their data connections.
          </p>
          <Link href="/admin/clients/new" className="btn btn-primary">+ Add Client</Link>
        </div>
      ) : (
        <div className="card overflow-hidden" style={{ padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <SortableTh col="name" label="Client" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                  <th style={TH_STYLE}>Sources</th>
                  {overviewCols.map(col => {
                    if (col === 'spend')       return <SortableTh key={col} col="spend"       label="Spend"      align="right" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'roas_cpl')    return <SortableTh key={col} col="roas"        label="ROAS / CPA" align="right" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'roas')        return <SortableTh key={col} col="roas"        label="ROAS"       align="right" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'cpa')         return <SortableTh key={col} col="cpa"         label="CPA"        align="right" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'conversions') return <SortableTh key={col} col="conversions" label="Conv."      align="right" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'ctr')         return <SortableTh key={col} col="ctr"         label="CTR"        align="right" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'clicks')      return <SortableTh key={col} col="clicks"      label="Clicks"     align="right" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'impressions') return <SortableTh key={col} col="impressions" label="Impr."      align="right" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'sync_status') return <th key={col} style={TH_STYLE}>Sync</th>
                    if (col === 'ad_fuel')    return <SortableTh key={col} col="ad_fuel" label="Ad Fuel" align="right" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    return null
                  })}
                  <th style={TH_STYLE}></th>
                </tr>
              </thead>
              <tbody>
                {clientRows.map((row, i) => {
                  // Sync dot: green if last job was success within 48h, amber if >48h, red if error/none
                  let syncDot = 'var(--red)'
                  if (row.syncStatus === 'success') {
                    syncDot = row.hoursStale < 48 ? 'var(--green)' : 'var(--amber, #f59e0b)'
                  }

                  return (
                    <tr key={row.id} className="client-row" style={{
                      borderBottom: i < clientRows.length - 1 ? '1px solid var(--border-subtle)' : undefined,
                      background: i % 2 === 1 ? 'var(--bg-subtle)' : undefined,
                      transition: 'background 0.15s',
                    }}>
                      {/* Client name + logo */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <a href={`/api/admin/preview/${row.id}`}
                          style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {row.logoUrl ? (
                              <img src={row.logoUrl} alt="" style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'contain', flexShrink: 0 }} />
                            ) : (
                              <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                {row.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span>{row.name}</span>
                          </div>
                        </a>
                      </td>

                      {/* Data sources — connector logo icons */}
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {row.connectors.length === 0 ? (
                          <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            {row.connectors.map((c, ci) => (
                              <span key={ci} title={c.label} style={{ display: 'flex', alignItems: 'center' }}>
                                <ConnectorLogo type={c.type} size={16} aria-hidden />
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Dynamic columns in saved order */}
                      {overviewCols.map(col => {
                        if (col === 'spend') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {row.spend > 0 ? fmtSpend(row.spend) : <Dash />}
                            <DeltaBadge delta={row.deltaSpend} neutral />
                          </td>
                        )
                        if (col === 'roas_cpl') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {row.showRoas && row.roas !== null
                              ? <><span style={{ color: 'var(--text-primary)' }}>{fmtX(row.roas)}</span><DeltaBadge delta={row.deltaRoas} /></>
                              : row.cpl !== null
                                ? <><span style={{ color: 'var(--text-primary)' }}>{fmtSpend(row.cpl)}</span><DeltaBadge delta={row.deltaCpl} inverse /></>
                                : <Dash />
                            }
                          </td>
                        )
                        if (col === 'roas') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {row.roas !== null ? <span style={{ color: 'var(--text-primary)' }}>{fmtX(row.roas)}</span> : <Dash />}
                            <DeltaBadge delta={row.deltaRoas} />
                          </td>
                        )
                        if (col === 'cpa') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {row.cpl !== null ? <span style={{ color: 'var(--text-primary)' }}>{fmtSpend(row.cpl)}</span> : <Dash />}
                            <DeltaBadge delta={row.deltaCpl} inverse />
                          </td>
                        )
                        if (col === 'conversions') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {row.conversions > 0 ? row.conversions.toLocaleString() : <Dash />}
                            <DeltaBadge delta={row.deltaConv} />
                          </td>
                        )
                        if (col === 'ctr') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {row.ctr > 0 ? fmtPct(row.ctr) : <Dash />}
                            <DeltaBadge delta={row.deltaCtr} />
                          </td>
                        )
                        if (col === 'clicks') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {row.clicks > 0 ? row.clicks.toLocaleString() : <Dash />}
                            <DeltaBadge delta={row.deltaClicks} />
                          </td>
                        )
                        if (col === 'impressions') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {row.impressions > 0 ? row.impressions.toLocaleString() : <Dash />}
                            <DeltaBadge delta={row.deltaImpr} />
                          </td>
                        )
                        if (col === 'sync_status') return (
                          <td key={col} style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ width: 9, height: 9, borderRadius: '50%', background: syncDot, display: 'inline-block', flexShrink: 0 }} />
                              {row.syncErrCount > 0 && (
                                <span style={{ background: 'var(--red-subtle)', color: 'var(--red)', borderRadius: 4, padding: '0 0.3rem', fontSize: '0.6875rem', fontWeight: 600 }}>
                                  {row.syncErrCount}
                                </span>
                              )}
                            </div>
                          </td>
                        )
                        if (col === 'ad_fuel') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {row.hasAfLedger ? (
                              <span style={{
                                color: row.afBalance > 500 ? 'var(--green)' : row.afBalance < 0 ? 'var(--red)' : 'var(--amber, #f59e0b)',
                                fontWeight: 600,
                              }}>
                                {fmtBalance(row.afBalance)}
                              </span>
                            ) : <Dash />}
                          </td>
                        )
                        return null
                      })}

                      {/* Actions — gear icon */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <Link
                          href={`/admin/clients/${row.id}`}
                          title="Client Settings"
                          style={{ display: 'inline-flex', alignItems: 'center', padding: '0.3rem', borderRadius: 6, color: 'var(--text-muted)', textDecoration: 'none', transition: 'background 0.1s, color 0.1s' }}
                        >
                          <GearSix size={16} aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

const TH_STYLE: React.CSSProperties = {
  padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.6875rem',
  color: 'var(--text-faint)', whiteSpace: 'nowrap', background: 'var(--bg-secondary)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}

function SortableTh({ col, label, sortHref, sortCol, sortDir, align = 'left' }: {
  col: string; label: string
  sortHref: (col: string) => string
  sortCol: string; sortDir: string
  align?: 'left' | 'right'
}) {
  const active = sortCol === col
  return (
    <th style={{ ...TH_STYLE, cursor: 'pointer', textAlign: align }}>
      <a href={sortHref(col)} style={{ textDecoration: 'none', color: active ? 'var(--text-primary)' : 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', gap: 2, width: '100%' }}>
        {label}
        <span style={{ opacity: active ? 1 : 0.35, fontSize: '0.7rem' }}>
          {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </a>
    </th>
  )
}

function Dash() {
  return <span style={{ color: 'var(--text-faint)' }}>—</span>
}

function DeltaBadge({ delta, inverse = false, neutral = false }: { delta: number | undefined; inverse?: boolean; neutral?: boolean }) {
  if (delta == null || !isFinite(delta)) return null
  const up    = delta > 0
  const good  = neutral ? null : (inverse ? !up : up)
  const color = good === null ? 'var(--text-faint)' : good ? '#16a34a' : '#dc2626'
  return (
    <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 600, lineHeight: 1, marginTop: 2, color }}>
      {up ? '+' : ''}{delta.toFixed(1)}%
    </span>
  )
}

function StatCard({
  label, value, href, color = 'default',
}: {
  label: string; value: string; href?: string; color?: 'blue' | 'green' | 'red' | 'default'
}) {
  const colors = { blue: 'var(--blue)', green: 'var(--green)', red: 'var(--red)', default: 'var(--text-primary)' }
  const inner = (
    <div className="card p-5">
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-3xl font-bold" style={{ color: colors[color], fontVariantNumeric: 'tabular-nums' }}>{value}</p>
    </div>
  )
  if (!href) return inner
  return <Link href={href} className="card-hover block" style={{ textDecoration: 'none', borderRadius: 12, overflow: 'hidden' }}>{inner}</Link>
}
