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
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'

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
  const isEcomDash = ecomCount > leadCount

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
  }
  const convRate = current.clicks > 0 ? current.conversions / current.clicks : 0

  // ─── Benchmark panel ─────────────────────────────────────────────────────
  const showBenchmarkPanel = client.show_benchmarks === true
  const benchmarkRows: { key: string; label: string; actualLabel: string; targetLabel: string; pct: number; color: string }[] = []
  let efficiencyScore = 0

  if (showBenchmarkPanel) {
    if (!hiddenMetrics.has('ctr') && (effectiveBenchmarks.benchmark_ctr ?? 0) > 0) {
      benchmarkRows.push({ key: 'ctr', label: 'CTR', actualLabel: fmtPct(current.ctr), targetLabel: fmtPct(effectiveBenchmarks.benchmark_ctr), pct: pctOfBenchmark(current.ctr, effectiveBenchmarks.benchmark_ctr, false), color: '#3b82f6' })
    }
    if (!hiddenMetrics.has('conv_rate') && (effectiveBenchmarks.benchmark_conv_rate ?? 0) > 0) {
      benchmarkRows.push({ key: 'conv_rate', label: 'Conv. Rate', actualLabel: fmtPct(convRate), targetLabel: fmtPct(effectiveBenchmarks.benchmark_conv_rate), pct: pctOfBenchmark(convRate, effectiveBenchmarks.benchmark_conv_rate, false), color: '#10b981' })
    }
    if (!hiddenMetrics.has('cpc') && (effectiveBenchmarks.benchmark_cpc ?? 0) > 0 && current.cpc > 0) {
      benchmarkRows.push({ key: 'cpc', label: 'Avg. CPC', actualLabel: fmtCurrency(current.cpc), targetLabel: fmtCurrency(effectiveBenchmarks.benchmark_cpc), pct: pctOfBenchmark(current.cpc, effectiveBenchmarks.benchmark_cpc, true), color: '#f59e0b' })
    }
    if (!hiddenMetrics.has('cpm') && (effectiveBenchmarks.benchmark_cpm ?? 0) > 0 && current.cpm > 0) {
      benchmarkRows.push({ key: 'cpm', label: 'CPM', actualLabel: fmtCurrency(current.cpm), targetLabel: fmtCurrency(effectiveBenchmarks.benchmark_cpm), pct: pctOfBenchmark(current.cpm, effectiveBenchmarks.benchmark_cpm, true), color: '#f59e0b' })
    }
    if (isEcomDash && !hiddenMetrics.has('roas') && (effectiveBenchmarks.benchmark_roas ?? 0) > 0) {
      benchmarkRows.push({ key: 'roas', label: 'ROAS', actualLabel: fmtRoas(current.roas), targetLabel: `${effectiveBenchmarks.benchmark_roas.toFixed(1)}x`, pct: pctOfBenchmark(current.roas, effectiveBenchmarks.benchmark_roas, false), color: '#8b5cf6' })
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

  const campaigns = Array.from(campMap.entries())
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

  // ─── Keyword highlights (Google Ads only, across all campaigns) ───────────
  type KwHighlightRow = { keyword_text: string; match_type: string | null; spend: number; impressions: number; clicks: number; conversions: number }
  const kwHighlightMap = new Map<string, { matchType: string | null; spend: number; impressions: number; clicks: number; conversions: number }>()
  if (hasGoogle && !isFiltered || (isFiltered && source === 'google_ads')) {
    const { data: kwData } = await db
      .from('google_ads_keywords')
      .select('keyword_text,match_type,spend,impressions,clicks,conversions')
      .eq('client_id', client.id)
      .gte('date', fmtDate(fromDate))
      .lte('date', fmtDate(toDate))
    for (const kw of (kwData ?? []) as KwHighlightRow[]) {
      const key = kw.keyword_text
      const ex  = kwHighlightMap.get(key)
      if (ex) {
        ex.spend += Number(kw.spend)||0; ex.impressions += Number(kw.impressions)||0
        ex.clicks += Number(kw.clicks)||0; ex.conversions += Number(kw.conversions)||0
      } else {
        kwHighlightMap.set(key, { matchType: kw.match_type ?? null, spend: Number(kw.spend)||0, impressions: Number(kw.impressions)||0, clicks: Number(kw.clicks)||0, conversions: Number(kw.conversions)||0 })
      }
    }
  }

  // Highlights: top 6 by conversions; Lowlights: worst 3 by CPL (must have ≥1 conversion)
  const allKwData = Array.from(kwHighlightMap.entries()).map(([text, k]) => {
    const dSpend = adFuelCut > 0 ? applyAdFuel(k.spend, adFuelCut) : k.spend
    return { text, matchType: k.matchType, conversions: k.conversions, clicks: k.clicks, impressions: k.impressions, spend: dSpend, ctr: k.impressions > 0 ? k.clicks / k.impressions : 0, cpl: k.conversions > 0 ? dSpend / k.conversions : 0 }
  })
  const kwHighlights = allKwData.slice().sort((a, b) => b.conversions - a.conversions).slice(0, 6)
  const kwLowlights  = allKwData.filter(k => k.conversions >= 1).sort((a, b) => b.cpl - a.cpl).slice(0, 3)
  const showKwHighlights = kwHighlights.length > 0

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

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* ── Inline page header ───────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {source === 'google_ads' ? 'Google Ads' : source === 'meta_ads' ? 'Meta Ads' : 'Summary'}
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
            {/* ── Hero KPI cards ───────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {!hiddenMetrics.has('spend') && (
                <SparkMetricCard
                  label="Total Cost"
                  value={fmt$(adFuelCut > 0 ? applyAdFuel(current.spend, adFuelCut) : current.spend)}
                  delta={showCompare ? calcDelta(current.spend, prior.spend) : undefined}
                  invertDelta sparkData={spendSpark} sparkColor={settings.chart_color_spend ?? '#93c5fd'} delay={0}
                />
              )}
              {!hiddenMetrics.has('leads') && (isEcomDash ? (
                <SparkMetricCard label="Revenue" value={fmt$(current.conversionValue)}
                  delta={showCompare ? calcDelta(current.conversionValue, prior.conversionValue) : undefined}
                  sparkData={convValueSpark} sparkColor="#10b981" delay={1} />
              ) : (
                <SparkMetricCard label="Leads" value={fmtNum(current.conversions)}
                  delta={showCompare ? calcDelta(current.conversions, prior.conversions) : undefined}
                  sparkData={convSpark} sparkColor="#10b981" delay={1} />
              ))}
              {!hiddenMetrics.has('cpl') && (isEcomDash ? (
                <SparkMetricCard label="ROAS" value={fmtRoas(current.roas)}
                  delta={showCompare ? calcDelta(current.roas, prior.roas) : undefined}
                  sparkData={roasSpark} sparkColor="#8b5cf6" delay={2} />
              ) : (
                <SparkMetricCard label="Cost Per Lead" value={current.cpl > 0 ? fmtCurrency(current.cpl) : '—'}
                  delta={showCompare ? calcDelta(current.cpl, prior.cpl) : undefined}
                  invertDelta sparkData={cplSpark} sparkColor="#f59e0b" delay={2} />
              ))}
              {!hiddenMetrics.has('ctr') && (
                <SparkMetricCard label="CTR" value={fmtPct(current.ctr)}
                  delta={showCompare ? calcDelta(current.ctr, prior.ctr) : undefined}
                  sparkData={ctrSpark} sparkColor="#3b82f6" delay={3} />
              )}
            </div>

            {/* ── Additional metric cards ───────────────────────────── */}
            {(
              !hiddenMetrics.has('conv_rate') ||
              !hiddenMetrics.has('cpm') ||
              !hiddenMetrics.has('conversions') ||
              !hiddenMetrics.has('impressions') ||
              !hiddenMetrics.has('cpc') ||
              (!hiddenMetrics.has('conversion_value') && isEcomDash) ||
              (!hiddenMetrics.has('roas') && isEcomDash) ||
              (!hiddenMetrics.has('reach') && (current.reach ?? 0) > 0) ||
              (!hiddenMetrics.has('frequency') && (current.frequency ?? 0) > 0)
            ) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {!hiddenMetrics.has('conv_rate') && (
                  <SparkMetricCard label="Conv. Rate" value={fmtPct(convRate)}
                    delta={showCompare ? calcDelta(convRate, prior.clicks > 0 ? prior.conversions / prior.clicks : 0) : undefined}
                    sparkData={crSpark} sparkColor="#10b981" delay={4} />
                )}
                {!hiddenMetrics.has('cpm') && (
                  <SparkMetricCard label="CPM" value={fmtCurrency(current.cpm)}
                    delta={showCompare ? calcDelta(current.cpm, prior.cpm) : undefined}
                    invertDelta sparkData={cpmSpark} sparkColor="#f59e0b" delay={5} />
                )}
                {!hiddenMetrics.has('conversions') && (
                  <SparkMetricCard label="Conversions" value={fmtNum(current.conversions)}
                    delta={showCompare ? calcDelta(current.conversions, prior.conversions) : undefined}
                    sparkData={convSpark} sparkColor={settings.chart_color_conversions ?? '#10b981'} delay={6} />
                )}
                {!hiddenMetrics.has('conversion_value') && isEcomDash && (
                  <SparkMetricCard label="Conv. Value" value={fmt$(current.conversionValue)}
                    delta={showCompare ? calcDelta(current.conversionValue, prior.conversionValue) : undefined}
                    sparkData={convValueSpark} sparkColor="#8b5cf6" delay={7} />
                )}
                {!hiddenMetrics.has('roas') && isEcomDash && (
                  <SparkMetricCard label="ROAS" value={fmtRoas(current.roas)}
                    delta={showCompare ? calcDelta(current.roas, prior.roas) : undefined}
                    sparkData={roasSpark} sparkColor="#8b5cf6" delay={8} />
                )}
                {!hiddenMetrics.has('impressions') && (
                  <SparkMetricCard label="Impressions" value={fmtNum(current.impressions)}
                    delta={showCompare ? calcDelta(current.impressions, prior.impressions) : undefined}
                    sparkData={ds.map(d => ({ v: d.impressions }))} sparkColor="#6366f1" delay={9} />
                )}
                {!hiddenMetrics.has('cpc') && (
                  <SparkMetricCard label="Avg. CPC" value={current.cpc > 0 ? fmtCurrency(current.cpc) : '—'}
                    delta={showCompare ? calcDelta(current.cpc, prior.cpc) : undefined}
                    invertDelta sparkData={ds.map(d => ({ v: d.clicks > 0 ? d.spend / d.clicks : 0 }))} sparkColor="#f59e0b" delay={10} />
                )}
                {!hiddenMetrics.has('reach') && (current.reach ?? 0) > 0 && (
                  <SparkMetricCard label="Reach" value={fmtNum(current.reach ?? 0)}
                    delta={showCompare ? calcDelta(current.reach ?? 0, prior.reach ?? 0) : undefined}
                    sparkData={ds.map(d => ({ v: (d as Record<string, unknown>).reach as number ?? 0 }))} sparkColor="#06b6d4" delay={11} />
                )}
                {!hiddenMetrics.has('frequency') && (current.frequency ?? 0) > 0 && (
                  <SparkMetricCard label="Frequency" value={(current.frequency ?? 0).toFixed(2)}
                    delta={showCompare ? calcDelta(current.frequency ?? 0, prior.frequency ?? 0) : undefined}
                    sparkData={ds.map(d => ({ v: (d as Record<string, unknown>).frequency as number ?? 0 }))} sparkColor="#f97316" delay={12} />
                )}
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

            {/* ── Campaign breakdown ───────────────────────────────── */}
            {!hiddenMetrics.has('campaigns') && (
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

        {/* ── Keyword Highlights (Google Ads only) ─────────────── */}
        {showKwHighlights && (
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-1">
              <MagnifyingGlass size={16} aria-hidden style={{ color: 'var(--blue)' }} />
              <h2 className="section-title">Keyword Highlights</h2>
            </div>
            <p className="section-desc mb-4">Top performing and underperforming keywords this period</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {/* Highlights */}
              <div>
                <p className="section-label mb-3" style={{ color: 'var(--green)' }}>Highlights</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {kwHighlights.map((kw, i) => (
                    <div key={`h-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: '0.375rem', background: 'var(--bg-base)' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)', minWidth: 16, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                          {kw.text}
                        </span>
                        {kw.matchType && (
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)', textTransform: 'capitalize' }}>{kw.matchType.toLowerCase()}</span>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(kw.conversions)}</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)', display: 'block' }}>{fmtPct(kw.ctr)} CTR</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lowlights */}
              <div>
                <p className="section-label mb-3" style={{ color: 'var(--amber, #f59e0b)' }}>Needs Attention</p>
                {kwLowlights.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {kwLowlights.map((kw, i) => (
                      <div key={`l-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: '0.375rem', background: 'var(--bg-base)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                            {kw.text}
                          </span>
                          {kw.matchType && (
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)', textTransform: 'capitalize' }}>{kw.matchType.toLowerCase()}</span>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(kw.cpl)}</span>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)', display: 'block' }}>CPL · {fmtNum(kw.conversions)} conv</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', padding: '6px 8px' }}>All converting keywords are efficient</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Connection summary cards ─────────────────────────── */}
        {availableSources.includes('google_analytics') && connectionsBySource['google_analytics'] && (
          <GA4SummaryCard
            clientId={client.id}
            connectionId={connectionsBySource['google_analytics']}
            dateFrom={fmtDate(fromDate)}
            dateTo={fmtDate(toDate)}
          />
        )}
        {availableSources.includes('google_search_console') && connectionsBySource['google_search_console'] && (
          <GSCSummaryCard
            clientId={client.id}
            connectionId={connectionsBySource['google_search_console']}
            dateFrom={fmtDate(fromDate)}
            dateTo={fmtDate(toDate)}
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
          />
        )}

      </main>
    </div>
  )
}
