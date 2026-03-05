import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings, calcEfficiencyScore, pctOfBenchmark } from '@/lib/agency-settings'
import { summarizeMetrics, getDailyTrend, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency } from '@/lib/metrics'
import { GOAL_TYPE_DEFS, getConversionLabel, shouldShowRoas } from '@/lib/goal-types'
import type { CampaignMetric, Client, SyncLog, CampaignSettings, GoalType } from '@/lib/types'
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

  const [currentResult, priorResult, syncResult, settings, campaignSettingsResult] = await Promise.all([
    buildMetricsQuery(fromDate, toDate),
    buildMetricsQuery(priorFrom, priorTo, 'spend,impressions,clicks,conversions,conversion_value'),
    db.from('sync_logs')
      .select('completed_at,status,records_synced')
      .eq('client_id', client.id)
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1),
    getAgencySettings(),
    db.from('campaign_settings').select('*').eq('client_id', client.id),
  ])

  const rawCurrentMetrics = (currentResult.data || []) as CampaignMetric[]
  const rawPriorMetrics   = (priorResult.data   || []) as CampaignMetric[]
  const lastSync          = (syncResult.data    || []) as SyncLog[]

  // Per-campaign config lookup: campaign_id → CampaignSettings
  const campaignConfigMap = new Map<string, CampaignSettings>(
    ((campaignSettingsResult.data || []) as CampaignSettings[]).map(s => [s.campaign_id, s])
  )

  // Effective client-level metric config (fallback when campaign has no override)
  const effectiveMetricConfig = {
    ...settings.metric_config,
    ...(client.metric_config ?? {}),
  }
  const clientMetaConversionAction = effectiveMetricConfig.meta_conversion_action

  // Re-map Meta conversions live from raw_meta_actions.
  // Per-campaign meta_conversion_action takes priority over client/global.
  function remapMetrics(metrics: CampaignMetric[]): CampaignMetric[] {
    return metrics.map(row => {
      if (row.platform !== 'meta') return row
      const campaignCfg = campaignConfigMap.get(row.campaign_id)
      const actionToUse = campaignCfg?.meta_conversion_action ?? clientMetaConversionAction
      if (!actionToUse || actionToUse === 'results') return row
      const raw = row.raw_meta_actions
      if (!raw?.length) return row
      const match = raw.filter(a => a.action_type === actionToUse)
      const conversions = match.reduce((s, a) => s + parseFloat(a.value || '0'), 0)
      const conversion_value = match.reduce((s, a) => s + parseFloat(a.revenue || '0'), 0)
      const roas = row.spend > 0 && conversion_value > 0 ? conversion_value / row.spend : 0
      return { ...row, conversions, conversion_value, roas }
    })
  }

  const currentMetrics = remapMetrics(rawCurrentMetrics)
  const priorMetrics   = remapMetrics(rawPriorMetrics)

  const current    = summarizeMetrics(currentMetrics)
  const prior      = summarizeMetrics(priorMetrics)
  const dailyTrend = getDailyTrend(currentMetrics)

  const benchmarks = {
    benchmark_roas:      client.benchmark_roas      ?? settings.benchmark_roas,
    benchmark_ctr:       client.benchmark_ctr       ?? settings.benchmark_ctr,
    benchmark_cpc:       client.benchmark_cpc       ?? settings.benchmark_cpc,
    benchmark_conv_rate: client.benchmark_conv_rate ?? settings.benchmark_conv_rate,
    benchmark_cpm:       client.benchmark_cpm       ?? settings.benchmark_cpm,
  }

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

  // Aggregate campaigns for table — enriched with per-campaign goal type + label
  const campMap = new Map<string, {
    name: string; platform: string; spend: number; clicks: number
    conversions: number; conversionValue: number; impressions: number
    goalType: GoalType; conversionLabel: string
  }>()
  for (const row of currentMetrics) {
    const cfg = campaignConfigMap.get(row.campaign_id)
    const goalType: GoalType = (cfg?.goal_type as GoalType) ?? 'unset'
    const convLabel = getConversionLabel(goalType, cfg?.conversion_label ?? effectiveMetricConfig.conversion_label)
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
        goalType, conversionLabel: convLabel,
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

  // Group metrics by goal type for split summary cards
  const goalGroupsCurrent = new Map<GoalType, CampaignMetric[]>()
  const goalGroupsPrior   = new Map<GoalType, CampaignMetric[]>()
  for (const row of currentMetrics) {
    const gt: GoalType = (campaignConfigMap.get(row.campaign_id)?.goal_type as GoalType) ?? 'unset'
    if (!goalGroupsCurrent.has(gt)) goalGroupsCurrent.set(gt, [])
    goalGroupsCurrent.get(gt)!.push(row)
  }
  for (const row of priorMetrics) {
    const gt: GoalType = (campaignConfigMap.get(row.campaign_id)?.goal_type as GoalType) ?? 'unset'
    if (!goalGroupsPrior.has(gt)) goalGroupsPrior.set(gt, [])
    goalGroupsPrior.get(gt)!.push(row)
  }

  const configuredGoalTypes = Array.from(goalGroupsCurrent.keys()).filter(gt => gt !== 'unset')
  const showSplitCards = configuredGoalTypes.length > 0
  const conversionLabel = effectiveMetricConfig.conversion_label || 'Conversions'

  const syncedAt = lastSync[0]?.completed_at
    ? new Date(lastSync[0].completed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  const glassCard = {
    background: 'rgba(255,255,255,0.025)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderColor: 'rgba(255,255,255,0.07)',
  }

  return (
    <div className="min-h-screen" style={{ background: '#04040a' }}>
      {/* Frosted glass header */}
      <header className="sticky top-0 z-10 border-b" style={{
        background: 'rgba(4,4,10,0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderColor: 'rgba(255,255,255,0.06)',
      }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {settings.agency_logo_url && (
                <img src={settings.agency_logo_url} alt={settings.agency_name} className="max-h-8 max-w-[200px] object-contain" />
              )}
              <span className="text-sm font-medium text-slate-400">{settings.agency_name}</span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.08)' }}>|</span>
            <div className="flex items-center gap-2">
              {client.logo_url && <img src={client.logo_url} alt={client.name} className="h-5" />}
              <span className="font-semibold text-white">{client.name}</span>
            </div>
            {syncedAt && <span className="text-xs text-slate-600 hidden md:inline">Updated {syncedAt}</span>}
          </div>
          <div className="flex items-center gap-3">
            <ExportButtons clientId={client.id} />
            <DateRangePicker from={fmtDate(fromDate)} to={fmtDate(toDate)} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        <EfficiencyScore score={score} components={scoreComponents} />

        {showSplitCards ? (
          <>
            {/* Platform-agnostic summary row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Total Spend"  value={fmt$(current.spend)}           delta={calcDelta(current.spend, prior.spend)}           sub={fmtCurrency(current.spend)}     invertDelta delay={0} />
              <MetricCard label="Clicks"       value={fmtNum(current.clicks)}        delta={calcDelta(current.clicks, prior.clicks)}         sub={`${fmtPct(current.ctr)} CTR`}   benchmarkPct={pctOfBenchmark(current.ctr, benchmarks.benchmark_ctr, false)} delay={1} />
              <MetricCard label="Avg. CPC"     value={fmtCurrency(current.cpc)}      delta={calcDelta(current.cpc, prior.cpc)}               invertDelta                           benchmarkPct={pctOfBenchmark(current.cpc, benchmarks.benchmark_cpc, true)} delay={2} />
              <MetricCard label="Impressions"  value={fmtNum(current.impressions)}   delta={calcDelta(current.impressions, prior.impressions)}                                     delay={3} />
            </div>

            {/* Per-goal-type conversion cards */}
            <div className={`grid gap-4 ${configuredGoalTypes.length === 1 ? 'grid-cols-1 max-w-sm' : configuredGoalTypes.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
              {configuredGoalTypes.map((gt) => {
                const rows   = goalGroupsCurrent.get(gt) ?? []
                const prows  = goalGroupsPrior.get(gt) ?? []
                const sum    = summarizeMetrics(rows)
                const psum   = summarizeMetrics(prows)
                const def    = GOAL_TYPE_DEFS[gt]
                const campCfg = campaigns.find(c => c.goalType === gt)
                const label  = campCfg?.conversionLabel ?? def.defaultConversionLabel
                const showR  = shouldShowRoas(gt)
                const delta  = calcDelta(sum.conversions, psum.conversions)

                return (
                  <div key={gt} className="rounded-2xl p-5 border" style={glassCard}>
                    <div className="flex items-center justify-between mb-4">
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${def.badgeClasses}`}>
                        {def.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</p>
                        <p className="text-3xl font-bold text-white">{fmtNum(sum.conversions)}</p>
                        <p className="text-xs mt-1" style={{ color: delta >= 0 ? '#10b981' : '#f87171' }}>
                          {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% vs prior period
                        </p>
                      </div>
                      {showR ? (
                        <div>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">ROAS</p>
                          <p className="text-3xl font-bold" style={{ color: sum.roas >= 3 ? '#10b981' : sum.roas >= 1.5 ? '#f59e0b' : '#f87171' }}>
                            {fmtRoas(sum.roas)}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">{fmt$(sum.conversionValue)} revenue</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Cost / {label.replace(/s$/, '')}</p>
                          <p className="text-3xl font-bold text-white">
                            {sum.cpl > 0 ? fmtCurrency(sum.cpl) : '—'}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">{fmt$(sum.spend)} spend</p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Unconfigured campaigns notice */}
              {goalGroupsCurrent.has('unset') && (goalGroupsCurrent.get('unset')?.length ?? 0) > 0 && (() => {
                const sum = summarizeMetrics(goalGroupsCurrent.get('unset')!)
                return (
                  <div key="unset" className="rounded-2xl p-5 border" style={{
                    background: 'rgba(255,255,255,0.012)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    borderColor: 'rgba(255,255,255,0.04)',
                  }}>
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-slate-800/60 text-slate-500 border border-slate-700/50 mb-4 inline-block">
                      Not Configured
                    </span>
                    <p className="text-xs text-slate-600 mb-2">Campaigns without a goal type assigned.</p>
                    <p className="text-sm font-semibold text-slate-400">{fmt$(sum.spend)} spend</p>
                  </div>
                )
              })()}
            </div>
          </>
        ) : (
          <>
            {/* Standard 4-card layout (no goal types configured yet) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Total Spend"     value={fmt$(current.spend)}           delta={calcDelta(current.spend, prior.spend)}           sub={fmtCurrency(current.spend)}                                                                        invertDelta delay={0} />
              <MetricCard label="ROAS"            value={fmtRoas(current.roas)}         delta={calcDelta(current.roas, prior.roas)}             sub={current.roas >= 1 ? `${fmtCurrency(current.conversionValue)} value` : 'Below breakeven'}  benchmarkPct={pctOfBenchmark(current.roas, benchmarks.benchmark_roas, false)} delay={1} />
              <MetricCard label={conversionLabel} value={fmtNum(current.conversions)}   delta={calcDelta(current.conversions, prior.conversions)} sub={current.cpl > 0 ? `${fmtCurrency(current.cpl)} CPL` : undefined}                                         delay={2} />
              <MetricCard label="Clicks"          value={fmtNum(current.clicks)}        delta={calcDelta(current.clicks, prior.clicks)}         sub={`${fmtPct(current.ctr)} CTR`}                                                             benchmarkPct={pctOfBenchmark(current.ctr, benchmarks.benchmark_ctr, false)} delay={3} />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Impressions"     value={fmtNum(current.impressions)}   delta={calcDelta(current.impressions, prior.impressions)}                                                                                                                   delay={0} />
              <MetricCard label="Avg. CPC"        value={fmtCurrency(current.cpc)}      delta={calcDelta(current.cpc, prior.cpc)}               invertDelta                                                                                    benchmarkPct={pctOfBenchmark(current.cpc, benchmarks.benchmark_cpc, true)} delay={1} />
              <MetricCard label={`Cost Per ${conversionLabel.replace(/s$/, '')}`} value={current.cpl > 0 ? fmtCurrency(current.cpl) : '—'} delta={current.cpl > 0 && prior.cpl > 0 ? calcDelta(current.cpl, prior.cpl) : undefined} invertDelta              delay={2} />
              <MetricCard label="Conv. Value"     value={fmt$(current.conversionValue)} delta={calcDelta(current.conversionValue, prior.conversionValue)}                                                                                                         delay={3} />
            </div>
          </>
        )}

        {/* Daily performance chart */}
        <div className="rounded-2xl border p-6" style={glassCard}>
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
        <div className="rounded-2xl border p-6" style={glassCard}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-200">Campaigns</h2>
            <span className="text-xs text-slate-600">{campaigns.length} campaigns</span>
          </div>
          <CampaignTable campaigns={campaigns} />
        </div>

      </main>
    </div>
  )
}
