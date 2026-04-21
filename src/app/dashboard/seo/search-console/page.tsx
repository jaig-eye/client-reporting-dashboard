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
import ExportButtons from '@/components/ExportButtons'
import { GscQueriesTable, GscPagesTable } from './GscSortableTable'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(2)}%` }
function fmtPos(n: number) { return n.toFixed(1) }
function calcDelta(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

type GscSummaryTotals = {
  clicks:      number | null
  impressions: number | null
  ctr:         number | null
  position:    number | null
}
type GscSummaryRow = {
  query?:      string
  page?:       string
  clicks:      number
  impressions: number
  ctr:         number
  position:    number
}
type GscSummary = {
  totals:  GscSummaryTotals
  queries: GscSummaryRow[]
  pages:   GscSummaryRow[]
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

  const toDate   = params.to   ? new Date(params.to)   : new Date()
  const fromDate = params.from ? new Date(params.from)  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
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

  // Fetch current and comparison periods via direct DB queries — no Postgres function required.
  // Aggregation is done in JS (same approach as GSCSummaryCard on the main dashboard).
  type GscRawRow = { clicks: number; impressions: number; ctr: number; position: number; query: string | null; page: string | null }
  const gscSelect = 'clicks,impressions,ctr,position,query,page'

  const [{ data: currRows }, { data: compRows }] = await Promise.all([
    db.from('gsc_metrics')
      .select(gscSelect)
      .eq('client_id', client.id)
      .gte('date', fmtDate(fromDate))
      .lte('date', fmtDate(toDate)),
    showCompare && compFrom && compTo
      ? db.from('gsc_metrics')
          .select(gscSelect)
          .eq('client_id', client.id)
          .gte('date', fmtDate(compFrom))
          .lte('date', fmtDate(compTo))
      : Promise.resolve({ data: null }),
  ])

  function buildSummary(rows: GscRawRow[]): GscSummary {
    const totImpr = rows.reduce((s, r) => s + (r.impressions ?? 0), 0)
    const totals: GscSummaryTotals = {
      clicks:      rows.reduce((s, r) => s + (r.clicks      ?? 0), 0),
      impressions: totImpr,
      ctr:         totImpr > 0 ? rows.reduce((s, r) => s + (r.ctr      ?? 0) * (r.impressions ?? 0), 0) / totImpr : 0,
      position:    totImpr > 0 ? rows.reduce((s, r) => s + (r.position ?? 0) * (r.impressions ?? 0), 0) / totImpr : 0,
    }
    // Aggregate top queries grouped by keyword
    type Agg = { clicks: number; impressions: number; ctrSum: number; posSum: number }
    const qMap = new Map<string, Agg>()
    for (const r of rows) {
      if (!r.query) continue
      const impr = r.impressions ?? 0
      const ex = qMap.get(r.query)
      if (ex) { ex.clicks += r.clicks ?? 0; ex.impressions += impr; ex.ctrSum += (r.ctr ?? 0) * impr; ex.posSum += (r.position ?? 0) * impr }
      else qMap.set(r.query, { clicks: r.clicks ?? 0, impressions: impr, ctrSum: (r.ctr ?? 0) * impr, posSum: (r.position ?? 0) * impr })
    }
    const queries: GscSummaryRow[] = Array.from(qMap.entries())
      .sort((a, b) => b[1].clicks - a[1].clicks).slice(0, 25)
      .map(([query, v]) => ({ query, clicks: v.clicks, impressions: v.impressions, ctr: v.impressions > 0 ? v.ctrSum / v.impressions : 0, position: v.impressions > 0 ? v.posSum / v.impressions : 0 }))
    // Aggregate top pages grouped by URL
    const pMap = new Map<string, Agg>()
    for (const r of rows) {
      if (!r.page) continue
      const impr = r.impressions ?? 0
      const ex = pMap.get(r.page)
      if (ex) { ex.clicks += r.clicks ?? 0; ex.impressions += impr; ex.ctrSum += (r.ctr ?? 0) * impr; ex.posSum += (r.position ?? 0) * impr }
      else pMap.set(r.page, { clicks: r.clicks ?? 0, impressions: impr, ctrSum: (r.ctr ?? 0) * impr, posSum: (r.position ?? 0) * impr })
    }
    const pages: GscSummaryRow[] = Array.from(pMap.entries())
      .sort((a, b) => b[1].clicks - a[1].clicks).slice(0, 25)
      .map(([page, v]) => ({ page, clicks: v.clicks, impressions: v.impressions, ctr: v.impressions > 0 ? v.ctrSum / v.impressions : 0, position: v.impressions > 0 ? v.posSum / v.impressions : 0 }))
    return { totals, queries, pages }
  }

  const curr = currRows && currRows.length > 0 ? buildSummary(currRows as GscRawRow[]) : null
  const comp = compRows && compRows.length > 0 ? buildSummary(compRows as GscRawRow[]) : null

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

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

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
        <ExportButtons clientId={client.id} from={fromDate.toISOString().split('T')[0]} to={toDate.toISOString().split('T')[0]} compare={compare} />
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
