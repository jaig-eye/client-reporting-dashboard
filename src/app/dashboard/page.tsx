import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings, calcEfficiencyScore, pctOfBenchmark } from '@/lib/agency-settings'
import { summarizeMetrics, getDailyTrend, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency } from '@/lib/metrics'
import type { CampaignMetric, Client, SyncLog } from '@/lib/types'
import MetricCard from '@/components/MetricCard'
import SpendChart from '@/components/SpendChart'
import CampaignTable from '@/components/CampaignTable'
import ExportButtons from '@/components/ExportButtons'
import DateRangePicker from '@/components/DateRangePicker'
import EfficiencyScore from '@/components/EfficiencyScore'
import PlatformTabs from '@/components/PlatformTabs'

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0]
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; platform?: string }>
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const db = createAdminClient()

  const clientResult = await db
    .from('clients')
    .select('*')
    .eq('dashboard_token', token)
    .single()
  const client = clientResult.data as Client | null
  if (!client) redirect('/access')

  const params   = await searchParams
  const platform = (params.platform === 'google' || params.platform === 'meta') ? params.platform : 'all'

  const toDate   = params.to   ? new Date(params.to)   : new Date()
  const fromDate = params.from ? new Date(params.from)  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const periodMs  = toDate.getTime() - fromDate.getTime()
  const priorTo   = new Date(fromDate.getTime() - 86400000)
  const priorFrom = new Date(priorTo.getTime() - periodMs)

  function buildMetricsQuery(from: Date, to: Date, cols = '*') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db
      .from('campaign_metrics')
      .select(cols)
      .eq('client_id', client!.id)
      .gte('date', fmtDate(from))
      .lte('date', fmtDate(to))
    if (platform !== 'all') q = q.eq('platform', platform)
    return q
  }

  const [currentResult, priorResult, syncResult, settings] = await Promise.all([
    buildMetricsQuery(fromDate, toDate),
    buildMetricsQuery(priorFrom, priorTo, 'spend,impressions,clicks,conversions,conversion_value'),
    db.from('sync_logs')
      .select('completed_at,status,records_synced')
      .eq('client_id', client.id)
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1),
    getAgencySettings(),
  ])

  const currentMetrics = (currentResult.data || []) as CampaignMetric[]
  const priorMetrics   = (priorResult.data   || []) as CampaignMetric[]
  const lastSync       = (syncResult.data    || []) as SyncLog[]

  const current    = summarizeMetrics(currentMetrics)
  const prior      = summarizeMetrics(priorMetrics)
  const dailyTrend = getDailyTrend(currentMetrics)

  // Per-client benchmark overrides fall back to global agency settings
  const benchmarks = {
    benchmark_roas:      client.benchmark_roas      ?? settings.benchmark_roas,
    benchmark_ctr:       client.benchmark_ctr       ?? settings.benchmark_ctr,
    benchmark_cpc:       client.benchmark_cpc       ?? settings.benchmark_cpc,
    benchmark_conv_rate: client.benchmark_conv_rate ?? settings.benchmark_conv_rate,
    benchmark_cpm:       client.benchmark_cpm       ?? settings.benchmark_cpm,
  }

  // Efficiency score + component breakdown
  const convRate = current.clicks > 0 ? current.conversions / current.clicks : 0
  const score    = calcEfficiencyScore(
    { roas: current.roas, ctr: current.ctr, cpc: current.cpc, convRate },
    benchmarks
  )
  const scoreComponents = [
    { label: 'ROAS',       pct: pctOfBenchmark(current.roas, benchmarks.benchmark_roas,        false), actual: fmtRoas(current.roas),     benchmark: fmtRoas(benchmarks.benchmark_roas) },
    { label: 'Conv. Rate', pct: pctOfBenchmark(convRate,     benchmarks.benchmark_conv_rate,   false), actual: fmtPct(convRate),           benchmark: fmtPct(benchmarks.benchmark_conv_rate) },
    { label: 'CTR',        pct: pctOfBenchmark(current.ctr,  benchmarks.benchmark_ctr,         false), actual: fmtPct(current.ctr),        benchmark: fmtPct(benchmarks.benchmark_ctr) },
    { label: 'CPC',        pct: pctOfBenchmark(current.cpc,  benchmarks.benchmark_cpc,         true),  actual: fmtCurrency(current.cpc),   benchmark: fmtCurrency(benchmarks.benchmark_cpc) },
  ]

  // Aggregate campaigns for table
  const campMap = new Map<string, { name: string; platform: string; spend: number; clicks: number; conversions: number; conversionValue: number; impressions: number }>()
  for (const row of currentMetrics) {
    const ex = campMap.get(row.campaign_id)
    if (ex) {
      ex.spend += Number(row.spend); ex.clicks += Number(row.clicks)
      ex.conversions += Number(row.conversions); ex.conversionValue += Number(row.conversion_value)
      ex.impressions += Number(row.impressions)
    } else {
      campMap.set(row.campaign_id, {
        name: row.campaign_name, platform: row.platform,
        spend: Number(row.spend), clicks: Number(row.clicks),
        conversions: Number(row.conversions), conversionValue: Number(row.conversion_value),
        impressions: Number(row.impressions),
      })
    }
  }
  const campaigns = Array.from(campMap.values())
    .map(c => ({
      ...c,
      roas: c.spend > 0 ? c.conversionValue / c.spend : 0,
      cpl:  c.conversions > 0 ? c.spend / c.conversions : 0,
      ctr:  c.impressions > 0 ? c.clicks / c.impressions : 0,
    }))
    .sort((a, b) => b.spend - a.spend)

  const syncedAt = lastSync[0]?.completed_at
    ? new Date(lastSync[0].completed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div className="min-h-screen bg-[#080c18]">
      <header className="bg-[#0f1525] border-b border-[#1e2a40] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {settings.agency_logo_url && (
                <img src={settings.agency_logo_url} alt={settings.agency_name} className="max-h-8 max-w-[200px] object-contain" />
              )}
              <span className="text-sm font-medium text-slate-300">{settings.agency_name}</span>
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-2">
              {client.logo_url && <img src={client.logo_url} alt={client.name} className="h-5" />}
              <span className="font-semibold text-white">{client.name}</span>
            </div>
            {syncedAt && <span className="text-xs text-slate-500 hidden md:inline">Updated {syncedAt}</span>}
          </div>
          <div className="flex items-center gap-3">
            <ExportButtons clientId={client.id} />
            <DateRangePicker from={fmtDate(fromDate)} to={fmtDate(toDate)} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Marketing Efficiency Score */}
        <EfficiencyScore score={score} components={scoreComponents} />

        {/* Primary metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Total Spend"   value={fmt$(current.spend)}           delta={calcDelta(current.spend,        prior.spend)}           sub={fmtCurrency(current.spend)}                                                                      invertDelta />
          <MetricCard label="ROAS"          value={fmtRoas(current.roas)}         delta={calcDelta(current.roas,         prior.roas)}            sub={current.roas >= 1 ? `${fmtCurrency(current.conversionValue)} value` : 'Below breakeven'} benchmarkPct={pctOfBenchmark(current.roas, benchmarks.benchmark_roas, false)} />
          <MetricCard label="Conversions"   value={fmtNum(current.conversions)}   delta={calcDelta(current.conversions,  prior.conversions)}     sub={current.cpl > 0 ? `${fmtCurrency(current.cpl)} CPL` : undefined} />
          <MetricCard label="Clicks"        value={fmtNum(current.clicks)}        delta={calcDelta(current.clicks,       prior.clicks)}          sub={`${fmtPct(current.ctr)} CTR`}                                                                     benchmarkPct={pctOfBenchmark(current.ctr, benchmarks.benchmark_ctr, false)} />
        </div>

        {/* Secondary metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Impressions"   value={fmtNum(current.impressions)}   delta={calcDelta(current.impressions,  prior.impressions)} />
          <MetricCard label="Avg. CPC"      value={fmtCurrency(current.cpc)}      delta={calcDelta(current.cpc,          prior.cpc)}             invertDelta benchmarkPct={pctOfBenchmark(current.cpc, benchmarks.benchmark_cpc, true)} />
          <MetricCard label="Cost Per Lead" value={current.cpl > 0 ? fmtCurrency(current.cpl) : '—'} delta={current.cpl > 0 && prior.cpl > 0 ? calcDelta(current.cpl, prior.cpl) : undefined} invertDelta />
          <MetricCard label="Conv. Value"   value={fmt$(current.conversionValue)} delta={calcDelta(current.conversionValue, prior.conversionValue)} />
        </div>

        {/* Daily performance chart with platform filter */}
        <div className="bg-[#0f1525] rounded-xl border border-[#1e2a40] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Daily Performance</h2>
              <p className="text-xs text-slate-500 mt-0.5">{fmtDate(fromDate)} – {fmtDate(toDate)}</p>
            </div>
            <Suspense fallback={null}>
              <PlatformTabs current={platform as 'all' | 'google' | 'meta'} />
            </Suspense>
          </div>
          <SpendChart data={dailyTrend} />
        </div>

        {/* Campaign breakdown table */}
        <div className="bg-[#0f1525] rounded-xl border border-[#1e2a40] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-200">Campaigns</h2>
            <span className="text-xs text-slate-500">{campaigns.length} campaigns</span>
          </div>
          <CampaignTable campaigns={campaigns} />
        </div>

      </main>
    </div>
  )
}
