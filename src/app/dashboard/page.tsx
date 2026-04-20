// ─────────────────────────────────────────────────────────────────────────────
// Client Dashboard — /dashboard
//
// Cockpit view: all channels at a glance, optimised for client calls.
// Sidebar handles source navigation. This page always shows "all" paid sources.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings, pctOfBenchmark, scoreColor } from '@/lib/agency-settings'
import { summarizeMetrics, getDailyTrend, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency, applyAdFuel, resolveMetaConversions } from '@/lib/metrics'
import type { Client, ClientConnection, Connector, MetaAction } from '@/lib/types'
import SpendChart from '@/components/SpendChart'
import CampaignTable from '@/components/CampaignTable'
import ExportButtons from '@/components/ExportButtons'
import DateRangePicker from '@/components/DateRangePicker'
import SparkMetricCard from '@/components/SparkMetricCard'
import { GA4SummaryCard, GSCSummaryCard, GBPSummaryCard, AhrefsSummaryCard } from '@/components/connections'
import { ConnectorLogo } from '@/components/ConnectorLogo'
import { resolveLayout, DEFAULT_METRIC_LAYOUTS, METRIC_LABELS, PLATFORM_CARD_LABELS } from '@/lib/metric-layouts'
import type { MetricLayouts, MetricKey } from '@/lib/metric-layouts'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string; source?: string }>
}) {
  const cookieStore = await cookies()
  const db          = createAdminClient()
  const params      = await searchParams

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const clientResult = await db.from('clients').select('*').eq('dashboard_token', token).single()
  const client = clientResult.data as Client | null
  if (!client) redirect('/access')

  const toDate   = params.to   ? new Date(params.to)   : new Date()
  const fromDate = params.from ? new Date(params.from)  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const compare  = params.compare ?? 'none'

  const periodMs = toDate.getTime() - fromDate.getTime()
  let priorTo:   Date
  let priorFrom: Date
  if (compare === 'last_year') {
    priorFrom = new Date(fromDate); priorFrom.setFullYear(priorFrom.getFullYear() - 1)
    priorTo   = new Date(toDate);   priorTo.setFullYear(priorTo.getFullYear() - 1)
  } else {
    priorTo   = new Date(fromDate.getTime() - 86400000)
    priorFrom = new Date(priorTo.getTime() - periodMs)
  }
  const showCompare = compare !== 'none'

  const [settings, connectionsRes] = await Promise.all([
    getAgencySettings(),
    db.from('client_connections')
      .select('*, connector:connectors(id, type, label)')
      .eq('client_id', client.id)
      .eq('status', 'active'),
  ])

  const connections = (connectionsRes.data ?? []) as (ClientConnection & {
    connector: Pick<Connector, 'id' | 'type' | 'label'>
  })[]

  const adFuelCut        = client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut
  const availableSources = connections.map(c => c.connector.type)
  const hiddenMetrics    = new Set(client.hidden_metrics ?? [])

  // source param: undefined/"all" = all paid sources, "google_ads"/"meta_ads" = single source
  const source = params.source as string | undefined
  const isFiltered = source === 'google_ads' || source === 'meta_ads'

  const hasGoogle = isFiltered ? source === 'google_ads' : availableSources.includes('google_ads')
  const hasMeta   = isFiltered ? source === 'meta_ads'   : availableSources.includes('meta_ads')
  const hasGhl    = availableSources.includes('ghl')

  // Most recently synced connection (filtered by source if specified)
  const relevantConnections = isFiltered ? connections.filter(c => c.connector.type === source) : connections
  const activeConnection = relevantConnections.reduce<typeof connections[0] | undefined>(
    (best, c) => (!best || (c.last_synced_at ?? '') > (best.last_synced_at ?? '')) ? c : best,
    undefined
  )

  // Connection id lookup per source — used for campaign drill-down links
  const connectionsBySource: Record<string, string> = {}
  for (const conn of connections) {
    if (!connectionsBySource[conn.connector.type]) {
      connectionsBySource[conn.connector.type] = conn.id
    }
  }

  // ─── Data fetching ────────────────────────────────────────────────────────
  const [gRes, mRes, gPriorRes, mPriorRes, gAssignRes, mAssignRes] = await Promise.all([
    hasGoogle
      ? db.from('google_ads_metrics').select('*').eq('client_id', client.id)
          .gte('date', fmtDate(fromDate)).lte('date', fmtDate(toDate))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),

    hasMeta
      ? db.from('meta_ads_metrics').select('*').eq('client_id', client.id)
          .gte('date', fmtDate(fromDate)).lte('date', fmtDate(toDate))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),

    showCompare && hasGoogle
      ? db.from('google_ads_ad_metrics')
          .select('campaign_id,spend,impressions,clicks,conversions,conversions_value,date')
          .eq('client_id', client.id)
          .gte('date', fmtDate(priorFrom)).lte('date', fmtDate(priorTo))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),

    showCompare && hasMeta
      ? db.from('meta_ads_ad_metrics')
          .select('campaign_id,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date')
          .eq('client_id', client.id)
          .gte('date', fmtDate(priorFrom)).lte('date', fmtDate(priorTo))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),

    hasGoogle
      ? db.from('client_campaign_assignments').select('campaign_id, display_mode, hidden')
          .eq('client_id', client.id).eq('source', 'google_ads')
      : Promise.resolve({ data: [] as { campaign_id: string; display_mode: string; hidden: boolean }[] }),

    hasMeta
      ? db.from('client_campaign_assignments').select('campaign_id, display_mode, hidden')
          .eq('client_id', client.id).eq('source', 'meta_ads')
      : Promise.resolve({ data: [] as { campaign_id: string; display_mode: string; hidden: boolean }[] }),
  ])

  const assignmentsData = [
    ...((gAssignRes.data ?? []) as { campaign_id: string; display_mode: string; hidden: boolean }[]),
    ...((mAssignRes.data ?? []) as { campaign_id: string; display_mode: string; hidden: boolean }[]),
  ]
  const assignmentMap = new Map(assignmentsData.map(a => [a.campaign_id, a]))
  const lastSyncedAt  = activeConnection?.last_synced_at ?? null


  const ecomCount  = assignmentsData.filter(a => a.display_mode === 'ecommerce').length
  const leadCount  = assignmentsData.filter(a => a.display_mode !== 'ecommerce').length
  const isEcomDash = client.layout_type === 'ecom' ? true
                   : client.layout_type === 'lead_gen' ? false
                   : ecomCount > leadCount

  // Resolve active metric layout (agency default → client override → built-in)
  const activeLayout = resolveLayout(
    (settings.metric_layouts as MetricLayouts | null | undefined),
    (client.metric_layout_override as MetricLayouts | null | undefined),
    isEcomDash
  )

  // ─── CRM (GHL) data ───────────────────────────────────────────────────────
  let ghlTotals = { contacts: 0, calls: 0, missedCalls: 0, forms: 0, spam: 0, emailsSent: 0, smsSent: 0 }
  if (hasGhl) {
    const { data: ghlRows } = await db.from('ghl_metrics')
      .select('contacts_created,total_calls,missed_calls,forms_submitted,spam_leads,emails_sent,sms_sent')
      .eq('client_id', client.id)
      .gte('date', fmtDate(fromDate))
      .lte('date', fmtDate(toDate))
    for (const r of (ghlRows ?? []) as { contacts_created: number; total_calls: number; missed_calls: number; forms_submitted: number; spam_leads: number; emails_sent: number; sms_sent: number }[]) {
      ghlTotals.contacts    += Number(r.contacts_created) || 0
      ghlTotals.calls       += Number(r.total_calls)      || 0
      ghlTotals.missedCalls += Number(r.missed_calls)     || 0
      ghlTotals.forms       += Number(r.forms_submitted)  || 0
      ghlTotals.spam        += Number(r.spam_leads)       || 0
      ghlTotals.emailsSent  += Number(r.emails_sent)      || 0
      ghlTotals.smsSent     += Number(r.sms_sent)         || 0
    }
  }

  type NormRow = {
    campaign_id: string; campaign_name: string; date: string; _source: string
    campaign_status?: string | null
    spend: number; impressions: number; clicks: number
    daily_budget?: number | null
    conversions: number; conversion_value: number
    roas: number; ctr: number; cpc: number; cpm: number
  }

  function normalise(rows: Record<string, unknown>[], rowSource: string): NormRow[] {
    return rows.map(m => {
      let conversions      = Number(m.conversions) || 0
      let conversion_value = Number(m.conversion_value ?? m.conversions_value ?? 0)

      if (Array.isArray(m.actions)) {
        const campaignIsEcom = (assignmentMap.get(String(m.campaign_id || ''))?.display_mode ?? 'lead_gen') === 'ecommerce'
        const primary = campaignIsEcom
          ? (client!.purchase_action ?? settings.default_purchase_action ?? 'purchase')
          : (client!.lead_action ?? settings.default_lead_action ?? 'onsite_conversion.lead_grouped')
        const fallback = campaignIsEcom
          ? (client!.purchase_action_fallback ?? settings.default_purchase_action_fallback ?? null)
          : (client!.lead_action_fallback ?? settings.default_lead_action_fallback ?? 'lead')
        const resolved = resolveMetaConversions(
          m.actions as MetaAction[],
          (m.action_values as MetaAction[] | null) ?? [],
          primary,
          fallback,
        )
        conversions      = resolved.conversions
        conversion_value = resolved.conversionValue
      }

      return {
        campaign_id:      String(m.campaign_id   || ''),
        campaign_name:    String(m.campaign_name || ''),
        campaign_status:  (m.campaign_status as string | null) ?? null,
        _source:          rowSource,
        date:             String(m.date          || ''),
        spend:            Number(m.spend)         || 0,
        impressions:      Number(m.impressions)   || 0,
        clicks:           Number(m.clicks)        || 0,
        conversions,
        conversion_value,
        roas:             Number(m.roas)  || 0,
        ctr:              Number(m.ctr)   || 0,
        cpc:              Number(m.cpc)   || 0,
        cpm:              Number(m.cpm)   || 0,
        daily_budget:     m.daily_budget != null ? Number(m.daily_budget) : null,
      }
    })
  }

  const currentMetrics = [
    ...normalise((gRes.data  ?? []) as Record<string, unknown>[], 'google_ads'),
    ...normalise((mRes.data  ?? []) as Record<string, unknown>[], 'meta_ads'),
  ]
  const priorMetrics = [
    ...normalise((gPriorRes.data ?? []) as Record<string, unknown>[], 'google_ads'),
    ...normalise((mPriorRes.data ?? []) as Record<string, unknown>[], 'meta_ads'),
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current    = summarizeMetrics(currentMetrics as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prior      = summarizeMetrics(priorMetrics  as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dailyTrend = getDailyTrend(currentMetrics   as any[])

  // ─── Efficiency Score ─────────────────────────────────────────────────────
  const effectiveBenchmarks = {
    benchmark_roas:      client.benchmark_roas      ?? settings.benchmark_roas,
    benchmark_ctr:       client.benchmark_ctr       ?? settings.benchmark_ctr,
    benchmark_cpc:       client.benchmark_cpc       ?? settings.benchmark_cpc,
    benchmark_conv_rate: client.benchmark_conv_rate ?? settings.benchmark_conv_rate,
    benchmark_cpm:       client.benchmark_cpm       ?? settings.benchmark_cpm,
    benchmark_cpl:       client.benchmark_cpl ?? settings.benchmark_cpl ?? 50,
  }
  const convRate = current.clicks > 0 ? current.conversions / current.clicks : 0

  // ─── Benchmark panel ─────────────────────────────────────────────────────
  // enabled_benchmarks: null = not yet configured (fall back to legacy isEcomDash logic)
  //                     string[] = only show listed keys
  const enabledBenchmarks = client.enabled_benchmarks ?? null
  const isBenchmarkEnabled = (key: string) =>
    enabledBenchmarks ? enabledBenchmarks.includes(key) : true

  const showBenchmarkPanel = client.show_benchmarks === true
  const benchmarkRows: { key: string; label: string; actualLabel: string; targetLabel: string; pct: number; color: string }[] = []
  let efficiencyScore = 0

  if (showBenchmarkPanel) {
    if (isBenchmarkEnabled('ctr') && (effectiveBenchmarks.benchmark_ctr ?? 0) > 0) {
      benchmarkRows.push({ key: 'ctr', label: 'CTR', actualLabel: fmtPct(current.ctr), targetLabel: fmtPct(effectiveBenchmarks.benchmark_ctr), pct: pctOfBenchmark(current.ctr, effectiveBenchmarks.benchmark_ctr, false), color: '#3b82f6' })
    }
    if (isBenchmarkEnabled('conv_rate') && (effectiveBenchmarks.benchmark_conv_rate ?? 0) > 0) {
      benchmarkRows.push({ key: 'conv_rate', label: 'Conv. Rate', actualLabel: fmtPct(convRate), targetLabel: fmtPct(effectiveBenchmarks.benchmark_conv_rate), pct: pctOfBenchmark(convRate, effectiveBenchmarks.benchmark_conv_rate, false), color: '#10b981' })
    }
    if (isBenchmarkEnabled('cpc') && (effectiveBenchmarks.benchmark_cpc ?? 0) > 0 && current.cpc > 0) {
      benchmarkRows.push({ key: 'cpc', label: 'Avg. CPC', actualLabel: fmtCurrency(current.cpc), targetLabel: fmtCurrency(effectiveBenchmarks.benchmark_cpc), pct: pctOfBenchmark(current.cpc, effectiveBenchmarks.benchmark_cpc, true), color: '#f59e0b' })
    }
    if (isBenchmarkEnabled('cpm') && (effectiveBenchmarks.benchmark_cpm ?? 0) > 0 && current.cpm > 0) {
      benchmarkRows.push({ key: 'cpm', label: 'CPM', actualLabel: fmtCurrency(current.cpm), targetLabel: fmtCurrency(effectiveBenchmarks.benchmark_cpm), pct: pctOfBenchmark(current.cpm, effectiveBenchmarks.benchmark_cpm, true), color: '#f59e0b' })
    }
    // ROAS: show when explicitly enabled, or fall back to isEcomDash when not yet configured
    const showRoas = enabledBenchmarks ? enabledBenchmarks.includes('roas') : isEcomDash
    if (showRoas && (effectiveBenchmarks.benchmark_roas ?? 0) > 0) {
      benchmarkRows.push({ key: 'roas', label: 'ROAS', actualLabel: fmtRoas(current.roas), targetLabel: `${effectiveBenchmarks.benchmark_roas.toFixed(1)}x`, pct: pctOfBenchmark(current.roas, effectiveBenchmarks.benchmark_roas, false), color: '#8b5cf6' })
    }
    // CPL: show when explicitly enabled, or fall back to !isEcomDash when not yet configured
    const cpl = current.conversions > 0 ? current.spend / current.conversions : 0
    const showCpl = enabledBenchmarks ? enabledBenchmarks.includes('cpl') : !isEcomDash
    if (showCpl && (effectiveBenchmarks.benchmark_cpl ?? 0) > 0 && cpl > 0) {
      benchmarkRows.push({ key: 'cpl', label: 'CPL', actualLabel: fmtCurrency(cpl), targetLabel: fmtCurrency(effectiveBenchmarks.benchmark_cpl), pct: pctOfBenchmark(cpl, effectiveBenchmarks.benchmark_cpl, true), color: '#ec4899' })
    }
    if (benchmarkRows.length > 0) {
      efficiencyScore = Math.min(100, Math.round(benchmarkRows.reduce((s, r) => s + r.pct, 0) / benchmarkRows.length))
    }
  }

  // ─── Campaign map ─────────────────────────────────────────────────────────
  const campMap = new Map<string, {
    name: string; spend: number; impressions: number; clicks: number
    conversions: number; conversionValue: number; display_mode: string; _source: string
    status?: string | null; daily_budget?: number | null
  }>()
  for (const row of currentMetrics) {
    const assignment = assignmentMap.get(row.campaign_id)
    if (assignment?.hidden) continue
    const mode = assignment?.display_mode ?? 'lead_gen'
    const ex   = campMap.get(row.campaign_id)
    if (ex) {
      ex.spend           += row.spend
      ex.impressions     += row.impressions
      ex.clicks          += row.clicks
      ex.conversions     += row.conversions
      ex.conversionValue += row.conversion_value
      if (row.daily_budget != null && (ex.daily_budget == null || row.daily_budget > ex.daily_budget)) {
        ex.daily_budget = row.daily_budget
      }
    } else {
      campMap.set(row.campaign_id, {
        name: row.campaign_name, spend: row.spend, impressions: row.impressions,
        clicks: row.clicks, conversions: row.conversions, conversionValue: row.conversion_value,
        display_mode: mode, _source: row._source, status: row.campaign_status,
        daily_budget: row.daily_budget ?? null,
      })
    }
  }

  const activeCampaigns = Array.from(campMap.entries())
    .map(([id, c]) => {
      const cost = adFuelCut > 0 ? applyAdFuel(c.spend, adFuelCut) : c.spend
      return {
        campaign_id:     id,
        campaign_name:   c.name,
        source:          c._source as never,
        status:          c.status ?? null,
        spend:           cost,
        impressions:     c.impressions,
        clicks:          c.clicks,
        conversions:     c.conversions,
        conversionValue: c.conversionValue,
        ctr:             c.impressions > 0 ? c.clicks / c.impressions : 0,
        convRate:        c.clicks > 0 ? c.conversions / c.clicks : 0,
        cpl:             c.conversions > 0 ? cost / c.conversions : 0,
        display_mode:    c.display_mode,
        daily_budget:    c.daily_budget ?? null,
      }
    })
    .sort((a, b) => b.spend - a.spend)

  const campaigns = activeCampaigns

  const syncedAt = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  // ─── Daily sparklines ──────────────────────────────────────────────────────
  const dailyMap = new Map<string, { spend: number; clicks: number; impressions: number; conversions: number; conversion_value: number }>()
  for (const r of currentMetrics) {
    const ex = dailyMap.get(r.date)
    if (ex) {
      ex.spend += r.spend; ex.clicks += r.clicks; ex.impressions += r.impressions
      ex.conversions += r.conversions; ex.conversion_value += r.conversion_value
    } else {
      dailyMap.set(r.date, { spend: r.spend, clicks: r.clicks, impressions: r.impressions, conversions: r.conversions, conversion_value: r.conversion_value })
    }
  }
  const ds = Array.from(dailyMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
  const spendSpark     = ds.map(d => ({ v: adFuelCut > 0 ? applyAdFuel(d.spend, adFuelCut) : d.spend }))
  const convSpark      = ds.map(d => ({ v: d.conversions }))
  const convValueSpark = ds.map(d => ({ v: d.conversion_value }))
  const cplSpark       = ds.map(d => ({ v: d.conversions > 0 ? (adFuelCut > 0 ? applyAdFuel(d.spend, adFuelCut) : d.spend) / d.conversions : 0 }))
  const roasSpark      = ds.map(d => { const s = adFuelCut > 0 ? applyAdFuel(d.spend, adFuelCut) : d.spend; return { v: s > 0 ? d.conversion_value / s : 0 } })
  const ctrSpark       = ds.map(d => ({ v: d.impressions > 0 ? d.clicks / d.impressions : 0 }))
  const cpmSpark       = ds.map(d => ({ v: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0 }))
  const crSpark        = ds.map(d => ({ v: d.clicks > 0 ? d.conversions / d.clicks : 0 }))

  // ─── Per-source totals for platform cards (overview mode) ────────────────
  let googleTotal = { spend: 0, conversions: 0, clicks: 0, impressions: 0, convValue: 0 }
  for (const row of (gRes.data ?? []) as Record<string, unknown>[]) {
    googleTotal.spend       += Number(row.spend) || 0
    googleTotal.conversions += Number(row.conversions) || 0
    googleTotal.clicks      += Number(row.clicks) || 0
    googleTotal.impressions += Number(row.impressions) || 0
    googleTotal.convValue   += Number(row.conversions_value) || 0
  }
  let metaTotal = { spend: 0, conversions: 0, clicks: 0, impressions: 0, convValue: 0, reach: 0, frequency: 0 }
  for (const row of (mRes.data ?? []) as Record<string, unknown>[]) {
    metaTotal.spend       += Number(row.spend)            || 0
    metaTotal.impressions += Number(row.impressions)      || 0
    metaTotal.clicks      += Number(row.clicks)           || 0
    metaTotal.conversions += Number(row.conversions)      || 0
    metaTotal.convValue   += Number(row.conversion_value) || 0
    metaTotal.reach       += Number(row.reach)            || 0
    metaTotal.frequency   += Number(row.frequency)        || 0
  }

  // ─── Platform card value maps (for layout-driven metric display) ─────────
  const gSpend = adFuelCut > 0 ? applyAdFuel(googleTotal.spend, adFuelCut) : googleTotal.spend
  const mSpend = adFuelCut > 0 ? applyAdFuel(metaTotal.spend, adFuelCut) : metaTotal.spend
  const googleCardMap: Record<string, string> = {
    spend:       fmt$(gSpend),
    conversions: googleTotal.conversions > 0 ? fmtNum(googleTotal.conversions) : '—',
    revenue:     googleTotal.convValue > 0 ? fmt$(googleTotal.convValue) : '—',
    clicks:      googleTotal.clicks > 0 ? fmtNum(googleTotal.clicks) : '—',
    impressions: googleTotal.impressions > 0 ? fmtNum(googleTotal.impressions) : '—',
    ctr:         googleTotal.impressions > 0 ? fmtPct(googleTotal.clicks / googleTotal.impressions) : '—',
    cpa:         googleTotal.conversions > 0 ? fmtCurrency(gSpend / googleTotal.conversions) : '—',
    roas:        gSpend > 0 && googleTotal.convValue > 0 ? fmtRoas(googleTotal.convValue / gSpend) : '—',
    cpm:         googleTotal.impressions > 0 ? fmtCurrency((gSpend / googleTotal.impressions) * 1000) : '—',
    cpc:         googleTotal.clicks > 0 ? fmtCurrency(gSpend / googleTotal.clicks) : '—',
    reach:       '—',
    frequency:   '—',
  }
  const metaCardMap: Record<string, string> = {
    spend:       fmt$(mSpend),
    impressions: fmtNum(metaTotal.impressions),
    clicks:      fmtNum(metaTotal.clicks),
    ctr:         metaTotal.impressions > 0 ? fmtPct(metaTotal.clicks / metaTotal.impressions) : '—',
    conversions: metaTotal.conversions > 0 ? fmtNum(metaTotal.conversions) : '—',
    revenue:     metaTotal.convValue > 0 ? fmt$(metaTotal.convValue) : '—',
    cpa:         metaTotal.conversions > 0 ? fmtCurrency(mSpend / metaTotal.conversions) : '—',
    roas:        mSpend > 0 && metaTotal.convValue > 0 ? fmtRoas(metaTotal.convValue / mSpend) : '—',
    cpm:         metaTotal.impressions > 0 ? fmtCurrency((mSpend / metaTotal.impressions) * 1000) : '—',
    cpc:         metaTotal.clicks > 0 ? fmtCurrency(mSpend / metaTotal.clicks) : '—',
    reach:       metaTotal.reach > 0 ? fmtNum(metaTotal.reach) : '—',
    frequency:   metaTotal.frequency > 0 ? metaTotal.frequency.toFixed(2) : '—',
  }

  // ─── Empty state — no connections ────────────────────────────────────────
  if (connections.length === 0) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <main className="max-w-7xl mx-auto px-6 py-6">
          <div className="card p-12 text-center mt-4">
            <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Your dashboard is being set up</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Your account manager will connect your ad accounts shortly.</p>
          </div>
        </main>
      </div>
    )
  }

  // Metric value map — drives layout-based KPI and top metric rendering
  type MetricCardDef = { value: string; sparkData?: {v:number}[]; delta?: number; invertDelta?: boolean; sparkColor?: string }
  const metricValMap: Record<string, MetricCardDef> = {
    spend:       { value: fmt$(adFuelCut > 0 ? applyAdFuel(current.spend, adFuelCut) : current.spend), sparkData: spendSpark, delta: showCompare ? calcDelta(current.spend, prior.spend) : undefined, invertDelta: true, sparkColor: settings.chart_color_spend ?? '#93c5fd' },
    leads:       isEcomDash
                   ? { value: fmt$(current.conversionValue), sparkData: convValueSpark, delta: showCompare ? calcDelta(current.conversionValue, prior.conversionValue) : undefined, sparkColor: '#10b981' }
                   : { value: fmtNum(current.conversions), sparkData: convSpark, delta: showCompare ? calcDelta(current.conversions, prior.conversions) : undefined, sparkColor: '#10b981' },
    conversions: { value: fmtNum(current.conversions), sparkData: convSpark, delta: showCompare ? calcDelta(current.conversions, prior.conversions) : undefined, sparkColor: settings.chart_color_conversions ?? '#10b981' },
    revenue:     { value: fmt$(current.conversionValue), sparkData: convValueSpark, delta: showCompare ? calcDelta(current.conversionValue, prior.conversionValue) : undefined, sparkColor: '#10b981' },
    roas:        { value: fmtRoas(current.roas), sparkData: roasSpark, delta: showCompare ? calcDelta(current.roas, prior.roas) : undefined, sparkColor: '#8b5cf6' },
    cpa:         { value: current.cpl > 0 ? fmtCurrency(current.cpl) : '—', sparkData: cplSpark, delta: showCompare ? calcDelta(current.cpl, prior.cpl) : undefined, invertDelta: true, sparkColor: '#f59e0b' },
    ctr:         { value: fmtPct(current.ctr), sparkData: ctrSpark, delta: showCompare ? calcDelta(current.ctr, prior.ctr) : undefined, sparkColor: '#3b82f6' },
    conv_rate:   { value: fmtPct(convRate), sparkData: crSpark, delta: showCompare ? calcDelta(convRate, prior.clicks > 0 ? prior.conversions / prior.clicks : 0) : undefined, sparkColor: '#10b981' },
    cpm:         { value: fmtCurrency(current.cpm), sparkData: cpmSpark, delta: showCompare ? calcDelta(current.cpm, prior.cpm) : undefined, invertDelta: true, sparkColor: '#f59e0b' },
    cpc:         { value: current.cpc > 0 ? fmtCurrency(current.cpc) : '—', sparkData: ds.map(d => ({ v: d.clicks > 0 ? d.spend / d.clicks : 0 })), delta: showCompare ? calcDelta(current.cpc, prior.cpc) : undefined, invertDelta: true, sparkColor: '#f59e0b' },
    impressions: { value: fmtNum(current.impressions), sparkData: ds.map(d => ({ v: d.impressions })), delta: showCompare ? calcDelta(current.impressions, prior.impressions) : undefined, sparkColor: '#6366f1' },
    clicks:      { value: fmtNum(current.clicks), sparkData: ds.map(d => ({ v: d.clicks })), delta: showCompare ? calcDelta(current.clicks, prior.clicks) : undefined, sparkColor: '#6366f1' },
    reach:       { value: fmtNum(current.reach ?? 0), sparkData: ds.map(d => ({ v: (d as Record<string, unknown>).reach as number ?? 0 })), delta: showCompare ? calcDelta(current.reach ?? 0, prior.reach ?? 0) : undefined, sparkColor: '#06b6d4' },
    frequency:   { value: (current.frequency ?? 0).toFixed(2), sparkData: ds.map(d => ({ v: (d as Record<string, unknown>).frequency as number ?? 0 })), delta: showCompare ? calcDelta(current.frequency ?? 0, prior.frequency ?? 0) : undefined, sparkColor: '#f97316' },
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <style>{`.back-overview-link:hover { color: var(--text-primary) !important; }`}</style>
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* ── Inline page header ───────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            {isFiltered && (
              <a href="/dashboard" className="back-overview-link" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                ← Overview
              </a>
            )}
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {isFiltered
                ? (source === 'google_ads' ? 'Google Ads Summary' : source === 'meta_ads' ? 'Meta Ads Summary' : 'Paid Ads Summary')
                : 'Summary'}
            </h1>
            {syncedAt && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', margin: '3px 0 0' }}>Updated {syncedAt}</p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <ExportButtons
                clientId={client.id}
                from={fromDate.toISOString().split('T')[0]}
                to={toDate.toISOString().split('T')[0]}
                compare={compare}
              />
            <Suspense fallback={null}>
              <DateRangePicker
                from={fromDate.toISOString().split('T')[0]}
                to={toDate.toISOString().split('T')[0]}
                compare={compare}
              />
            </Suspense>
          </div>
        </div>

        {/* ── No-data notice (subtle, does not replace KPI grid) ── */}
        {currentMetrics.length === 0 && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginBottom: 4 }}>
            No data for this period — showing zeroed stats
          </p>
        )}

        <>
            {/* ── Paid Advertising section label (overview only) ────────────── */}
            {!isFiltered && (hasGoogle || hasMeta) && (
              <div>
                <h2 className="section-title">Paid Advertising</h2>
                <p className="section-desc">Performance across all paid channels</p>
              </div>
            )}

            {/* ── KPI cards (sparklines) — driven by activeLayout.kpi_cards ─── */}
            <div className={`grid grid-cols-2 lg:grid-cols-${activeLayout.kpi_cards.length || 3} gap-4`}>
              {activeLayout.kpi_cards.map((key, i) => {
                const m = metricValMap[key]
                if (!m) return null
                return (
                  <SparkMetricCard
                    key={key}
                    label={METRIC_LABELS[key as MetricKey] ?? key}
                    value={m.value}
                    sparkData={m.sparkData}
                    delta={m.delta}
                    invertDelta={m.invertDelta}
                    sparkColor={m.sparkColor}
                    delay={i}
                  />
                )
              })}
            </div>

            {/* ── Top metrics (compact, no sparkline) — driven by activeLayout.top_metrics ─── */}
            {activeLayout.top_metrics.length > 0 && (
              <div className={`grid grid-cols-2 lg:grid-cols-${activeLayout.top_metrics.length} gap-4`}>
                {activeLayout.top_metrics.map(key => {
                  const m = metricValMap[key]
                  if (!m) return null
                  const isGood = m.delta !== undefined ? (m.invertDelta ? m.delta <= 0 : m.delta >= 0) : null
                  return (
                    <div key={key} className="card" style={{ padding: '1rem 1.25rem' }}>
                      <p className="metric-label" style={{ marginBottom: '0.25rem' }}>{METRIC_LABELS[key as MetricKey] ?? key}</p>
                      <p className="metric-value" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>{m.value}</p>
                      {m.delta !== undefined && m.delta !== 0 && (
                        <p style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: 2, color: isGood ? 'var(--green)' : 'var(--red)' }}>
                          {m.delta > 0 ? '▲' : '▼'} {Math.abs(m.delta).toFixed(1)}%
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Daily Performance chart ───────────────────────────── */}
            {!hiddenMetrics.has('daily_chart') && (
              <div className="card p-6">
                <div className="mb-4">
                  <h2 className="section-title">Daily Performance</h2>
                  <p className="section-desc">
                    {fmtDate(fromDate)} – {fmtDate(toDate)}
                    {showCompare && <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>vs {fmtDate(priorFrom)} – {fmtDate(priorTo)}</span>}
                  </p>
                </div>
                <SpendChart
                  data={dailyTrend}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  priorData={showCompare ? getDailyTrend(priorMetrics as any[]) : undefined}
                  colorSpend={settings.chart_color_spend}
                  colorPriorSpend={settings.chart_color_prior_spend}
                  colorConversions={settings.chart_color_conversions}
                  colorPriorConversions={settings.chart_color_prior_conversions}
                />
              </div>
            )}

            {/* ── Performance Benchmarks ──────────────────────────── */}
            {showBenchmarkPanel && benchmarkRows.length > 0 && (
              <div className="card p-6">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 28 }}>
                  {/* Circle meter */}
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <svg width="96" height="96" viewBox="0 0 100 100" style={{ overflow: 'visible' }}>
                      <circle cx="50" cy="50" r="38" fill="none" stroke="var(--bg-subtle)" strokeWidth="8" />
                      <circle
                        cx="50" cy="50" r="38" fill="none"
                        stroke={scoreColor(efficiencyScore)}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${(efficiencyScore / 100) * 238.76} 238.76`}
                        transform="rotate(-90 50 50)"
                        style={{ transition: 'stroke-dasharray 0.6s ease' }}
                      />
                      <text x="50" y="47" textAnchor="middle" style={{ fontSize: '20px', fontWeight: 700 }} fill="var(--text-primary)">{efficiencyScore}</text>
                      <text x="50" y="61" textAnchor="middle" style={{ fontSize: '8px', letterSpacing: '0.08em' }} fill="var(--text-faint)">SCORE</text>
                    </svg>
                  </div>
                  {/* Metric rows */}
                  <div style={{ flex: 1 }}>
                    <h2 className="section-title">Performance vs Benchmarks</h2>
                    <p className="section-desc" style={{ marginBottom: 16 }}>Tracking against your targets this period</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {benchmarkRows.map(row => (
                        <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: 96, flexShrink: 0 }}>{row.label}</span>
                          <div style={{ flex: 1, height: 6, borderRadius: 9999, background: 'var(--bg-subtle)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 9999, width: `${Math.min(100, row.pct)}%`, background: row.color, transition: 'width 0.5s ease' }} />
                          </div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>{row.actualLabel}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)', flexShrink: 0, minWidth: 72, textAlign: 'right' }}>/ {row.targetLabel}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Platform cards (overview mode) ───────────────────── */}
            {!isFiltered && (hasGoogle || hasMeta) && (
              <div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {hasGoogle && (
                    <a href="?source=google_ads" style={{ textDecoration: 'none' }}>
                      <div className="card p-5 card-hover" style={{ cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ConnectorLogo type="google_ads" size={22} aria-hidden />
                            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Google Ads</span>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--blue)' }}>View campaigns →</span>
                        </div>
                        {(() => {
                          const keys = activeLayout.platform_google_metrics ?? ['spend', 'conversions', 'ctr']
                          return (
                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${keys.length}, 1fr)`, gap: 8 }}>
                              {keys.map(k => (
                                <div key={k}>
                                  <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 2 }}>{PLATFORM_CARD_LABELS[k as keyof typeof PLATFORM_CARD_LABELS] ?? k}</p>
                                  <p style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{googleCardMap[k] ?? '—'}</p>
                                </div>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    </a>
                  )}
                  {hasMeta && (
                    <a href="?source=meta_ads" style={{ textDecoration: 'none' }}>
                      <div className="card p-5 card-hover" style={{ cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ConnectorLogo type="meta_ads" size={22} aria-hidden />
                            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Meta Ads</span>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--blue)' }}>View campaigns →</span>
                        </div>
                        {(() => {
                          const keys = activeLayout.platform_meta_metrics ?? ['spend', 'impressions', 'ctr']
                          return (
                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${keys.length}, 1fr)`, gap: 8 }}>
                              {keys.map(k => (
                                <div key={k}>
                                  <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 2 }}>{PLATFORM_CARD_LABELS[k as keyof typeof PLATFORM_CARD_LABELS] ?? k}</p>
                                  <p style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{metaCardMap[k] ?? '—'}</p>
                                </div>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* ── Campaign breakdown (filtered mode only) ───────────── */}
            {isFiltered && !hiddenMetrics.has('campaigns') && (
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="section-title">Campaigns</h2>
                    <p className="section-desc">{campaigns.length} campaigns</p>
                  </div>
                </div>
                <CampaignTable
                  campaigns={campaigns}
                  connectionsBySource={connectionsBySource}
                  dateFrom={fmtDate(fromDate)}
                  dateTo={fmtDate(toDate)}
                  compare={compare !== 'none' ? compare : undefined}
                  columns={activeLayout.table_columns}
                />
              </div>
            )}

            {/* ── CRM Activity (GoHighLevel) ───────────────────────── */}
            {hasGhl && ghlTotals.contacts + ghlTotals.calls + ghlTotals.forms > 0 && (
              <div className="card p-6">
                <div className="mb-4">
                  <h2 className="section-title">CRM Activity</h2>
                  <p className="section-desc">GoHighLevel data for {fmtDate(fromDate)} – {fmtDate(toDate)}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  <div className="card p-4" style={{ background: 'var(--bg-base)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>New Contacts</p>
                    <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtNum(ghlTotals.contacts)}</p>
                    {ghlTotals.spam > 0 && <p className="text-xs mt-0.5" style={{ color: 'var(--red)' }}>{ghlTotals.spam} spam</p>}
                  </div>
                  <div className="card p-4" style={{ background: 'var(--bg-base)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>Total Calls</p>
                    <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtNum(ghlTotals.calls)}</p>
                    {ghlTotals.missedCalls > 0 && <p className="text-xs mt-0.5" style={{ color: 'var(--amber, #f59e0b)' }}>{ghlTotals.missedCalls} missed</p>}
                  </div>
                  <div className="card p-4" style={{ background: 'var(--bg-base)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>Forms Submitted</p>
                    <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtNum(ghlTotals.forms)}</p>
                  </div>
                  {(ghlTotals.emailsSent > 0 || ghlTotals.smsSent > 0) && (
                    <div className="card p-4" style={{ background: 'var(--bg-base)' }}>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>Outreach</p>
                      <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fmtNum(ghlTotals.emailsSent + ghlTotals.smsSent)}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{ghlTotals.emailsSent} emails · {ghlTotals.smsSent} SMS</p>
                    </div>
                  )}
                </div>
              </div>
            )}
        </>

        {/* ── Connection summary cards (summary / overview only) ── */}
        {!isFiltered && (
          <>
            {/* Analytics — GA4 */}
            {availableSources.includes('google_analytics') && connectionsBySource['google_analytics'] && (
              <>
                <div>
                  <h2 className="section-title">Analytics</h2>
                  <p className="section-desc">Sessions, users, and engagement from Google Analytics</p>
                </div>
                <GA4SummaryCard
                  clientId={client.id}
                  connectionId={connectionsBySource['google_analytics']}
                  dateFrom={fmtDate(fromDate)}
                  dateTo={fmtDate(toDate)}
                  compareDateFrom={showCompare ? fmtDate(priorFrom) : undefined}
                  compareDateTo={showCompare ? fmtDate(priorTo) : undefined}
                />
              </>
            )}

            {/* SEO — Search Console, Business Profile, Ahrefs (grouped together) */}
            {(
              (availableSources.includes('google_search_console') && connectionsBySource['google_search_console']) ||
              (availableSources.includes('google_business_profile') && connectionsBySource['google_business_profile']) ||
              (availableSources as string[]).includes('ahrefs')
            ) && (
              <div>
                <h2 className="section-title">SEO</h2>
                <p className="section-desc">Organic search, local visibility, and domain authority</p>
              </div>
            )}
            {availableSources.includes('google_search_console') && connectionsBySource['google_search_console'] && (
              <GSCSummaryCard
                clientId={client.id}
                connectionId={connectionsBySource['google_search_console']}
                dateFrom={fmtDate(fromDate)}
                dateTo={fmtDate(toDate)}
                compareDateFrom={showCompare ? fmtDate(priorFrom) : undefined}
                compareDateTo={showCompare ? fmtDate(priorTo) : undefined}
              />
            )}
            {availableSources.includes('google_business_profile') && connectionsBySource['google_business_profile'] && (
              <GBPSummaryCard
                clientId={client.id}
                connectionId={connectionsBySource['google_business_profile']}
                dateFrom={fmtDate(fromDate)}
                dateTo={fmtDate(toDate)}
              />
            )}
            {(availableSources as string[]).includes('ahrefs') && (
              <AhrefsSummaryCard
                clientId={client.id}
                dateFrom={fmtDate(fromDate)}
                dateTo={fmtDate(toDate)}
                compareDateFrom={showCompare ? fmtDate(priorFrom) : undefined}
                compareDateTo={showCompare ? fmtDate(priorTo) : undefined}
              />
            )}
          </>
        )}

      </main>
    </div>
  )
}
