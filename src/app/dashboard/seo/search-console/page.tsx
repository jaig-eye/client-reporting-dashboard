// ─────────────────────────────────────────────────────────────────────────────
// GSC Search Console Page — /dashboard/seo/search-console
// Shows total clicks, impressions, avg CTR, avg position from Google Search Console
// with top queries and top pages breakdowns.
//
// Data is aggregated in Postgres via get_gsc_summary() RPC to avoid timeouts
// on large clients with 90-day ranges.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import type { Client, ClientConnection, Connector } from '@/lib/types'
import DateRangePicker from '@/components/DateRangePicker'
import { getAgencySettings } from '@/lib/agency-settings'
import { GscQueriesTable, GscPagesTable } from './GscSortableTable'
import GscTrendChart from './GscTrendChart'
import type { GscDailyPoint } from './GscTrendChart'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(2)}%` }
function fmtPos(n: number) { return n.toFixed(1) }
function calcDelta(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

type GscSummaryRow = {
  query?:      string
  page?:       string
  clicks:      number
  impressions: number
  ctr:         number
  position:    number
}

export default async function SearchConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>
}) {
  const cookieStore = await cookies()
  const db          = createAdminClient()
  const params      = await searchParams

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const { data: clientData } = await db.from('clients').select('*').eq('dashboard_token', token).single()
  const client = clientData as Client | null
  if (!client) redirect('/access')

  // Default end to yesterday (GSC data has a 2-3 day delay; today adds partial noise)
  const toDate   = params.to   ? new Date(params.to)   : new Date(Date.now() - 86_400_000)
  const fromDate = params.from ? new Date(params.from)  : new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
  const compare  = params.compare ?? 'none'

  // Compute comparison date range
  const showCompare = compare === 'prior_period' || compare === 'last_year'
  let compFrom: Date | null = null
  let compTo:   Date | null = null
  if (showCompare) {
    if (compare === 'last_year') {
      compFrom = new Date(fromDate); compFrom.setFullYear(compFrom.getFullYear() - 1)
      compTo   = new Date(toDate);   compTo.setFullYear(compTo.getFullYear() - 1)
    } else {
      const ms = toDate.getTime() - fromDate.getTime()
      compTo   = new Date(fromDate.getTime() - 86400000)
      compFrom = new Date(compTo.getTime() - ms)
    }
  }

  // Find active GSC connections
  const { data: connData } = await db
    .from('client_connections')
    .select('*, connector:connectors(id, type, label)')
    .eq('client_id', client.id)
    .eq('status', 'active')

  const connections = (connData ?? []) as (ClientConnection & { connector: Pick<Connector, 'id' | 'type' | 'label'> })[]
  const gscConnections = connections.filter(c => c.connector.type === 'google_search_console')

  if (gscConnections.length === 0) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <EmptyState
            title="Search Console not connected"
            description="Ask your account manager to connect your Google Search Console property to start seeing organic search data here."
          />
        </main>
      </div>
    )
  }

  // Fetch GSC summary via aggregate RPC — avoids the PostgREST row-limit issue.
  // Raw gsc_metrics stores one row per (date, query, page) — a busy site produces
  // 3,000+ rows/day, so PostgREST's row limit would truncate to the oldest ~3 days.
  // The RPC aggregates everything in Postgres and returns compact summary objects.
  const primaryConnectionId = gscConnections[0].id

  type GscRpcResult = {
    totals:       { clicks: number; impressions: number; ctr: number; position: number }
    queries:      GscSummaryRow[]
    pages:        GscSummaryRow[]
    daily:        Array<{ date: string; clicks: number; impressions: number }>
    distribution: { top3: number; page1: number; page2: number; beyond: number }
  }

  const rpcBase = { p_client_id: client.id, p_connection_id: primaryConnectionId, p_top_n: 25 }
  const [{ data: currRpc }, { data: compRpc }, settings] = await Promise.all([
    db.rpc('get_gsc_summary', { ...rpcBase, p_date_from: fmtDate(fromDate), p_date_to: fmtDate(toDate) }),
    showCompare && compFrom && compTo
      ? db.rpc('get_gsc_summary', { ...rpcBase, p_date_from: fmtDate(compFrom), p_date_to: fmtDate(compTo) })
      : Promise.resolve({ data: null }),
    getAgencySettings(),
  ])

  const curr = currRpc as GscRpcResult | null
  const comp = compRpc as GscRpcResult | null

  // ── Daily trend data (for chart) ──────────────────────────────────────────
  const dailyData: GscDailyPoint[] = (curr?.daily ?? []).map(d => ({
    date:        d.date,
    clicks:      d.clicks,
    impressions: d.impressions,
    ctr:         d.impressions > 0 ? d.clicks / d.impressions : 0,
  }))

  // ── Position distribution (from RPC — computed in Postgres) ───────────────
  const dist = curr?.distribution ?? { top3: 0, page1: 0, page2: 0, beyond: 0 }

  const hasData = (curr?.totals?.clicks ?? 0) > 0 || (curr?.totals?.impressions ?? 0) > 0
  if (!curr || !hasData) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <EmptyState title="No data for this date range" description="Try selecting a wider date range, or wait for the next sync." />
        </main>
      </div>
    )
  }

  // Totals from RPC
  const clicks      = curr.totals.clicks      ?? 0
  const impressions = curr.totals.impressions  ?? 0
  const avgCtr      = curr.totals.ctr          ?? 0
  const avgPosition = curr.totals.position     ?? 0

  // Comparison totals
  const compClicks      = comp?.totals?.clicks      ?? 0
  const compImpressions = comp?.totals?.impressions ?? 0
  const compAvgCtr      = comp?.totals?.ctr         ?? 0
  const compAvgPosition = comp?.totals?.position    ?? 0

  // Build comparison position maps for per-query/page delta
  const compQueryPosMap = new Map<string, number>()
  const compPagePosMap  = new Map<string, number>()
  if (comp) {
    for (const q of (comp.queries ?? [])) if (q.query) compQueryPosMap.set(q.query, q.position)
    for (const p of (comp.pages   ?? [])) if (p.page)  compPagePosMap.set(p.page,   p.position)
  }

  // Top queries — add position delta vs comparison period
  const topQueries = (curr.queries ?? []).map(q => ({
    query:         q.query ?? '',
    clicks:        q.clicks,
    impressions:   q.impressions,
    ctr:           q.ctr,
    position:      q.position,
    positionDelta: showCompare && q.query && compQueryPosMap.has(q.query)
      ? q.position - compQueryPosMap.get(q.query)!
      : null,
  }))

  // Top pages — add position delta vs comparison period
  const topPages = (curr.pages ?? []).map(p => ({
    page:          p.page ?? '',
    clicks:        p.clicks,
    impressions:   p.impressions,
    ctr:           p.ctr,
    position:      p.position,
    positionDelta: showCompare && p.page && compPagePosMap.has(p.page)
      ? p.position - compPagePosMap.get(p.page)!
      : undefined,
  }))

  const metricCards = [
    {
      label: 'Organic Clicks', value: fmtNum(clicks),      color: '#10b981',
      delta: showCompare ? calcDelta(clicks, compClicks) : null,
    },
    {
      label: 'Impressions',    value: fmtNum(impressions),  color: '#3b82f6',
      delta: showCompare ? calcDelta(impressions, compImpressions) : null,
    },
    {
      label: 'Avg. CTR',       value: fmtPct(avgCtr),       color: '#8b5cf6',
      delta: showCompare ? calcDelta(avgCtr, compAvgCtr) : null,
    },
    {
      label: 'Avg. Position',  value: fmtPos(avgPosition),  color: '#f59e0b',
      // Position: lower is better → invert sign for colour logic
      delta: showCompare ? calcDelta(avgPosition, compAvgPosition) : null,
      invertDelta: true,
    },
  ]

  // ── Sparse-data coverage notice ────────────────────────────────────────────
  const requestedDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000)
  const availableDays = dailyData.length
  const latestAvailable = dailyData[dailyData.length - 1]?.date ?? null
  // Show notice when data covers less than 50% of the requested window
  const showCoverageNotice = availableDays > 0 && availableDays < requestedDays * 0.5

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Sparse data notice */}
        {showCoverageNotice && (
          <div style={{ padding: '0.75rem 1rem', borderRadius: 8, background: '#fefce8', border: '1px solid #fde047', fontSize: '0.8125rem', color: '#713f12', lineHeight: 1.5 }}>
            <strong>Limited data coverage:</strong> Only {availableDays} of {requestedDays} days have data
            {latestAvailable ? ` (through ${latestAvailable})` : ''}.
            {' '}A full backfill sync is needed to populate the complete history for this date range.
            Contact your account manager or run a manual backfill from the admin panel.
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {metricCards.map(card => {
            const positive = card.invertDelta ? (card.delta !== null && card.delta < 0) : (card.delta !== null && card.delta >= 0)
            return (
              <div key={card.label} className="card p-5">
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
                  {card.label}
                </p>
                <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
                {card.delta !== null && (
                  <p style={{
                    fontSize: '0.75rem', fontWeight: 600, marginTop: 3,
                    color: positive ? 'var(--green)' : 'var(--red)',
                  }}>
                    {card.delta >= 0 ? '▲' : '▼'} {Math.abs(card.delta).toFixed(1)}%
                  </p>
                )}
                <div style={{ width: '100%', height: 3, borderRadius: 9999, background: 'var(--border)', marginTop: 8 }}>
                  <div style={{ width: '60%', height: '100%', borderRadius: 9999, background: card.color }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Trend chart */}
        {dailyData.length > 1 && (
          <div className="card p-6">
            <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="section-title">Clicks &amp; Impressions</h2>
                <p className="section-desc">Daily organic clicks (bars) and impressions (line) over the selected period</p>
              </div>
              {(dist.top3 + dist.page1 + dist.page2 + dist.beyond) > 0 && (
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Top 3',       value: dist.top3,   color: '#16a34a', bg: '#dcfce7' },
                    { label: 'Page 1 (4–10)', value: dist.page1, color: '#d97706', bg: '#fef3c7' },
                    { label: 'Page 2 (11–20)', value: dist.page2, color: 'var(--text-muted)', bg: 'var(--bg-subtle,#f8f9fa)' },
                    { label: 'Beyond 20',   value: dist.beyond, color: 'var(--text-faint)', bg: 'var(--bg-muted,#f3f4f6)' },
                  ].filter(s => s.value > 0).map(s => (
                    <span key={s.label} style={{
                      fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                      background: s.bg, color: s.color, whiteSpace: 'nowrap',
                    }}>
                      {s.label}: {s.value.toLocaleString()}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <GscTrendChart
              data={dailyData}
              colorClicks={settings.chart_color_spend}
              colorImpressions={settings.chart_color_prior_spend}
            />
          </div>
        )}

        {/* Top Queries */}
        {topQueries.length > 0 && (
          <div className="card p-6">
            <div className="mb-4">
              <h2 className="section-title">Top Queries</h2>
              <p className="section-desc">Top {topQueries.length} queries by organic clicks · click column headers to sort</p>
            </div>
            <div className="overflow-x-auto">
              <GscQueriesTable rows={topQueries} showCompare={showCompare} />
            </div>
          </div>
        )}

        {/* Top Pages */}
        {topPages.length > 0 && (
          <div className="card p-6">
            <div className="mb-4">
              <h2 className="section-title">Top Pages</h2>
              <p className="section-desc">Top {topPages.length} pages by organic clicks · click column headers to sort</p>
            </div>
            <div className="overflow-x-auto">
              <GscPagesTable rows={topPages} showCompare={showCompare} />
            </div>
          </div>
        )}

      </main>
    </div>
  )
}

function PageHeader({ client, fromDate, toDate, compare }: { client: Client; fromDate: Date; toDate: Date; compare: string }) {
  return (
    <div className="max-w-7xl mx-auto px-6 pt-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4285f4', flexShrink: 0 }} />
        <h1 className="font-semibold text-base" style={{ color: 'var(--text-primary)', margin: 0 }}>SEO — Search Console</h1>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Suspense fallback={null}>
          <DateRangePicker from={fromDate.toISOString().split('T')[0]} to={toDate.toISOString().split('T')[0]} compare={compare} />
        </Suspense>
      </div>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="card p-12 text-center">
      <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '1.5rem' }}>
        🔍
      </div>
      <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{description}</p>
    </div>
  )
}
