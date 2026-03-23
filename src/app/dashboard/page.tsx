// ─────────────────────────────────────────────────────────────────────────────
// Client Dashboard — /dashboard
//
// Two-level entry point:
//   /dashboard            → Platform overview cards (one per connected source)
//   /dashboard?source=X   → Campaign breakdown for that source
//
// Drill-down hierarchy: Platforms → Platform → Campaigns → Ad Sets → Ads
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Suspense } from 'react'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { summarizeMetrics, getDailyTrend, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency, applyAdFuel } from '@/lib/metrics'
import type { Client, ClientConnection, Connector, CampaignCategory } from '@/lib/types'
import MetricCard from '@/components/MetricCard'
import SpendChart from '@/components/SpendChart'
import CampaignTable from '@/components/CampaignTable'
import ExportButtons from '@/components/ExportButtons'
import DateRangePicker from '@/components/DateRangePicker'

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0]
}

const SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads:   'Meta Ads',
}

const SOURCE_ICONS: Record<string, string> = {
  google_ads: '🔵',
  meta_ads:   '🟦',
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

  // ─── Platform Overview (no source selected) ────────────────────────────────
  if (showOverview) {
    // Fetch aggregate metrics for every connection in parallel
    const platformData = await Promise.all(
      connections.map(async conn => {
        const table = conn.connector.type === 'google_ads' ? 'google_ads_metrics' : 'meta_ads_metrics'
        const { data } = await db
          .from(table)
          .select('spend,impressions,clicks,conversions,conversion_value,conversions_value')
          .eq('connection_id', conn.id)
          .gte('date', fmtDate(fromDate))
          .lte('date', fmtDate(toDate))

        const rows = (data ?? []) as Record<string, unknown>[]
        type PlatTotals = { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }
        const totals = rows.reduce<PlatTotals>(
          (acc, m) => ({
            spend:            acc.spend            + (Number(m.spend)            || 0),
            impressions:      acc.impressions      + (Number(m.impressions)      || 0),
            clicks:           acc.clicks           + (Number(m.clicks)           || 0),
            conversions:      acc.conversions      + (Number(m.conversions)      || 0),
            conversionValue:  acc.conversionValue  + (Number(m.conversion_value  || m.conversions_value) || 0),
          }),
          { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
        )

        return { conn, ...totals } as { conn: typeof conn } & PlatTotals
      })
    )

    const syncedAtAll = connections
      .map(c => c.last_synced_at)
      .filter(Boolean)
      .sort()
      .at(-1)

    const syncedAt = syncedAtAll
      ? new Date(syncedAtAll).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : null

    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <DashHeader
          settings={settings}
          client={client}
          syncedAt={syncedAt}
          fromDate={fromDate}
          toDate={toDate}
        />

        <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">
          <div>
            <h1 className="section-title text-lg">Advertising Platforms</h1>
            <p className="section-desc mt-0.5">Select a platform to view campaign performance</p>
          </div>

          {connections.length === 0 && (
            <div className="card p-12 text-center mt-4">
              <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                Your dashboard is being set up
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Your account manager will connect your ad accounts shortly.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {platformData.map(({ conn, spend, impressions, clicks, conversions, conversionValue }) => {
              const sourceType  = conn.connector.type
              const roas        = spend > 0 && conversionValue > 0 ? conversionValue / spend : 0
              const cpl         = conversions > 0 ? spend / conversions : 0
              const ctr         = impressions > 0 ? clicks / impressions : 0
              const displaySpend = adFuelCut > 0 ? applyAdFuel(spend, adFuelCut) : spend
              const syncedConn  = conn.last_synced_at
                ? new Date(conn.last_synced_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                : null
              const dateQuery = `from=${fmtDate(fromDate)}&to=${fmtDate(toDate)}`

              return (
                <Link
                  key={conn.id}
                  href={`/dashboard?source=${sourceType}&${dateQuery}`}
                  className="card block p-5 transition-all hover:shadow-md"
                  style={{
                    textDecoration: 'none',
                    borderColor: 'var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  {/* Platform header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{SOURCE_ICONS[sourceType] ?? '📊'}</span>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {SOURCE_LABELS[sourceType] ?? sourceType}
                        </p>
                        {conn.external_name && (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {conn.external_name}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-medium" style={{ color: 'var(--blue)' }}>
                      View Campaigns →
                    </span>
                  </div>

                  {/* Metrics */}
                  {spend > 0 ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {adFuelCut > 0 ? 'Ad Fuel Spend' : 'Spend'}
                        </span>
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {fmt$(displaySpend)}
                        </span>
                      </div>
                      {conversions > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {conversionValue > 0 ? 'Revenue' : 'Conversions'}
                          </span>
                          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            {conversionValue > 0 ? fmt$(conversionValue) : fmtNum(conversions)}
                          </span>
                        </div>
                      )}
                      {cpl > 0 && conversionValue === 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>CPL</span>
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {fmtCurrency(cpl)}
                          </span>
                        </div>
                      )}
                      <div
                        className="flex items-center justify-between pt-2"
                        style={{ borderTop: '1px solid var(--border-subtle)' }}
                      >
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {fmtNum(impressions)} impressions
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {fmtPct(ctr)} CTR
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
                      No data for this date range
                    </p>
                  )}

                  {syncedConn && (
                    <p className="text-xs mt-3" style={{ color: 'var(--text-faint)' }}>
                      Updated {syncedConn}
                    </p>
                  )}
                </Link>
              )
            })}
          </div>
        </main>
      </div>
    )
  }

  // ─── Campaign View (source selected) ──────────────────────────────────────
  const activeSource     = requestedSource!
  const activeConnection = connections.find(c => c.connector.type === activeSource)

  const categoriesResult = await db.from('campaign_categories').select('*').order('sort_order')
  const categories  = (categoriesResult.data ?? []) as CampaignCategory[]
  const categoryMap = new Map(categories.map(c => [c.id, c]))

  type NormRow = {
    campaign_id: string; campaign_name: string; date: string
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
    roas: number; ctr: number; cpc: number; cpm: number
  }

  let currentMetrics: NormRow[] = []
  let priorMetrics:   Omit<NormRow, 'campaign_id' | 'campaign_name' | 'date'>[] = []
  let lastSyncedAt:   string | null = null

  if (activeConnection) {
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

    const normalise = (rows: Record<string, unknown>[]): NormRow[] =>
      rows.map(m => ({
        campaign_id:      String(m.campaign_id   || ''),
        campaign_name:    String(m.campaign_name || ''),
        date:             String(m.date          || ''),
        spend:            Number(m.spend)         || 0,
        impressions:      Number(m.impressions)   || 0,
        clicks:           Number(m.clicks)        || 0,
        conversions:      Number(m.conversions)   || 0,
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

  const { data: assignmentsData } = await db
    .from('client_campaign_assignments')
    .select('campaign_id, category_id, hidden, category:campaign_categories(*)')
    .eq('client_id', client.id)
    .eq('source', activeSource)

  const assignmentMap = new Map(
    (assignmentsData ?? []).map((a: Record<string, unknown>) => [a.campaign_id as string, a])
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current    = summarizeMetrics(currentMetrics as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prior      = summarizeMetrics(priorMetrics as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dailyTrend = getDailyTrend(currentMetrics as any[])

  const assignmentModes = (assignmentsData ?? [])
    .map((a: Record<string, unknown>) => (a.category as Record<string, unknown> | null)?.display_mode as string | undefined)
    .filter(Boolean)
  const ecomCount  = assignmentModes.filter(m => m === 'ecommerce').length
  const leadCount  = assignmentModes.filter(m => m === 'lead_gen').length
  const isEcomDash = ecomCount > leadCount

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
      source:          activeSource as never,
      spend:           c.spend,
      impressions:     c.impressions,
      clicks:          c.clicks,
      conversions:     c.conversions,
      conversionValue: c.conversionValue,
      roas:            c.spend > 0 ? c.conversionValue / c.spend : 0,
      cpl:             c.conversions > 0 ? c.spend / c.conversions : 0,
      ctr:             c.impressions > 0 ? c.clicks / c.impressions : 0,
      cpm:             c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
      adFuelSpend:     applyAdFuel(c.spend, adFuelCut),
      category:        c.category ?? null,
      hidden:          false,
    }))
    .sort((a, b) => b.spend - a.spend)

  const syncedAt = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  const dateQuery = `from=${fmtDate(fromDate)}&to=${fmtDate(toDate)}`

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <DashHeader
        settings={settings}
        client={client}
        syncedAt={syncedAt}
        fromDate={fromDate}
        toDate={toDate}
      />

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* ── Breadcrumb + back link ─────────────────────────── */}
        <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link href={`/dashboard?${dateQuery}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>
            ← Platforms
          </Link>
          <span style={{ color: 'var(--border)' }}>/</span>
          <span style={{ color: 'var(--text-primary)' }}>
            {SOURCE_LABELS[activeSource] ?? activeSource}
          </span>
        </div>

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
            {/* Row 1: primary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label={adFuelCut > 0 ? 'Ad Fuel Spend' : 'Total Spend'}
                value={fmt$(adFuelCut > 0 ? applyAdFuel(current.spend, adFuelCut) : current.spend)}
                delta={calcDelta(current.spend, prior.spend)}
                invertDelta
                sub={undefined}
                delay={0}
              />
              {isEcomDash ? (
                <>
                  <MetricCard
                    label="ROAS"
                    value={fmtRoas(current.roas)}
                    delta={calcDelta(current.roas, prior.roas)}
                    delay={1}
                  />
                  <MetricCard
                    label="Revenue"
                    value={fmt$(current.conversionValue)}
                    delta={calcDelta(current.conversionValue, prior.conversionValue)}
                    delay={2}
                  />
                  <MetricCard
                    label="Orders"
                    value={fmtNum(current.conversions)}
                    delta={calcDelta(current.conversions, prior.conversions)}
                    delay={3}
                  />
                </>
              ) : (
                <>
                  <MetricCard
                    label="Leads"
                    value={fmtNum(current.conversions)}
                    delta={calcDelta(current.conversions, prior.conversions)}
                    delay={1}
                  />
                  <MetricCard
                    label="CPL"
                    value={current.cpl > 0 ? fmtCurrency(current.cpl) : '—'}
                    delta={calcDelta(current.cpl, prior.cpl)}
                    invertDelta
                    delay={2}
                  />
                  <MetricCard
                    label="Clicks"
                    value={fmtNum(current.clicks)}
                    delta={calcDelta(current.clicks, prior.clicks)}
                    sub={`${fmtPct(current.ctr)} CTR`}
                    delay={3}
                  />
                </>
              )}
            </div>

            {/* Row 2: secondary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {isEcomDash ? (
                <>
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
                </>
              ) : (
                <>
                  <MetricCard
                    label="CTR"
                    value={fmtPct(current.ctr)}
                    delta={calcDelta(current.ctr, prior.ctr)}
                    delay={0}
                  />
                  <MetricCard
                    label="Avg. CPC"
                    value={fmtCurrency(current.cpc)}
                    delta={calcDelta(current.cpc, prior.cpc)}
                    invertDelta
                    delay={1}
                  />
                </>
              )}
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
              <CampaignTable
                campaigns={campaigns}
                adFuelCut={adFuelCut}
                isEcomDash={isEcomDash}
                connectionId={activeConnection?.id}
                dateFrom={fmtDate(fromDate)}
                dateTo={fmtDate(toDate)}
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
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any
  client: Client
  syncedAt: string | null
  fromDate: Date
  toDate: Date
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
          <DateRangePicker from={fromDate.toISOString().split('T')[0]} to={toDate.toISOString().split('T')[0]} />
        </div>
      </div>
    </header>
  )
}
