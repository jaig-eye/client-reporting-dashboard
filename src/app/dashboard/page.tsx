// ─────────────────────────────────────────────────────────────────────────────
// Client Dashboard — /dashboard
//
// Two-level entry point:
//   /dashboard            → Platform overview cards (one per connected source)
//   /dashboard?source=X   → Campaign breakdown for that source
//
// Drill-down hierarchy: Platforms → Platform → Campaigns → Ad Sets → Ads
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings, pctOfBenchmark } from '@/lib/agency-settings'
import { summarizeMetrics, getDailyTrend, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency, applyAdFuel } from '@/lib/metrics'
import type { Client, ClientConnection, Connector, MetaAction } from '@/lib/types'
import { ConnectorLogo } from '@/components/ConnectorLogo'
import SpendChart from '@/components/SpendChart'
import CampaignTable from '@/components/CampaignTable'
import ExportButtons from '@/components/ExportButtons'
import DateRangePicker from '@/components/DateRangePicker'
import EfficiencyScore from '@/components/EfficiencyScore'
import SparkMetricCard from '@/components/SparkMetricCard'
import KeywordSummary from '@/components/KeywordSummary'
import type { AggKeyword } from '@/components/KeywordSummary'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0]
}

const SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads:   'Meta Ads',
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; source?: string; compare?: string }>
}) {
  const cookieStore  = await cookies()
  const db           = createAdminClient()
  const params       = await searchParams

  // Pure client-token auth — unchanged for end clients
  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const clientResult = await db
    .from('clients')
    .select('*')
    .eq('dashboard_token', token)
    .single()
  const client = clientResult.data as Client | null
  if (!client) redirect('/access')



  const toDate   = params.to   ? new Date(params.to)   : new Date()
  const fromDate = params.from ? new Date(params.from)  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const compare  = params.compare ?? 'none'

  const periodMs  = toDate.getTime() - fromDate.getTime()
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

  const adFuelCut = client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut
  const availableSources = connections.map(c => c.connector.type)

  const requestedSource = params.source as string | undefined
  const showOverview    = !requestedSource || !availableSources.includes(requestedSource as never)

  // ─── Auto-redirect to first available platform ─────────────────────────────
  if (showOverview) {
    if (connections.length === 0) {
      const syncedAt = null
      return (
        <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
              <DashHeader
            settings={settings}
            client={client}
            syncedAt={syncedAt}
            fromDate={fromDate}
            toDate={toDate}
            compare={compare}
          />
          <main className="max-w-7xl mx-auto px-6 py-6">
            <div className="card p-12 text-center mt-4">
              <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                Your dashboard is being set up
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Your account manager will connect your ad accounts shortly.
              </p>
            </div>
          </main>
        </div>
      )
    }

    const defaultSource =
      availableSources.includes('google_ads') ? 'google_ads'
      : availableSources.includes('meta_ads')  ? 'meta_ads'
      : availableSources[0]

    const dateQuery = `from=${fmtDate(fromDate)}&to=${fmtDate(toDate)}`
    redirect(`/dashboard?source=${defaultSource}&${dateQuery}`)
  }

  // ─── Campaign View (source selected) ──────────────────────────────────────
  const activeSource     = requestedSource!
  const activeConnection = connections.find(c => c.connector.type === activeSource)
  const table            = activeSource === 'google_ads' ? 'google_ads_metrics' : 'meta_ads_metrics'
  const adLevelTable     = activeSource === 'google_ads' ? 'google_ads_ad_metrics' : 'meta_ads_ad_metrics'
  const adLevelSelect    = activeSource === 'google_ads'
    ? 'campaign_id,spend,impressions,clicks,conversions,conversions_value,date'
    : 'campaign_id,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date'
  const isMetaSource     = activeSource === 'meta_ads'

  // Fetch metrics AND campaign assignments in parallel so we can remap
  // Meta conversions based on the per-campaign display_mode before summarising.
  // Prior period uses ad-level tables (same source as campaign/adset drill-downs)
  // to ensure consistent data coverage.
  const [curRes, priorRes, assignmentsRes, kwRes, negKwRes] = await Promise.all([
    activeConnection
      ? db.from(table)
          .select('*')
          .eq('connection_id', activeConnection.id)
          .gte('date', fmtDate(fromDate))
          .lte('date', fmtDate(toDate))
      : Promise.resolve({ data: [] }),
    showCompare && activeConnection
      ? db.from(adLevelTable)
          .select(adLevelSelect)
          .eq('client_id', client.id)
          .gte('date', fmtDate(priorFrom))
          .lte('date', fmtDate(priorTo))
      : Promise.resolve({ data: [] }),
    db.from('client_campaign_assignments')
      .select('campaign_id, display_mode, hidden')
      .eq('client_id', client.id)
      .eq('source', activeSource),
    // Keywords (Google Ads only)
    activeSource === 'google_ads' && activeConnection
      ? db.from('google_ads_keywords')
          .select('keyword_text,spend,impressions,clicks,conversions')
          .eq('client_id', client.id)
          .eq('connection_id', activeConnection.id)
          .gte('date', fmtDate(fromDate))
          .lte('date', fmtDate(toDate))
      : Promise.resolve({ data: [] as { keyword_text: string; spend: number; impressions: number; clicks: number; conversions: number }[] }),
    activeSource === 'google_ads'
      ? db.from('google_ads_negative_keywords')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
      : Promise.resolve({ data: null, count: 0 }),
  ])

  const assignmentsData = (assignmentsRes.data ?? []) as { campaign_id: string; display_mode: string; hidden: boolean }[]
  const assignmentMap   = new Map(assignmentsData.map(a => [a.campaign_id, a]))
  const lastSyncedAt    = activeConnection?.last_synced_at ?? null

  // Determine overall dashboard mode from campaign assignment majority
  const ecomCount  = assignmentsData.filter(a => a.display_mode === 'ecommerce').length
  const leadCount  = assignmentsData.filter(a => a.display_mode !== 'ecommerce').length
  const isEcomDash = ecomCount > leadCount

  type NormRow = {
    campaign_id: string; campaign_name: string; date: string
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
    roas: number; ctr: number; cpc: number; cpm: number
  }

  // Normalise a raw DB row, applying per-campaign Meta conversion remapping.
  // Each campaign uses its own display_mode to pick the right conv action,
  // so mixed ecom/lead-gen clients get correct values per campaign.
  function normalise(rows: Record<string, unknown>[]): NormRow[] {
    return rows.map(m => {
      let conversions      = Number(m.conversions)   || 0
      let conversion_value = Number(m.conversion_value || m.conversions_value || 0)

      if (isMetaSource && Array.isArray(m.actions)) {
        const campaignIsEcom = (assignmentMap.get(String(m.campaign_id || ''))?.display_mode ?? 'lead_gen') === 'ecommerce'
        const campConvAction = campaignIsEcom ? (client!.purchase_action ?? null) : (client!.lead_action ?? null)
        if (campConvAction) {
          // When a specific action type is configured, ONLY count that action.
          // Never fall back to raw conversions (which is sum of all action types).
          const actions      = m.actions as MetaAction[]
          const actionValues = (m.action_values as MetaAction[] | null) ?? []
          const found        = actions.find(a => a.action_type === campConvAction)
          const foundVal     = actionValues.find(a => a.action_type === campConvAction)
          conversions      = found    ? (parseFloat(found.value    || '0')) : 0
          conversion_value = foundVal ? (parseFloat(foundVal.value || '0')) : 0
        }
      }

      return {
        campaign_id:      String(m.campaign_id   || ''),
        campaign_name:    String(m.campaign_name || ''),
        date:             String(m.date          || ''),
        spend:            Number(m.spend)         || 0,
        impressions:      Number(m.impressions)   || 0,
        clicks:           Number(m.clicks)        || 0,
        conversions,
        conversion_value,
        roas:             Number(m.roas)           || 0,
        ctr:              Number(m.ctr)            || 0,
        cpc:              Number(m.cpc)            || 0,
        cpm:              Number(m.cpm)            || 0,
      }
    })
  }

  const currentMetrics = normalise((curRes.data  ?? []) as Record<string, unknown>[])
  const priorMetrics   = normalise((priorRes.data ?? []) as unknown as Record<string, unknown>[])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current    = summarizeMetrics(currentMetrics as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prior      = summarizeMetrics(priorMetrics as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dailyTrend = getDailyTrend(currentMetrics as any[])

  // ─── Efficiency Score (only rendered when client.show_benchmarks is true) ──
  const effectiveBenchmarks = {
    benchmark_roas:      client.benchmark_roas      ?? settings.benchmark_roas,
    benchmark_ctr:       client.benchmark_ctr       ?? settings.benchmark_ctr,
    benchmark_cpc:       client.benchmark_cpc       ?? settings.benchmark_cpc,
    benchmark_conv_rate: client.benchmark_conv_rate ?? settings.benchmark_conv_rate,
    benchmark_cpm:       client.benchmark_cpm       ?? settings.benchmark_cpm,
  }
  const convRate = current.clicks > 0 ? current.conversions / current.clicks : 0
  const ctrPct  = pctOfBenchmark(current.ctr,  effectiveBenchmarks.benchmark_ctr,  false)
  const cpcPct  = pctOfBenchmark(current.cpc,  effectiveBenchmarks.benchmark_cpc,  true)
  const crPct   = pctOfBenchmark(convRate,     effectiveBenchmarks.benchmark_conv_rate, false)
  const cpmPct  = pctOfBenchmark(current.cpm,  effectiveBenchmarks.benchmark_cpm,  true)
  const roasPct = pctOfBenchmark(current.roas, effectiveBenchmarks.benchmark_roas, false)
  const effScore = isEcomDash
    ? Math.min(100, Math.round(roasPct * 0.35 + crPct * 0.25 + ctrPct * 0.20 + cpcPct * 0.20))
    : Math.min(100, Math.round(crPct   * 0.35 + ctrPct * 0.30 + cpcPct * 0.25 + cpmPct * 0.10))
  const benchComponents = [
    ...(isEcomDash ? [{ label: 'ROAS', pct: roasPct, actual: fmtRoas(current.roas), benchmark: fmtRoas(effectiveBenchmarks.benchmark_roas) }] : []),
    { label: 'CTR',        pct: ctrPct, actual: fmtPct(current.ctr),        benchmark: fmtPct(effectiveBenchmarks.benchmark_ctr) },
    { label: 'Conv. Rate', pct: crPct,  actual: fmtPct(convRate),            benchmark: fmtPct(effectiveBenchmarks.benchmark_conv_rate) },
    { label: 'Avg. CPC',  pct: cpcPct, actual: fmtCurrency(current.cpc),    benchmark: fmtCurrency(effectiveBenchmarks.benchmark_cpc) },
    { label: 'CPM',        pct: cpmPct, actual: fmtCurrency(current.cpm),   benchmark: fmtCurrency(effectiveBenchmarks.benchmark_cpm) },
  ]
  // Build per-campaign aggregation (skip hidden campaigns)
  const campMap = new Map<string, {
    name: string; spend: number; impressions: number; clicks: number
    conversions: number; conversionValue: number; display_mode: string
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
    } else {
      campMap.set(row.campaign_id, {
        name:            row.campaign_name,
        spend:           row.spend,
        impressions:     row.impressions,
        clicks:          row.clicks,
        conversions:     row.conversions,
        conversionValue: row.conversion_value,
        display_mode:    mode,
      })
    }
  }

  const campaigns = Array.from(campMap.entries())
    .map(([id, c]) => {
      const dSpend = adFuelCut > 0 ? applyAdFuel(c.spend, adFuelCut) : c.spend
      return {
        campaign_id:     id,
        campaign_name:   c.name,
        source:          activeSource as never,
        spend:           c.spend,
        impressions:     c.impressions,
        clicks:          c.clicks,
        conversions:     c.conversions,
        conversionValue: c.conversionValue,
        roas:            dSpend > 0 ? c.conversionValue / dSpend : 0,
        cpl:             c.conversions > 0 ? dSpend / c.conversions : 0,
        ctr:             c.impressions > 0 ? c.clicks / c.impressions : 0,
        cpm:             c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
        adFuelSpend:     applyAdFuel(c.spend, adFuelCut),
        display_mode:    c.display_mode,
        hidden:          false,
      }
    })
    .sort((a, b) => b.spend - a.spend)

  const syncedAt = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  // ─── Daily series for sparklines ────────────────────────────────────────
  const dailyMap = new Map<string, { spend: number; clicks: number; impressions: number; conversions: number; conversion_value: number }>()
  for (const r of currentMetrics) {
    const ex = dailyMap.get(r.date)
    if (ex) {
      ex.spend           += r.spend;          ex.clicks      += r.clicks
      ex.impressions     += r.impressions;    ex.conversions += r.conversions
      ex.conversion_value+= r.conversion_value
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

  // ─── Keyword aggregation (Google Ads only) ───────────────────────────────
  const kwRaw = (kwRes.data ?? []) as { keyword_text: string; spend: number; impressions: number; clicks: number; conversions: number }[]
  const kwMap = new Map<string, AggKeyword>()
  for (const r of kwRaw) {
    const key = r.keyword_text.toLowerCase()
    const ex  = kwMap.get(key)
    if (ex) { ex.impressions += r.impressions; ex.clicks += r.clicks; ex.conversions += Number(r.conversions); ex.spend += Number(r.spend) }
    else kwMap.set(key, { text: r.keyword_text, impressions: r.impressions, clicks: r.clicks, conversions: Number(r.conversions), spend: Number(r.spend) })
  }
  const keywords     = Array.from(kwMap.values())
  const negativeCount = (negKwRes as { count?: number | null }).count ?? 0

  // Conversion label for keyword section
  const kwConvLabel = isEcomDash ? 'Purchases' : 'Leads'

  const dateQuery = `from=${fmtDate(fromDate)}&to=${fmtDate(toDate)}${compare !== 'none' ? `&compare=${compare}` : ''}`

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <DashHeader
        settings={settings}
        client={client}
        syncedAt={syncedAt}
        fromDate={fromDate}
        toDate={toDate}
        compare={compare}
      />

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* ── Platform pills ─────────────────────────────────── */}
        {connections.length > 1 && (
          <div className="flex items-center gap-2">
            {connections.map(conn => {
              const isActive = conn.connector.type === activeSource
              return (
                <Link
                  key={conn.id}
                  href={`/dashboard?source=${conn.connector.type}&${dateQuery}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    padding: '0.375rem 1rem',
                    borderRadius: '9999px',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                    transition: 'all 0.15s',
                    background:   isActive ? 'var(--blue)'           : 'var(--bg-subtle)',
                    color:        isActive ? '#fff'                   : 'var(--text-muted)',
                    border:       isActive ? '1px solid var(--blue)'  : '1px solid var(--border)',
                  }}
                >
                  <ConnectorLogo type={conn.connector.type} size={16} />
                  {SOURCE_LABELS[conn.connector.type] ?? conn.connector.type}
                </Link>
              )
            })}
          </div>
        )}

        {/* ── Empty / no connection ──────────────────────────── */}
        {!activeConnection && (
          <div className="card p-12 text-center mt-4">
            <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              No connection found
            </p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              This platform is not connected to your account.
            </p>
          </div>
        )}

        {activeConnection && currentMetrics.length === 0 && (
          <div className="card p-10 text-center">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              No data for this date range
            </p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Try selecting a different date range above.
            </p>
          </div>
        )}

        {currentMetrics.length > 0 && (
          <>
            {/* ── Metric cards with sparklines ──────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <SparkMetricCard
                label={adFuelCut > 0 ? 'Ad Fuel Spend' : 'Total Spend'}
                value={fmt$(adFuelCut > 0 ? applyAdFuel(current.spend, adFuelCut) : current.spend)}
                delta={showCompare ? calcDelta(current.spend, prior.spend) : undefined}
                invertDelta
                sparkData={spendSpark}
                sparkColor={settings.chart_color_spend ?? '#93c5fd'}
                delay={0}
              />
              {isEcomDash ? (
                <>
                  <SparkMetricCard
                    label="Revenue"
                    value={fmt$(current.conversionValue)}
                    delta={showCompare ? calcDelta(current.conversionValue, prior.conversionValue) : undefined}
                    sparkData={convValueSpark}
                    sparkColor="#10b981"
                    delay={1}
                  />
                  <SparkMetricCard
                    label="ROAS"
                    value={fmtRoas(current.roas)}
                    delta={showCompare ? calcDelta(current.roas, prior.roas) : undefined}
                    sparkData={roasSpark}
                    sparkColor="#8b5cf6"
                    delay={2}
                  />
                </>
              ) : (
                <>
                  <SparkMetricCard
                    label="Leads"
                    value={fmtNum(current.conversions)}
                    delta={showCompare ? calcDelta(current.conversions, prior.conversions) : undefined}
                    sparkData={convSpark}
                    sparkColor="#10b981"
                    delay={1}
                  />
                  <SparkMetricCard
                    label="Cost Per Lead"
                    value={current.cpl > 0 ? fmtCurrency(current.cpl) : '—'}
                    delta={showCompare ? calcDelta(current.cpl, prior.cpl) : undefined}
                    invertDelta
                    sparkData={cplSpark}
                    sparkColor="#f59e0b"
                    delay={2}
                  />
                </>
              )}
              <SparkMetricCard
                label="CTR"
                value={fmtPct(current.ctr)}
                delta={showCompare ? calcDelta(current.ctr, prior.ctr) : undefined}
                sparkData={ctrSpark}
                sparkColor="#3b82f6"
                benchmark={{ actual: current.ctr, target: effectiveBenchmarks.benchmark_ctr, actualLabel: fmtPct(current.ctr), targetLabel: fmtPct(effectiveBenchmarks.benchmark_ctr), color: '#3b82f6' }}
                delay={3}
              />
              <SparkMetricCard
                label="Conv. Rate"
                value={fmtPct(convRate)}
                delta={showCompare ? calcDelta(convRate, prior.clicks > 0 ? prior.conversions / prior.clicks : 0) : undefined}
                sparkData={crSpark}
                sparkColor="#10b981"
                benchmark={{ actual: convRate, target: effectiveBenchmarks.benchmark_conv_rate, actualLabel: fmtPct(convRate), targetLabel: fmtPct(effectiveBenchmarks.benchmark_conv_rate), color: '#10b981' }}
                delay={4}
              />
              <SparkMetricCard
                label="CPM"
                value={fmtCurrency(current.cpm)}
                delta={showCompare ? calcDelta(current.cpm, prior.cpm) : undefined}
                invertDelta
                sparkData={cpmSpark}
                sparkColor="#f59e0b"
                benchmark={{ actual: current.cpm, target: effectiveBenchmarks.benchmark_cpm, actualLabel: fmtCurrency(current.cpm), targetLabel: fmtCurrency(effectiveBenchmarks.benchmark_cpm), color: '#f59e0b' }}
                delay={5}
              />
            </div>

            {/* ── Marketing Efficiency Score (admin-toggleable) ─────────── */}
            {client.show_benchmarks && (
              <EfficiencyScore score={effScore} components={benchComponents} />
            )}

            {/* ── Daily Performance chart ───────────────────────────────── */}
            <div className="card p-6">
              <div className="mb-4">
                <h2 className="section-title">Daily Performance</h2>
                <p className="section-desc">
                  {fmtDate(fromDate)} – {fmtDate(toDate)}
                  {showCompare && (
                    <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>
                      vs {fmtDate(priorFrom)} – {fmtDate(priorTo)}
                    </span>
                  )}
                </p>
              </div>
              <SpendChart
                data={dailyTrend}
                priorData={showCompare ? getDailyTrend(priorMetrics as never[]) : undefined}
                colorSpend={settings.chart_color_spend}
                colorPriorSpend={settings.chart_color_prior_spend}
                colorConversions={settings.chart_color_conversions}
                colorPriorConversions={settings.chart_color_prior_conversions}
              />
            </div>

            {/* ── Keyword Intelligence (Google Ads only) ────────────────── */}
            {activeSource === 'google_ads' && keywords.length > 0 && (
              <div>
                <div className="page-header mb-4" style={{ paddingBottom: 0 }}>
                  <h2 className="section-title" style={{ fontSize: '1rem' }}>Keyword Intelligence</h2>
                  <p className="section-desc">{keywords.length} keywords · {fmtDate(fromDate)} – {fmtDate(toDate)}</p>
                </div>
                <KeywordSummary
                  keywords={keywords}
                  negativeCount={negativeCount}
                  conversionLabel={kwConvLabel}
                />
              </div>
            )}

            {/* ── Campaign breakdown ────────────────────────────────────── */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="section-title">Campaigns</h2>
                  <p className="section-desc">{campaigns.length} campaigns</p>
                </div>
              </div>
              <CampaignTable
                campaigns={campaigns}
                adFuelCut={adFuelCut}
                isEcomDash={isEcomDash}
                connectionId={activeConnection?.id}
                dateFrom={fmtDate(fromDate)}
                dateTo={fmtDate(toDate)}
                compare={compare !== 'none' ? compare : undefined}
              />
            </div>
          </>
        )}

      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared header — used by both overview and campaign views
// ─────────────────────────────────────────────────────────────────────────────

function DashHeader({
  settings,
  client,
  syncedAt,
  fromDate,
  toDate,
  compare,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any
  client: Client
  syncedAt: string | null
  fromDate: Date
  toDate: Date
  compare?: string
}) {
  return (
    <header
      className="sticky top-0 z-10 border-b"
      style={{
        background:  'var(--bg-surface)',
        borderColor: 'var(--border)',
        boxShadow:   '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {settings.agency_logo_url && (
            <img
              src={settings.agency_logo_url}
              alt={settings.agency_name}
              className="max-h-7 max-w-[140px] object-contain flex-shrink-0"
            />
          )}
          <span className="hidden sm:block text-sm" style={{ color: 'var(--text-muted)' }}>
            {settings.agency_name}
          </span>
          <span style={{ color: 'var(--border)' }}>|</span>
          <div className="flex items-center gap-2 min-w-0">
            {client.logo_url && (
              <img src={client.logo_url} alt={client.name} className="h-5 object-contain flex-shrink-0" />
            )}
            <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {client.name}
            </span>
          </div>
          {syncedAt && (
            <span className="text-xs hidden md:inline flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
              Updated {syncedAt}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <ExportButtons clientId={client.id} />
          <Suspense fallback={null}>
            <DateRangePicker
              from={fromDate.toISOString().split('T')[0]}
              to={toDate.toISOString().split('T')[0]}
              compare={compare}
            />
          </Suspense>
        </div>
      </div>
    </header>
  )
}
