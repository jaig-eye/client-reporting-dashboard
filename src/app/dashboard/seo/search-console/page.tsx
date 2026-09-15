// ─────────────────────────────────────────────────────────────────────────────
// GSC Search Console Page — /dashboard/seo/search-console
// Shows total clicks, impressions, avg CTR, avg position from Google Search Console
// with top queries and top pages breakdowns. Data is fetched live from the GSC API
// (cached 15min via unstable_cache) rather than from a DB sync.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers'
import { isDashboardV2 } from '@/lib/dashboardVersion'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveDashboardRange } from '@/lib/dateRange'
import type { Client, ClientConnection, Connector } from '@/lib/types'
import { getAgencySettings } from '@/lib/agency-settings'
import { GscQueriesTable, GscPagesTable } from './GscSortableTable'
import GscTrendChart from './GscTrendChart'
import type { GscDailyPoint } from './GscTrendChart'
import { fetchGSCLiveData } from '@/lib/gsc-live'
import type { GSCSummaryResult } from '@/lib/gsc-live'
import PageHeader from '@/components/dashboard/PageHeader'
import EmptyState from '@/components/dashboard/EmptyState'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

// Cache GSC live API calls for 15 minutes. Busted by revalidateTag('client-metrics') in sync cron.
const _getCachedGSCLive = unstable_cache(
  async (
    connectionId: string,
    from: string, to: string,
    compFrom: string | null, compTo: string | null,
    showCompare: boolean,
  ) => {
    const [curr, comp] = await Promise.all([
      fetchGSCLiveData(connectionId, from, to, 25),
      showCompare && compFrom && compTo
        ? fetchGSCLiveData(connectionId, compFrom, compTo, 25)
        : Promise.resolve(null),
    ])
    return { curr, comp }
  },
  ['dashboard-gsc-live'],
  { revalidate: 900, tags: ['client-metrics'] }
)

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(2)}%` }
function fmtPos(n: number) { return n.toFixed(1) }
function calcDelta(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
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

  // This page's content moved into the combined report on the rebuilt dashboard.
  if (isDashboardV2(client, cookieStore)) redirect('/dashboard/seo')

  // Default end to yesterday (GSC data has a 2-3 day delay; today adds partial noise)
  const { fromDate, toDate } = resolveDashboardRange(params)
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
        <PageHeader title="SEO — Search Console" accent="#4285f4" fromDate={fromDate} toDate={toDate} compare={compare} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <EmptyState
            title="Search Console not connected"
            description="Ask your account manager to connect your Google Search Console property to start seeing organic search data here."
            icon={<MagnifyingGlass size={22} />}
          />
        </main>
      </div>
    )
  }

  const primaryConnectionId = gscConnections[0].id

  const [{ curr: currRaw, comp: compRaw }, settings] = await Promise.all([
    _getCachedGSCLive(
      primaryConnectionId,
      fmtDate(fromDate), fmtDate(toDate),
      compFrom ? fmtDate(compFrom) : null,
      compTo   ? fmtDate(compTo)   : null,
      showCompare,
    ),
    getAgencySettings(),
  ])

  const curr = currRaw as GSCSummaryResult | null
  const comp = compRaw as GSCSummaryResult | null

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
        <PageHeader title="SEO — Search Console" accent="#4285f4" fromDate={fromDate} toDate={toDate} compare={compare} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <EmptyState title="No data for this date range" description="Try selecting a wider date range, or wait for the next sync." icon={<MagnifyingGlass size={22} />} />
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
      <PageHeader title="SEO — Search Console" accent="#4285f4" fromDate={fromDate} toDate={toDate} compare={compare} />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Sparse data notice */}
        {showCoverageNotice && (
          <div style={{ padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--amber-subtle)', border: '1px solid var(--amber)', fontSize: '0.8125rem', color: 'var(--amber)', lineHeight: 1.5 }}>
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
              <div key={card.label} className="card p-4 sm:p-5 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
                  {card.label}
                </p>
                <p className="kpi-card__value text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
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
                    { label: 'Top 3',       value: dist.top3,   color: 'var(--green)', bg: 'var(--green-subtle)' },
                    { label: 'Page 1 (4–10)', value: dist.page1, color: 'var(--amber)', bg: 'var(--amber-subtle)' },
                    { label: 'Page 2 (11–20)', value: dist.page2, color: 'var(--text-muted)', bg: 'var(--bg-subtle)' },
                    { label: 'Beyond 20',   value: dist.beyond, color: 'var(--text-faint)', bg: 'var(--bg-muted)' },
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
            <div className="table-scroll">
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
            <div className="table-scroll">
              <GscPagesTable rows={topPages} showCompare={showCompare} />
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
