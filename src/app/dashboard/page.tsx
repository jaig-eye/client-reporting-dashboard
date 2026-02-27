import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { summarizeMetrics, getDailyTrend, calcDelta, formatCurrency, formatNumber, formatRoas, formatPercent } from '@/lib/metrics'
import type { CampaignMetric, Client } from '@/lib/types'
import MetricCard from '@/components/MetricCard'
import SpendChart from '@/components/SpendChart'
import CampaignTable from '@/components/CampaignTable'
import ExportButtons from '@/components/ExportButtons'
import DateRangePicker from '@/components/DateRangePicker'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  // Get client record by email
  const { data: client } = await adminClient
    .from('clients')
    .select('*')
    .eq('email', user.email)
    .single() as { data: Client | null }

  if (!client) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Access pending</h1>
          <p className="text-gray-500 text-sm">Your account is being set up. Check back soon.</p>
        </div>
      </div>
    )
  }

  // Date range (default: last 30 days)
  const params = await searchParams
  const toDate = params.to ? new Date(params.to) : new Date()
  const fromDate = params.from ? new Date(params.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const priorFrom = new Date(fromDate.getTime() - (toDate.getTime() - fromDate.getTime()))
  const priorTo = new Date(fromDate.getTime() - 86400000)

  const fmt = (d: Date) => d.toISOString().split('T')[0]

  // Fetch current period metrics
  const { data: currentMetrics } = await adminClient
    .from('campaign_metrics')
    .select('*')
    .eq('client_id', client.id)
    .gte('date', fmt(fromDate))
    .lte('date', fmt(toDate)) as { data: CampaignMetric[] | null }

  // Fetch prior period metrics
  const { data: priorMetrics } = await adminClient
    .from('campaign_metrics')
    .select('*')
    .eq('client_id', client.id)
    .gte('date', fmt(priorFrom))
    .lte('date', fmt(priorTo)) as { data: CampaignMetric[] | null }

  const current = summarizeMetrics(currentMetrics || [])
  const prior = summarizeMetrics(priorMetrics || [])
  const dailyTrend = getDailyTrend(currentMetrics || [])

  // Aggregate by campaign for the table
  const campaignMap = new Map<string, { name: string; platform: string; spend: number; clicks: number; conversions: number; roas: number }>()
  for (const row of currentMetrics || []) {
    const existing = campaignMap.get(row.campaign_id)
    if (existing) {
      existing.spend += Number(row.spend)
      existing.clicks += Number(row.clicks)
      existing.conversions += Number(row.conversions)
    } else {
      campaignMap.set(row.campaign_id, {
        name: row.campaign_name,
        platform: row.platform,
        spend: Number(row.spend),
        clicks: Number(row.clicks),
        conversions: Number(row.conversions),
        roas: 0,
      })
    }
  }
  for (const [, v] of campaignMap) {
    const totalValue = (currentMetrics || [])
      .filter(r => r.campaign_name === v.name)
      .reduce((s, r) => s + Number(r.conversion_value), 0)
    v.roas = v.spend > 0 ? totalValue / v.spend : 0
  }
  const campaigns = Array.from(campaignMap.values()).sort((a, b) => b.spend - a.spend)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            {client.logo_url && (
              <img src={client.logo_url} alt={client.name} className="h-7 mb-1" />
            )}
            <h1 className="text-lg font-semibold text-gray-900">{client.name} — Campaign Report</h1>
          </div>
          <div className="flex items-center gap-3">
            <ExportButtons clientId={client.id} />
            <form action="/auth/signout" method="post">
              <button className="text-sm text-gray-500 hover:text-gray-700">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-medium text-gray-500">
            {fmt(fromDate)} – {fmt(toDate)}
          </h2>
          <DateRangePicker from={fmt(fromDate)} to={fmt(toDate)} />
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="Total Spend"
            value={formatCurrency(current.spend)}
            delta={calcDelta(current.spend, prior.spend)}
          />
          <MetricCard
            label="ROAS"
            value={formatRoas(current.roas)}
            delta={calcDelta(current.roas, prior.roas)}
          />
          <MetricCard
            label="Conversions"
            value={formatNumber(current.conversions)}
            delta={calcDelta(current.conversions, prior.conversions)}
          />
          <MetricCard
            label="Clicks"
            value={formatNumber(current.clicks)}
            delta={calcDelta(current.clicks, prior.clicks)}
          />
        </div>

        {/* Spend Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Spend & Conversions</h3>
          <SpendChart data={dailyTrend} />
        </div>

        {/* Campaign Table */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Campaigns</h3>
          <CampaignTable campaigns={campaigns} />
        </div>
      </main>
    </div>
  )
}
