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
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { summarizeMetrics, getDailyTrend, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency, applyAdFuel } from '@/lib/metrics'
import type { Client, ClientConnection, Connector, MetaAction } from '@/lib/types'
import { ConnectorLogo } from '@/components/ConnectorLogo'
import MetricCard from '@/components/MetricCard'
import SpendChart from '@/components/SpendChart'
import CampaignTable from '@/components/CampaignTable'
import ExportButtons from '@/components/ExportButtons'
import DateRangePicker from '@/components/DateRangePicker'

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
  const isMetaSource     = activeSource === 'meta_ads'

  // Fetch metrics AND campaign assignments in parallel so we can remap
  // Meta conversions based on the per-campaign display_mode before summarising.
  const [curRes, priorRes, assignmentsRes] = await Promise.all([
    activeConnection
      ? db.from(table)
          .select('*')
          .eq('connection_id', activeConnection.id)
          .gte('date', fmtDate(fromDate))
          .lte('date', fmtDate(toDate))
      : Promise.resolve({ data: [] }),
    activeConnection
      ? db.from(table)
          .select('spend,impressions,clicks,conversions,conversion_value,conversions_value,actions,action_values')
          .eq('connection_id', activeConnection.id)
          .gte('date', fmtDate(priorFrom))
          .lte('date', fmtDate(priorTo))
      : Promise.resolve({ data: [] }),
    db.from('client_campaign_assignments')
      .select('campaign_id, display_mode, hidden')
      .eq('client_id', client.id)
      .eq('source', activeSource),
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
          const actions      = m.actions as MetaAction[]
          const actionValues = (m.action_values as MetaAction[] | null) ?? []
          const found        = actions.find(a => a.action_type === campConvAction)
          const foundVal     = actionValues.find(a => a.action_type === campConvAction)
          if (found)    conversions      = parseFloat(found.value    || '0')
          if (foundVal) conversion_value = parseFloat(foundVal.value || '0')
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
  const priorMetrics   = normalise((priorRes.data ?? []) as Record<string, unknown>[])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current    = summarizeMetrics(currentMetrics as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prior      = summarizeMetrics(priorMetrics as any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dailyTrend = getDailyTrend(currentMetrics as any[])

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
