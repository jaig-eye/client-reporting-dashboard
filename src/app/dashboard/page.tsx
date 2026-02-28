import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { summarizeMetrics, getDailyTrend, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency } from '@/lib/metrics'
import type { CampaignMetric, Client, SyncLog } from '@/lib/types'
import MetricCard from '@/components/MetricCard'
import SpendChart from '@/components/SpendChart'
import CampaignTable from '@/components/CampaignTable'
import ExportButtons from '@/components/ExportButtons'
import DateRangePicker from '@/components/DateRangePicker'

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0]
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
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

  const params = await searchParams
  const toDate = params.to ? new Date(params.to) : new Date()
  const fromDate = params.from
    ? new Date(params.from)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const periodMs = toDate.getTime() - fromDate.getTime()
  const priorTo = new Date(fromDate.getTime() - 86400000)
  const priorFrom = new Date(priorTo.getTime() - periodMs)

  const [currentResult, priorResult, syncResult] = await Promise.all([
    db.from('campaign_metrics')
      .select('*')
      .eq('client_id', client.id)
      .gte('date', fmtDate(fromDate))
      .lte('date', fmtDate(toDate)),
    db.from('campaign_metrics')
      .select('spend,impressions,clicks,conversions,conversion_value')
      .eq('client_id', client.id)
      .gte('date', fmtDate(priorFrom))
      .lte('date', fmtDate(priorTo)),
    db.from('sync_logs')
      .select('completed_at,status,records_synced')
      .eq('client_id', client.id)
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1),
  ])

  const currentMetrics = (currentResult.data || []) as CampaignMetric[]
  const priorMetrics = (priorResult.data || []) as CampaignMetric[]
  const lastSync = (syncResult.data || []) as SyncLog[]

  const current = summarizeMetrics(currentMetrics)
  const prior = summarizeMetrics(priorMetrics)
  const dailyTrend = getDailyTrend(currentMetrics)

  const campMap = new Map<string, {
    name: string; platform: string
    spend: number; clicks: number; conversions: number; conversionValue: number
    impressions: number
  }>()
  for (const row of currentMetrics) {
    const key = row.campaign_id
    const ex = campMap.get(key)
    if (ex) {
      ex.spend += Number(row.spend)
      ex.clicks += Number(row.clicks)
      ex.conversions += Number(row.conversions)
      ex.conversionValue += Number(row.conversion_value)
      ex.impressions += Number(row.impressions)
    } else {
      campMap.set(key, {
        name: row.campaign_name,
        platform: row.platform,
        spend: Number(row.spend),
        clicks: Number(row.clicks),
        conversions: Number(row.conversions),
        conversionValue: Number(row.conversion_value),
        impressions: Number(row.impressions),
      })
    }
  }

  const campaigns = Array.from(campMap.values())
    .map(c => ({
      ...c,
      roas: c.spend > 0 ? c.conversionValue / c.spend : 0,
      cpl: c.conversions > 0 ? c.spend / c.conversions : 0,
      ctr: c.impressions > 0 ? c.clicks / c.impressions : 0,
    }))
    .sort((a, b) => b.spend - a.spend)

  const syncedAt = lastSync[0]?.completed_at
    ? new Date(lastSync[0].completed_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {client.logo_url && <img src={client.logo_url} alt={client.name} className="h-6" />}
            <span className="font-semibold text-gray-900">{client.name}</span>
            {syncedAt && (
              <span className="text-xs text-gray-400 hidden md:inline">Updated {syncedAt}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ExportButtons clientId={client.id} />
            <DateRangePicker from={fmtDate(fromDate)} to={fmtDate(toDate)} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard label="Total Spend" value={fmt$(current.spend)} delta={calcDelta(current.spend, prior.spend)} sub={fmtCurrency(current.spend)} invertDelta />
          <MetricCard label="ROAS" value={fmtRoas(current.roas)} delta={calcDelta(current.roas, prior.roas)} sub={current.roas >= 1 ? `${fmtCurrency(current.conversionValue)} value` : 'Below breakeven'} />
          <MetricCard label="Conversions" value={fmtNum(current.conversions)} delta={calcDelta(current.conversions, prior.conversions)} sub={current.cpl > 0 ? `${fmtCurrency(current.cpl)} CPL` : undefined} />
          <MetricCard label="Clicks" value={fmtNum(current.clicks)} delta={calcDelta(current.clicks, prior.clicks)} sub={`${fmtPct(current.ctr)} CTR`} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard label="Impressions" value={fmtNum(current.impressions)} delta={calcDelta(current.impressions, prior.impressions)} />
          <MetricCard label="Avg. CPC" value={fmtCurrency(current.cpc)} delta={calcDelta(current.cpc, prior.cpc)} invertDelta />
          <MetricCard label="Cost Per Lead" value={current.cpl > 0 ? fmtCurrency(current.cpl) : '—'} delta={current.cpl > 0 && prior.cpl > 0 ? calcDelta(current.cpl, prior.cpl) : undefined} invertDelta />
          <MetricCard label="Conv. Value" value={fmt$(current.conversionValue)} delta={calcDelta(current.conversionValue, prior.conversionValue)} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Daily Performance</h2>
            <span className="text-xs text-gray-400">{fmtDate(fromDate)} – {fmtDate(toDate)}</span>
          </div>
          <SpendChart data={dailyTrend} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Campaigns</h2>
            <span className="text-xs text-gray-400">{campaigns.length} campaigns</span>
          </div>
          <CampaignTable campaigns={campaigns} />
        </div>
      </main>
    </div>
  )
}
