// ─────────────────────────────────────────────────────────────────────────────
// GA4 Analytics Page — /dashboard/analytics
// Shows sessions, users, bounce rate, avg session duration, and conversions
// from Google Analytics 4, broken down by channel group.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import type { Client, ClientConnection, Connector } from '@/lib/types'
import DateRangePicker from '@/components/DateRangePicker'
import SpendChart from '@/components/SpendChart'
import SparkMetricCard from '@/components/SparkMetricCard'
import ExportButtons from '@/components/ExportButtons'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%` }
function fmtSec(n: number) {
  const m = Math.floor(n / 60)
  const s = Math.round(n % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

const CHANNEL_COLORS: Record<string, string> = {
  'Organic Search': '#10b981',
  'Paid Search':    '#3b82f6',
  'Direct':         '#6366f1',
  'Organic Social': '#f59e0b',
  'Paid Social':    '#ec4899',
  'Email':          '#14b8a6',
  'Referral':       '#8b5cf6',
  'Unassigned':     '#9ca3af',
}

export default async function GA4Page({
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

  const showCompare = compare !== 'none'
  const periodMs    = toDate.getTime() - fromDate.getTime()
  let priorTo:   Date
  let priorFrom: Date
  if (compare === 'last_year') {
    priorFrom = new Date(fromDate); priorFrom.setFullYear(priorFrom.getFullYear() - 1)
    priorTo   = new Date(toDate);   priorTo.setFullYear(priorTo.getFullYear() - 1)
  } else {
    priorTo   = new Date(fromDate.getTime() - 86400000)
    priorFrom = new Date(priorTo.getTime() - periodMs)
  }

  // Find active GA4 connections
  const { data: connData } = await db
    .from('client_connections')
    .select('*, connector:connectors(id, type, label)')
    .eq('client_id', client.id)
    .eq('status', 'active')

  const connections = (connData ?? []) as (ClientConnection & { connector: Pick<Connector, 'id' | 'type' | 'label'> })[]
  const ga4Connections = connections.filter(c => c.connector.type === 'google_analytics')

  if (ga4Connections.length === 0) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <EmptyState
            title="Google Analytics not connected"
            description="Ask your account manager to connect your GA4 property to start seeing traffic data here."
          />
        </main>
      </div>
    )
  }

  // Fetch GA4 metrics (current + prior period in parallel)
  const [{ data: rows }, { data: priorRows }] = await Promise.all([
    db.from('ga4_metrics').select('*')
      .eq('client_id', client.id)
      .gte('date', fmtDate(fromDate)).lte('date', fmtDate(toDate))
      .order('date', { ascending: true }),
    showCompare
      ? db.from('ga4_metrics').select('date,channel_group,sessions,users,new_users,conversions,bounce_rate')
          .eq('client_id', client.id)
          .gte('date', fmtDate(priorFrom)).lte('date', fmtDate(priorTo))
      : Promise.resolve({ data: null }),
  ])

  const ga4Rows = (rows ?? []) as {
    date: string; channel_group: string | null;
    sessions: number; users: number; new_users: number;
    page_views: number; conversions: number;
    bounce_rate: number; avg_session_duration: number;
  }[]

  // Aggregate totals (all channels combined)
  const totals = ga4Rows.reduce(
    (acc, r) => ({
      sessions:             acc.sessions             + (r.sessions             ?? 0),
      users:                acc.users                + (r.users                ?? 0),
      new_users:            acc.new_users            + (r.new_users            ?? 0),
      page_views:           acc.page_views           + (r.page_views           ?? 0),
      conversions:          acc.conversions          + (r.conversions          ?? 0),
      bounce_rate_sum:      acc.bounce_rate_sum      + (r.bounce_rate          ?? 0) * (r.sessions ?? 0),
      duration_sum:         acc.duration_sum         + (r.avg_session_duration ?? 0) * (r.sessions ?? 0),
    }),
    { sessions: 0, users: 0, new_users: 0, page_views: 0, conversions: 0, bounce_rate_sum: 0, duration_sum: 0 }
  )
  const avgBounceRate  = totals.sessions > 0 ? totals.bounce_rate_sum / totals.sessions : 0
  const avgDuration    = totals.sessions > 0 ? totals.duration_sum   / totals.sessions : 0
  const engagementRate = 1 - avgBounceRate

  // Prior period aggregation
  type PriorRow = { sessions?: number; users?: number; new_users?: number; conversions?: number; bounce_rate?: number; channel_group?: string | null }
  const priorData = (priorRows ?? []) as PriorRow[]
  const priorTotals = priorData.reduce<{ sessions: number; new_users: number; conversions: number; bounce_rate_sum: number }>(
    (acc, r) => ({
      sessions:        acc.sessions        + (r.sessions    ?? 0),
      new_users:       acc.new_users       + (r.new_users   ?? 0),
      conversions:     acc.conversions     + (r.conversions ?? 0),
      bounce_rate_sum: acc.bounce_rate_sum + (r.bounce_rate ?? 0) * (r.sessions ?? 0),
    }),
    { sessions: 0, new_users: 0, conversions: 0, bounce_rate_sum: 0 }
  )
  const priorEngagement = priorTotals.sessions > 0 ? 1 - (priorTotals.bounce_rate_sum / priorTotals.sessions) : 0

  function calcDelta(curr: number, prev: number): number | null {
    if (prev === 0) return null
    return ((curr - prev) / Math.abs(prev)) * 100
  }

  const deltaSessions    = showCompare ? calcDelta(totals.sessions,  priorTotals.sessions)  : null
  const deltaNewUsers    = showCompare ? calcDelta(totals.new_users,  priorTotals.new_users)  : null
  const deltaConversions = showCompare ? calcDelta(totals.conversions, priorTotals.conversions) : null
  const deltaEngagement  = showCompare ? calcDelta(engagementRate,     priorEngagement)        : null

  // Prior channel map for Δ Sessions column
  const priorChannelMap = new Map<string, number>()
  for (const r of priorData) {
    const ch = r.channel_group ?? 'Unassigned'
    priorChannelMap.set(ch, (priorChannelMap.get(ch) ?? 0) + (r.sessions ?? 0))
  }

  // Daily trend for chart
  const dailyByDate = new Map<string, { sessions: number; conversions: number }>()
  for (const r of ga4Rows) {
    const d = r.date.split('T')[0]
    const ex = dailyByDate.get(d)
    if (ex) { ex.sessions += r.sessions; ex.conversions += r.conversions }
    else dailyByDate.set(d, { sessions: r.sessions, conversions: r.conversions })
  }
  const sortedDailyEntries = Array.from(dailyByDate.entries()).sort(([a], [b]) => a.localeCompare(b))
  const dailyTrend = sortedDailyEntries.map(([date, v]) => ({ date, spend: v.sessions, conversions: v.conversions, clicks: 0, roas: 0 }))

  // Sparkline data for KPI cards
  const sessionsSpark = sortedDailyEntries.map(([, v]) => ({ v: v.sessions }))
  const convSpark     = sortedDailyEntries.map(([, v]) => ({ v: v.conversions }))

  // Computed secondary metrics
  const convRate = totals.sessions > 0 ? totals.conversions / totals.sessions : 0

  // Channel breakdown
  const channelMap = new Map<string, { sessions: number; users: number; conversions: number; bounce_rate_sum: number }>()
  for (const r of ga4Rows) {
    const ch = r.channel_group ?? 'Unassigned'
    const ex = channelMap.get(ch)
    if (ex) {
      ex.sessions += r.sessions; ex.users += r.users; ex.conversions += r.conversions
      ex.bounce_rate_sum += (r.bounce_rate ?? 0) * (r.sessions ?? 0)
    } else {
      channelMap.set(ch, { sessions: r.sessions, users: r.users, conversions: r.conversions, bounce_rate_sum: (r.bounce_rate ?? 0) * (r.sessions ?? 0) })
    }
  }
  const channels = Array.from(channelMap.entries())
    .map(([name, v]) => ({ name, ...v, bounce_rate: v.sessions > 0 ? v.bounce_rate_sum / v.sessions : 0 }))
    .sort((a, b) => b.sessions - a.sessions)

  const secondaryCards = [
    { label: 'Avg. Session',     value: fmtSec(avgDuration)           },
    { label: 'Engagement Rate',  value: fmtPct(engagementRate)        },
    { label: 'Conv. Rate',       value: fmtPct(convRate)              },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {ga4Rows.length === 0 ? (
          <EmptyState title="No data for this date range" description="Try selecting a wider date range, or wait for the next sync." />
        ) : (
          <>
            {/* KPI spark cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <SparkMetricCard label="Sessions"    value={fmtNum(totals.sessions)}    sparkData={sessionsSpark} sparkColor="#3b82f6" delay={0} delta={deltaSessions    ?? undefined} />
              <SparkMetricCard label="Users"       value={fmtNum(totals.users)}        sparkColor="#10b981" delay={1} />
              <SparkMetricCard label="New Users"   value={fmtNum(totals.new_users)}    sparkColor="#6366f1" delay={2} delta={deltaNewUsers    ?? undefined} />
              <SparkMetricCard label="Page Views"  value={fmtNum(totals.page_views)}   sparkColor="#f59e0b" delay={3} />
              <SparkMetricCard label="Conversions" value={fmtNum(totals.conversions)}  sparkData={convSpark} sparkColor="#ec4899" delay={4} delta={deltaConversions ?? undefined} />
            </div>

            {/* Secondary compact cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="card" style={{ padding: '1rem 1.25rem' }}>
                <p className="metric-label" style={{ marginBottom: '0.25rem' }}>Avg. Session</p>
                <p className="metric-value" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>{fmtSec(avgDuration)}</p>
              </div>
              <div className="card" style={{ padding: '1rem 1.25rem' }}>
                <p className="metric-label" style={{ marginBottom: '0.25rem' }}>Engagement Rate</p>
                <p className="metric-value" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>{fmtPct(engagementRate)}</p>
                {deltaEngagement != null && (
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: deltaEngagement >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {deltaEngagement >= 0 ? '▲' : '▼'} {Math.abs(deltaEngagement).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="card" style={{ padding: '1rem 1.25rem' }}>
                <p className="metric-label" style={{ marginBottom: '0.25rem' }}>Conv. Rate</p>
                <p className="metric-value" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>{fmtPct(convRate)}</p>
              </div>
            </div>

            {/* Sessions trend chart */}
            <div className="card p-6">
              <div className="mb-4">
                <h2 className="section-title">Sessions & Conversions Over Time</h2>
                <p className="section-desc">{fmtDate(fromDate)} – {fmtDate(toDate)}</p>
              </div>
              <SpendChart
                data={dailyTrend}
                colorSpend="#3b82f6"
                colorConversions="#10b981"
                spendLabel="Sessions"
                conversionsLabel="Conversions"
                variant="count"
              />
            </div>

            {/* Channel breakdown table */}
            {channels.length > 0 && (
              <div className="card p-6">
                <div className="mb-4">
                  <h2 className="section-title">Traffic by Channel</h2>
                  <p className="section-desc">{channels.length} channels</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table" style={{ minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Channel</th>
                        <th style={{ textAlign: 'right' }}>Sessions</th>
                        {showCompare && <th style={{ textAlign: 'right' }}>Δ Sessions</th>}
                        <th style={{ textAlign: 'right' }}>Users</th>
                        <th style={{ textAlign: 'right' }}>Conversions</th>
                        <th style={{ textAlign: 'right' }}>Bounce Rate</th>
                        <th style={{ textAlign: 'right' }}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channels.map(ch => (
                        <tr key={ch.name}>
                          <td style={{ fontWeight: 500 }}>
                            <span style={{
                              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                              background: CHANNEL_COLORS[ch.name] ?? '#9ca3af', marginRight: 6, verticalAlign: 'middle'
                            }} />
                            {ch.name}
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(ch.sessions)}</td>
                          {showCompare && (() => {
                            const prev = priorChannelMap.get(ch.name) ?? 0
                            const delta = prev > 0 ? ((ch.sessions - prev) / prev) * 100 : null
                            return (
                              <td style={{ textAlign: 'right' }}>
                                {delta != null
                                  ? <span style={{ fontSize: '0.8rem', fontWeight: 600, color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%</span>
                                  : <span style={{ color: 'var(--text-faint)' }}>—</span>
                                }
                              </td>
                            )
                          })()}
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(ch.users)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{ch.conversions > 0 ? fmtNum(ch.conversions) : '—'}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(ch.bounce_rate)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                            {totals.sessions > 0 ? `${((ch.sessions / totals.sessions) * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
                        <td>Total</td>
                        <td style={{ textAlign: 'right' }}>{fmtNum(totals.sessions)}</td>
                        {showCompare && <td />}
                        <td style={{ textAlign: 'right' }}>{fmtNum(totals.users)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtNum(totals.conversions)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtPct(avgBounceRate)}</td>
                        <td style={{ textAlign: 'right' }}>100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function PageHeader({ client, fromDate, toDate, compare }: { client: Client; fromDate: Date; toDate: Date; compare: string }) {
  return (
    <div className="max-w-7xl mx-auto px-6 pt-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#e37400', flexShrink: 0 }} />
        <h1 className="font-semibold text-base" style={{ color: 'var(--text-primary)', margin: 0 }}>Analytics — GA4</h1>
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
        📊
      </div>
      <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{description}</p>
    </div>
  )
}
