// ─────────────────────────────────────────────────────────────────────────────
// GSC Search Console Page — /dashboard/seo/search-console
// Shows total clicks, impressions, avg CTR, avg position from Google Search Console
// with top queries and top pages breakdowns.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import type { Client, ClientConnection, Connector } from '@/lib/types'
import DateRangePicker from '@/components/DateRangePicker'
import ExportButtons from '@/components/ExportButtons'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(2)}%` }
function fmtPos(n: number) { return n.toFixed(1) }
function truncateUrl(url: string, max = 60) {
  try {
    const u = new URL(url)
    const path = u.pathname + (u.search || '')
    return path.length > max ? path.slice(0, max) + '…' : path
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}
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

  // Fetch current and comparison period data in parallel
  const [{ data: rows }, { data: compRowsRaw }] = await Promise.all([
    db.from('gsc_metrics')
      .select('*')
      .eq('client_id', client.id)
      .gte('date', fmtDate(fromDate))
      .lte('date', fmtDate(toDate))
      .order('date', { ascending: true }),
    showCompare && compFrom && compTo
      ? db.from('gsc_metrics')
          .select('clicks, impressions, ctr, position, query')
          .eq('client_id', client.id)
          .gte('date', fmtDate(compFrom))
          .lte('date', fmtDate(compTo))
      : Promise.resolve({ data: null }),
  ])

  type GscRow = { date: string; query: string | null; page: string | null; country: string | null; clicks: number; impressions: number; ctr: number; position: number }
  const gscRows = (rows ?? []) as GscRow[]

  if (gscRows.length === 0) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <EmptyState title="No data for this date range" description="Try selecting a wider date range, or wait for the next sync." />
        </main>
      </div>
    )
  }

  // Aggregate totals (impression-weighted for CTR and position)
  const totals = gscRows.reduce(
    (acc, r) => ({
      clicks:       acc.clicks      + (r.clicks      ?? 0),
      impressions:  acc.impressions + (r.impressions  ?? 0),
      ctr_sum:      acc.ctr_sum     + (r.ctr          ?? 0) * (r.impressions ?? 0),
      position_sum: acc.position_sum + (r.position    ?? 0) * (r.impressions ?? 0),
    }),
    { clicks: 0, impressions: 0, ctr_sum: 0, position_sum: 0 }
  )
  const avgCtr      = totals.impressions > 0 ? totals.ctr_sum      / totals.impressions : 0
  const avgPosition = totals.impressions > 0 ? totals.position_sum / totals.impressions : 0

  // Comparison period aggregates
  type CompRow = { clicks: number; impressions: number; ctr: number; position: number; query?: string | null }
  const compRows = (compRowsRaw ?? []) as CompRow[]
  const compTotals = compRows.reduce(
    (acc, r) => ({
      clicks:       acc.clicks      + (r.clicks      ?? 0),
      impressions:  acc.impressions + (r.impressions  ?? 0),
      ctr_sum:      acc.ctr_sum     + (r.ctr          ?? 0) * (r.impressions ?? 0),
      position_sum: acc.position_sum + (r.position    ?? 0) * (r.impressions ?? 0),
    }),
    { clicks: 0, impressions: 0, ctr_sum: 0, position_sum: 0 }
  )
  const compAvgCtr      = compTotals.impressions > 0 ? compTotals.ctr_sum      / compTotals.impressions : 0
  const compAvgPosition = compTotals.impressions > 0 ? compTotals.position_sum / compTotals.impressions : 0

  // Per-query comparison map for position delta
  const compQueryMap = new Map<string, { pos_sum: number; imp_sum: number }>()
  if (showCompare) {
    for (const r of compRows) {
      if (!r.query) continue
      const ex = compQueryMap.get(r.query)
      if (ex) { ex.pos_sum += (r.position ?? 0) * (r.impressions ?? 0); ex.imp_sum += r.impressions ?? 0 }
      else compQueryMap.set(r.query, { pos_sum: (r.position ?? 0) * (r.impressions ?? 0), imp_sum: r.impressions ?? 0 })
    }
  }

  // Top Queries (aggregate by query, skip null/empty)
  const queryMap = new Map<string, { clicks: number; impressions: number; ctr_sum: number; position_sum: number }>()
  for (const r of gscRows) {
    if (!r.query) continue
    const ex = queryMap.get(r.query)
    if (ex) {
      ex.clicks      += r.clicks ?? 0
      ex.impressions += r.impressions ?? 0
      ex.ctr_sum     += (r.ctr ?? 0) * (r.impressions ?? 0)
      ex.position_sum += (r.position ?? 0) * (r.impressions ?? 0)
    } else {
      queryMap.set(r.query, {
        clicks: r.clicks ?? 0, impressions: r.impressions ?? 0,
        ctr_sum: (r.ctr ?? 0) * (r.impressions ?? 0),
        position_sum: (r.position ?? 0) * (r.impressions ?? 0),
      })
    }
  }
  const topQueries = Array.from(queryMap.entries())
    .map(([query, v]) => {
      const position = v.impressions > 0 ? v.position_sum / v.impressions : 0
      const compEntry = compQueryMap.get(query)
      const compPosAvg = compEntry && compEntry.imp_sum > 0 ? compEntry.pos_sum / compEntry.imp_sum : null
      return {
        query,
        clicks: v.clicks,
        impressions: v.impressions,
        ctr: v.impressions > 0 ? v.ctr_sum / v.impressions : 0,
        position,
        positionDelta: showCompare && compPosAvg != null ? position - compPosAvg : null,
      }
    })
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 25)

  // Top Pages (aggregate by page URL)
  const pageMap = new Map<string, { clicks: number; impressions: number; ctr_sum: number; position_sum: number }>()
  for (const r of gscRows) {
    if (!r.page) continue
    const ex = pageMap.get(r.page)
    if (ex) {
      ex.clicks      += r.clicks ?? 0
      ex.impressions += r.impressions ?? 0
      ex.ctr_sum     += (r.ctr ?? 0) * (r.impressions ?? 0)
      ex.position_sum += (r.position ?? 0) * (r.impressions ?? 0)
    } else {
      pageMap.set(r.page, {
        clicks: r.clicks ?? 0, impressions: r.impressions ?? 0,
        ctr_sum: (r.ctr ?? 0) * (r.impressions ?? 0),
        position_sum: (r.position ?? 0) * (r.impressions ?? 0),
      })
    }
  }
  const topPages = Array.from(pageMap.entries())
    .map(([page, v]) => ({
      page,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions > 0 ? v.ctr_sum / v.impressions : 0,
      position: v.impressions > 0 ? v.position_sum / v.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 25)

  const metricCards = [
    {
      label: 'Organic Clicks', value: fmtNum(totals.clicks),     color: '#10b981',
      delta: showCompare ? calcDelta(totals.clicks, compTotals.clicks) : null,
    },
    {
      label: 'Impressions',    value: fmtNum(totals.impressions), color: '#3b82f6',
      delta: showCompare ? calcDelta(totals.impressions, compTotals.impressions) : null,
    },
    {
      label: 'Avg. CTR',       value: fmtPct(avgCtr),             color: '#8b5cf6',
      delta: showCompare ? calcDelta(avgCtr, compAvgCtr) : null,
    },
    {
      label: 'Avg. Position',  value: fmtPos(avgPosition),        color: '#f59e0b',
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
              <p className="section-desc">Top {topQueries.length} queries by organic clicks</p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Query</th>
                    <th style={{ textAlign: 'right' }}>Clicks</th>
                    <th style={{ textAlign: 'right' }}>Impressions</th>
                    <th style={{ textAlign: 'right' }}>CTR</th>
                    <th style={{ textAlign: 'right' }}>Avg. Position</th>
                    {showCompare && <th style={{ textAlign: 'right' }}>Change</th>}
                  </tr>
                </thead>
                <tbody>
                  {topQueries.map((q, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500, color: 'var(--text-secondary)', maxWidth: 320 }}>
                        <span className="block truncate" title={q.query}>{q.query}</span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(q.clicks)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(q.impressions)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(q.ctr)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                        <span style={{
                          color: q.position <= 3 ? 'var(--green)' : q.position <= 10 ? '#d97706' : 'var(--text-muted)',
                          fontWeight: q.position <= 10 ? 600 : 400,
                        }}>
                          {fmtPos(q.position)}
                        </span>
                      </td>
                      {showCompare && (
                        <td style={{ textAlign: 'right' }}>
                          {q.positionDelta != null && Math.abs(q.positionDelta) >= 0.05 ? (
                            <span style={{ color: q.positionDelta < 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                              {q.positionDelta < 0 ? '▲' : '▼'} {Math.abs(q.positionDelta).toFixed(1)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-faint)' }}>—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Top Pages */}
        {topPages.length > 0 && (
          <div className="card p-6">
            <div className="mb-4">
              <h2 className="section-title">Top Pages</h2>
              <p className="section-desc">Top {topPages.length} pages by organic clicks</p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Page</th>
                    <th style={{ textAlign: 'right' }}>Clicks</th>
                    <th style={{ textAlign: 'right' }}>Impressions</th>
                    <th style={{ textAlign: 'right' }}>CTR</th>
                    <th style={{ textAlign: 'right' }}>Avg. Position</th>
                  </tr>
                </thead>
                <tbody>
                  {topPages.map((p, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500, color: 'var(--text-secondary)', maxWidth: 320 }}>
                        <a
                          href={p.page}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline block truncate"
                          style={{ color: 'var(--blue)' }}
                          title={p.page}
                        >
                          {truncateUrl(p.page)}
                        </a>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(p.clicks)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(p.impressions)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(p.ctr)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                        <span style={{
                          color: p.position <= 3 ? 'var(--green)' : p.position <= 10 ? '#d97706' : 'var(--text-muted)',
                          fontWeight: p.position <= 10 ? 600 : 400,
                        }}>
                          {fmtPos(p.position)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
