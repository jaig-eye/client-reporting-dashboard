// ─────────────────────────────────────────────────────────────────────────────
// Client Dashboard — /dashboard
//
// Source-aware dashboard. Each connected data source has its own tab.
// Data is never blended at display time — Google Ads and Meta are shown
// independently so clients understand each channel clearly.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { summarizeMetrics, getDailyTrend, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency } from '@/lib/metrics'
import type { Client, ClientConnection, Connector, GoogleAdsMetric, MetaAdsMetric, CampaignCategory } from '@/lib/types'
import MetricCard from '@/components/MetricCard'
import SpendChart from '@/components/SpendChart'
import CampaignTable from '@/components/CampaignTable'
import ExportButtons from '@/components/ExportButtons'
import DateRangePicker from '@/components/DateRangePicker'
import DashboardSourceTabs from '@/components/DashboardSourceTabs'

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0]
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; source?: string }>
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
  const toDate   = params.to   ? new Date(params.to)   : new Date()
  const fromDate = params.from ? new Date(params.from)  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const periodMs  = toDate.getTime() - fromDate.getTime()
  const priorTo   = new Date(fromDate.getTime() - 86400000)
  const priorFrom = new Date(priorTo.getTime() - periodMs)

  // All active connections for this client
  const { data: connectionsData } = await db
    .from('client_connections')
    .select('*, connector:connectors(id, type, label)')
    .eq('client_id', client.id)
    .eq('status', 'active')

  const connections = (connectionsData ?? []) as (ClientConnection & {
    connector: Pick<Connector, 'id' | 'type' | 'label'>
  })[]

  // Resolve the active source tab
  const availableSources = connections.map(c => c.connector.type)
  const requestedSource  = params.source as string | undefined
  const activeSource     = availableSources.includes(requestedSource as never)
    ? requestedSource!
    : availableSources[0] ?? null

  const activeConnection = connections.find(c => c.connector.type === activeSource)

  const [settings, categoriesResult] = await Promise.all([
    getAgencySettings(),
    db.from('campaign_categories').select('*').order('sort_order'),
  ])

  const categories  = (categoriesResult.data ?? []) as CampaignCategory[]
  const categoryMap = new Map(categories.map(c => [c.id, c]))

  // Fetch source-specific metrics for the active tab
  type NormRow = {
    campaign_id: string; campaign_name: string; date: string
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
    roas: number; ctr: number; cpc: number; cpm: number
  }

  let currentMetrics: NormRow[] = []
  let priorMetrics:   Omit<NormRow, 'campaign_id' | 'campaign_name' | 'date'>[] = []
  let lastSyncedAt:   string | null = null

  if (activeConnection && activeSource) {
    const table = activeSource === 'google_ads' ? 'google_ads_metrics' : 'meta_ads_metrics'

    const [curRes, priorRes] = await Promise.all([
      db.from(table)
        .select('*')
        .eq('connection_id', activeConnection.id)
        .gte('date', fmtDate(fromDate))
        .lte('date', fmtDate(toDate)),
      db.from(table)
        .select('spend,impressions,clicks,conversions,conversion_value,conversions_value')
        .eq('connection_id', activeConnection.id)
        .gte('date', fmtDate(priorFrom))
        .lte('date', fmtDate(priorTo)),
    ])

    // Normalise to a common shape regardless of source table
    const normalise = (rows: Record<string, unknown>[]): NormRow[] =>
      rows.map(m => ({
        campaign_id:      String(m.campaign_id   || ''),
        campaign_name:    String(m.campaign_name || ''),
        date:             String(m.date          || ''),
        spend:            Number(m.spend)         || 0,
        impressions:      Number(m.impressions)   || 0,
        clicks:           Number(m.clicks)        || 0,
        conversions:      Number(m.conversions)   || 0,
        // Google Ads stores revenue as conversions_value; Meta as conversion_value
        conversion_value: Number(m.conversion_value  || m.conversions_value || 0),
        roas:             Number(m.roas)           || 0,
        ctr:              Number(m.ctr)            || 0,
        cpc:              Number(m.cpc)            || 0,
        cpm:              Number(m.cpm)            || 0,
      }))

    currentMetrics = normalise((curRes.data  ?? []) as Record<string, unknown>[])
    priorMetrics   = normalise((priorRes.data ?? []) as Record<string, unknown>[])
    lastSyncedAt   = activeConnection.last_synced_at ?? null
  }

  // Campaign assignments for category mapping + hidden filtering
  const { data: assignmentsData } = activeSource
    ? await db
        .from('client_campaign_assignments')
        .select('campaign_id, category_id, hidden, category:campaign_categories(*)')
        .eq('client_id', client.id)
        .eq('source', activeSource)
    : { data: [] }

  const assignmentMap = new Map(
    (assignmentsData ?? []).map((a: Record<string, unknown>) => [a.campaign_id as string, a])
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current    = summarizeMetrics(currentMetrics as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prior      = summarizeMetrics(priorMetrics as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dailyTrend = getDailyTrend(currentMetrics as any[])

  // Aggregate metrics per campaign for the breakdown table
  const campMap = new Map<string, {
    name: string; spend: number; impressions: number; clicks: number
    conversions: number; conversionValue: number; category?: CampaignCategory
  }>()

  for (const row of currentMetrics) {
    const assignment = assignmentMap.get(row.campaign_id) as Record<string, unknown> | undefined
    if (assignment?.hidden) continue

    const cat = assignment?.category_id
      ? categoryMap.get(assignment.category_id as string)
      : (assignment?.category as CampaignCategory | undefined)

    const ex = campMap.get(row.campaign_id)
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
        category:        cat,
      })
    }
  }

  const campaigns = Array.from(campMap.entries())
    .map(([id, c]) => ({
      campaign_id:     id,
      campaign_name:   c.name,
      source:          (activeSource ?? 'google_ads') as never,
      spend:           c.spend,
      impressions:     c.impressions,
      clicks:          c.clicks,
      conversions:     c.conversions,
      conversionValue: c.conversionValue,
      roas:            c.spend > 0 ? c.conversionValue / c.spend : 0,
      cpl:             c.conversions > 0 ? c.spend / c.conversions : 0,
      ctr:             c.impressions > 0 ? c.clicks / c.impressions : 0,
      cpm:             c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
      category:        c.category ?? null,
      hidden:          false,
    }))
    .sort((a, b) => b.spend - a.spend)

  const syncedAt = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-10 border-b"
        style={{
          background:   'var(--bg-surface)',
          borderColor:  'var(--border)',
          boxShadow:    '0 1px 3px rgba(0,0,0,0.06)',
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
            <DateRangePicker from={fmtDate(fromDate)} to={fmtDate(toDate)} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* ── Source tabs (multi-source clients only) ───────── */}
        {availableSources.length > 1 && activeSource && (
          <Suspense fallback={null}>
            <DashboardSourceTabs
              sources={availableSources}
              activeSource={activeSource}
            />
          </Suspense>
        )}

        {/* ── Empty state ────────────────────────────────────── */}
        {connections.length === 0 && (
          <div className="card p-12 text-center mt-8">
            <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Your dashboard is being set up
            </p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Your account manager will connect your ad accounts shortly.
              This page will display your performance data once connected.
            </p>
          </div>
        )}

        {/* ── Metrics ───────────────────────────────────────── */}
        {connections.length > 0 && currentMetrics.length === 0 && (
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
            {/* Row 1: spend-focused KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label="Total Spend"
                value={fmt$(current.spend)}
                delta={calcDelta(current.spend, prior.spend)}
                invertDelta
                delay={0}
              />
              <MetricCard
                label="Conv. Value"
                value={fmt$(current.conversionValue)}
                delta={calcDelta(current.conversionValue, prior.conversionValue)}
                delay={1}
              />
              <MetricCard
                label="ROAS"
                value={fmtRoas(current.roas)}
                delta={calcDelta(current.roas, prior.roas)}
                delay={2}
              />
              <MetricCard
                label="Conversions"
                value={fmtNum(current.conversions)}
                delta={calcDelta(current.conversions, prior.conversions)}
                sub={current.cpl > 0 ? `${fmtCurrency(current.cpl)} CPL` : undefined}
                delay={3}
              />
            </div>

            {/* Row 2: engagement KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label="Clicks"
                value={fmtNum(current.clicks)}
                delta={calcDelta(current.clicks, prior.clicks)}
                sub={`${fmtPct(current.ctr)} CTR`}
                delay={0}
              />
              <MetricCard
                label="Avg. CPC"
                value={fmtCurrency(current.cpc)}
                delta={calcDelta(current.cpc, prior.cpc)}
                invertDelta
                delay={1}
              />
              <MetricCard
                label="Impressions"
                value={fmtNum(current.impressions)}
                delta={calcDelta(current.impressions, prior.impressions)}
                delay={2}
              />
              <MetricCard
                label="CPM"
                value={fmtCurrency(current.cpm)}
                delta={calcDelta(current.cpm, prior.cpm)}
                invertDelta
                delay={3}
              />
            </div>

            {/* Daily performance chart */}
            <div className="card p-6">
              <div className="mb-4">
                <h2 className="section-title">Daily Performance</h2>
                <p className="section-desc">{fmtDate(fromDate)} – {fmtDate(toDate)}</p>
              </div>
              <SpendChart data={dailyTrend} />
            </div>

            {/* Campaign breakdown */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="section-title">Campaigns</h2>
                  <p className="section-desc">{campaigns.length} campaigns</p>
                </div>
              </div>
              <CampaignTable campaigns={campaigns} />
            </div>
          </>
        )}

      </main>
    </div>
  )
}
