// Admin Preview Dashboard — /admin/preview/[clientId]
// Same data as the client dashboard but auth'd via admin session + clientId URL param.

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import { summarizeMetrics, getDailyTrend, calcDelta, fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency, applyAdFuel } from '@/lib/metrics'
import type { Client, ClientConnection, Connector, MetaAction } from '@/lib/types'
import { ConnectorLogo } from '@/components/ConnectorLogo'
import MetricCard from '@/components/MetricCard'
import SpendChart from '@/components/SpendChart'
import CampaignTable from '@/components/CampaignTable'
import DateRangePicker from '@/components/DateRangePicker'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }

const SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads:   'Meta Ads',
}

export default async function AdminPreviewPage({
  params,
  searchParams,
}: {
  params:       Promise<{ clientId: string }>
  searchParams: Promise<{ from?: string; to?: string; source?: string; compare?: string }>
}) {
  const { clientId } = await params
  const db = createAdminClient()

  const { data: clientData } = await db.from('clients').select('*').eq('id', clientId).single()
  const client = clientData as Client | null
  if (!client) redirect('/admin/clients')

  const sp       = await searchParams
  const toDate   = sp.to   ? new Date(sp.to)   : new Date()
  const fromDate = sp.from ? new Date(sp.from)  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const compare  = sp.compare ?? 'none'

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
      .eq('client_id', clientId)
      .eq('status', 'active'),
  ])

  const connections = (connectionsRes.data ?? []) as (ClientConnection & {
    connector: Pick<Connector, 'id' | 'type' | 'label'>
  })[]

  const adFuelCut        = client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut
  const availableSources = connections.map(c => c.connector.type)
  const requestedSource  = sp.source as string | undefined
  const showOverview     = !requestedSource || !availableSources.includes(requestedSource as never)

  const baseUrl    = `/admin/preview/${clientId}`
  const dateQuery  = `from=${fmtDate(fromDate)}&to=${fmtDate(toDate)}${compare !== 'none' ? `&compare=${compare}` : ''}`

  if (showOverview) {
    if (connections.length === 0) {
      return (
        <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
          <AdminPreviewHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} baseUrl={baseUrl} />
          <main className="max-w-7xl mx-auto px-6 py-6">
            <div className="card p-12 text-center mt-4">
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>No data connections configured for this client.</p>
            </div>
          </main>
        </div>
      )
    }
    const defaultSource = availableSources.includes('google_ads') ? 'google_ads'
      : availableSources.includes('meta_ads') ? 'meta_ads' : availableSources[0]
    redirect(`${baseUrl}?source=${defaultSource}&${dateQuery}`)
  }

  const activeSource     = requestedSource!
  const activeConnection = connections.find(c => c.connector.type === activeSource)
  const table            = activeSource === 'google_ads' ? 'google_ads_metrics' : 'meta_ads_metrics'
  const adLevelTable     = activeSource === 'google_ads' ? 'google_ads_ad_metrics' : 'meta_ads_ad_metrics'
  const adLevelSelect    = activeSource === 'google_ads'
    ? 'campaign_id,spend,impressions,clicks,conversions,conversions_value,date'
    : 'campaign_id,spend,impressions,clicks,conversions,conversion_value,actions,action_values,date'
  const isMetaSource     = activeSource === 'meta_ads'

  const [curRes, priorRes, assignmentsRes] = await Promise.all([
    activeConnection
      ? db.from(table).select('*').eq('connection_id', activeConnection.id)
          .gte('date', fmtDate(fromDate)).lte('date', fmtDate(toDate))
      : Promise.resolve({ data: [] }),
    showCompare && activeConnection
      ? db.from(adLevelTable).select(adLevelSelect)
          .eq('client_id', clientId)
          .gte('date', fmtDate(priorFrom)).lte('date', fmtDate(priorTo))
      : Promise.resolve({ data: [] }),
    db.from('client_campaign_assignments').select('campaign_id, display_mode, hidden')
      .eq('client_id', clientId).eq('source', activeSource),
  ])

  const assignmentsData = (assignmentsRes.data ?? []) as { campaign_id: string; display_mode: string; hidden: boolean }[]
  const assignmentMap   = new Map(assignmentsData.map(a => [a.campaign_id, a]))
  const lastSyncedAt    = activeConnection?.last_synced_at ?? null
  const ecomCount       = assignmentsData.filter(a => a.display_mode === 'ecommerce').length
  const leadCount       = assignmentsData.filter(a => a.display_mode !== 'ecommerce').length
  const isEcomDash      = ecomCount > leadCount

  type NormRow = {
    campaign_id: string; campaign_name: string; date: string
    spend: number; impressions: number; clicks: number
    conversions: number; conversion_value: number
    roas: number; ctr: number; cpc: number; cpm: number
  }

  function normalise(rows: Record<string, unknown>[]): NormRow[] {
    return rows.map(m => {
      let conversions      = Number(m.conversions) || 0
      let conversion_value = Number(m.conversion_value || m.conversions_value || 0)
      if (isMetaSource && Array.isArray(m.actions)) {
        const campaignIsEcom = (assignmentMap.get(String(m.campaign_id || ''))?.display_mode ?? 'lead_gen') === 'ecommerce'
        const campConvAction = campaignIsEcom ? (client!.purchase_action ?? null) : (client!.lead_action ?? null)
        if (campConvAction) {
          const actions      = m.actions as MetaAction[]
          const actionValues = (m.action_values as MetaAction[] | null) ?? []
          const found        = actions.find(a => a.action_type === campConvAction)
          const foundVal     = actionValues.find(a => a.action_type === campConvAction)
          conversions      = found    ? parseFloat(found.value    || '0') : 0
          conversion_value = foundVal ? parseFloat(foundVal.value || '0') : 0
        }
      }
      return {
        campaign_id: String(m.campaign_id || ''), campaign_name: String(m.campaign_name || ''),
        date: String(m.date || ''), spend: Number(m.spend) || 0, impressions: Number(m.impressions) || 0,
        clicks: Number(m.clicks) || 0, conversions, conversion_value,
        roas: Number(m.roas) || 0, ctr: Number(m.ctr) || 0, cpc: Number(m.cpc) || 0, cpm: Number(m.cpm) || 0,
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

  const campMap = new Map<string, { name: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; display_mode: string }>()
  for (const row of currentMetrics) {
    const assignment = assignmentMap.get(row.campaign_id)
    if (assignment?.hidden) continue
    const mode = assignment?.display_mode ?? 'lead_gen'
    const ex   = campMap.get(row.campaign_id)
    if (ex) {
      ex.spend += row.spend; ex.impressions += row.impressions; ex.clicks += row.clicks
      ex.conversions += row.conversions; ex.conversionValue += row.conversion_value
    } else {
      campMap.set(row.campaign_id, { name: row.campaign_name, spend: row.spend, impressions: row.impressions,
        clicks: row.clicks, conversions: row.conversions, conversionValue: row.conversion_value, display_mode: mode })
    }
  }

  const campaigns = Array.from(campMap.entries()).map(([id, c]) => {
    const dSpend = adFuelCut > 0 ? applyAdFuel(c.spend, adFuelCut) : c.spend
    return {
      campaign_id: id, campaign_name: c.name, source: activeSource as never,
      spend: c.spend, impressions: c.impressions, clicks: c.clicks,
      conversions: c.conversions, conversionValue: c.conversionValue,
      roas: dSpend > 0 ? c.conversionValue / dSpend : 0,
      cpl: c.conversions > 0 ? dSpend / c.conversions : 0,
      ctr: c.impressions > 0 ? c.clicks / c.impressions : 0,
      cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
      adFuelSpend: applyAdFuel(c.spend, adFuelCut), display_mode: c.display_mode, hidden: false,
    }
  }).sort((a, b) => b.spend - a.spend)

  const syncedAt = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <AdminPreviewHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} syncedAt={syncedAt} baseUrl={baseUrl} />

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Platform pills */}
        {connections.length > 1 && (
          <div className="flex items-center gap-2">
            {connections.map(conn => {
              const isActive = conn.connector.type === activeSource
              return (
                <Link key={conn.id} href={`${baseUrl}?source=${conn.connector.type}&${dateQuery}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                    padding: '0.375rem 1rem', borderRadius: '9999px', fontSize: '0.8125rem',
                    fontWeight: 600, textDecoration: 'none', transition: 'all 0.15s',
                    background: isActive ? 'var(--blue)' : 'var(--bg-subtle)',
                    color:      isActive ? '#fff' : 'var(--text-muted)',
                    border:     isActive ? '1px solid var(--blue)' : '1px solid var(--border)',
                  }}>
                  <ConnectorLogo type={conn.connector.type} size={16} />
                  {SOURCE_LABELS[conn.connector.type] ?? conn.connector.type}
                </Link>
              )
            })}
          </div>
        )}

        {!activeConnection && (
          <div className="card p-12 text-center mt-4">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No connection found for this platform.</p>
          </div>
        )}

        {activeConnection && currentMetrics.length === 0 && (
          <div className="card p-10 text-center">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No data for this date range</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Try selecting a different date range.</p>
          </div>
        )}

        {currentMetrics.length > 0 && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label={adFuelCut > 0 ? 'Ad Fuel Spend' : 'Total Spend'}
                value={fmt$(adFuelCut > 0 ? applyAdFuel(current.spend, adFuelCut) : current.spend)}
                delta={showCompare ? calcDelta(current.spend, prior.spend) : undefined} invertDelta delay={0} />
              {isEcomDash ? (
                <>
                  <MetricCard label="ROAS"    value={fmtRoas(current.roas)}        delta={showCompare ? calcDelta(current.roas, prior.roas) : undefined} delay={1} />
                  <MetricCard label="Revenue" value={fmt$(current.conversionValue)} delta={showCompare ? calcDelta(current.conversionValue, prior.conversionValue) : undefined} delay={2} />
                  <MetricCard label="Orders"  value={fmtNum(current.conversions)}  delta={showCompare ? calcDelta(current.conversions, prior.conversions) : undefined} delay={3} />
                </>
              ) : (
                <>
                  <MetricCard label="Leads"  value={fmtNum(current.conversions)} delta={showCompare ? calcDelta(current.conversions, prior.conversions) : undefined} delay={1} />
                  <MetricCard label="CPL"    value={current.cpl > 0 ? fmtCurrency(current.cpl) : '—'} delta={showCompare ? calcDelta(current.cpl, prior.cpl) : undefined} invertDelta delay={2} />
                  <MetricCard label="Clicks" value={fmtNum(current.clicks)} delta={showCompare ? calcDelta(current.clicks, prior.clicks) : undefined} sub={`${fmtPct(current.ctr)} CTR`} delay={3} />
                </>
              )}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {isEcomDash ? (
                <>
                  <MetricCard label="Clicks"   value={fmtNum(current.clicks)}    delta={showCompare ? calcDelta(current.clicks, prior.clicks) : undefined} sub={`${fmtPct(current.ctr)} CTR`} delay={0} />
                  <MetricCard label="Avg. CPC" value={fmtCurrency(current.cpc)}  delta={showCompare ? calcDelta(current.cpc, prior.cpc) : undefined} invertDelta delay={1} />
                </>
              ) : (
                <>
                  <MetricCard label="CTR"      value={fmtPct(current.ctr)}       delta={showCompare ? calcDelta(current.ctr, prior.ctr) : undefined} delay={0} />
                  <MetricCard label="Avg. CPC" value={fmtCurrency(current.cpc)}  delta={showCompare ? calcDelta(current.cpc, prior.cpc) : undefined} invertDelta delay={1} />
                </>
              )}
              <MetricCard label="Impressions" value={fmtNum(current.impressions)} delta={showCompare ? calcDelta(current.impressions, prior.impressions) : undefined} delay={2} />
              <MetricCard label="CPM"         value={fmtCurrency(current.cpm)}    delta={showCompare ? calcDelta(current.cpm, prior.cpm) : undefined} invertDelta delay={3} />
            </div>

            <div className="card p-6">
              <div className="mb-4">
                <h2 className="section-title">Daily Performance</h2>
                <p className="section-desc">
                  {fmtDate(fromDate)} – {fmtDate(toDate)}
                  {showCompare && <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>vs {fmtDate(priorFrom)} – {fmtDate(priorTo)}</span>}
                </p>
              </div>
              <SpendChart data={dailyTrend} priorData={showCompare ? getDailyTrend(priorMetrics as never[]) : undefined} />
            </div>

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
                campaignBasePath={`${baseUrl}/campaign`}
              />
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ─── Admin Preview Header ──────────────────────────────────────────────────

function AdminPreviewHeader({
  client, fromDate, toDate, compare, syncedAt, baseUrl,
}: {
  client: Client; fromDate: Date; toDate: Date; compare?: string; syncedAt?: string | null; baseUrl: string
}) {
  const from = fromDate.toISOString().split('T')[0]
  const to   = toDate.toISOString().split('T')[0]
  return (
    <>
      {/* Dashboard header */}
      <header className="sticky top-0 z-10 border-b" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {client.logo_url && <img src={client.logo_url} alt={client.name} className="h-5 object-contain flex-shrink-0" />}
            <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{client.name}</span>
            {syncedAt && <span className="text-xs hidden md:inline" style={{ color: 'var(--text-faint)' }}>Updated {syncedAt}</span>}
          </div>
          <Suspense fallback={null}>
            <DateRangePicker from={from} to={to} compare={compare} />
          </Suspense>
        </div>
      </header>
    </>
  )
}
