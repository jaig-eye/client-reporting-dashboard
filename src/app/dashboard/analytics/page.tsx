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

  // Fetch GA4 metrics
  const { data: rows } = await db
    .from('ga4_metrics')
    .select('*')
    .eq('client_id', client.id)
    .gte('date', fmtDate(fromDate))
    .lte('date', fmtDate(toDate))
    .order('date', { ascending: true })

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
  const avgBounceRate = totals.sessions > 0 ? totals.bounce_rate_sum / totals.sessions : 0
  const avgDuration   = totals.sessions > 0 ? totals.duration_sum   / totals.sessions : 0

  // Daily trend for chart
  const dailyByDate = new Map<string, { sessions: number; conversions: number }>()
  for (const r of ga4Rows) {
    const d = r.date.split('T')[0]
    const ex = dailyByDate.get(d)
    if (ex) { ex.sessions += r.sessions; ex.conversions += r.conversions }
    else dailyByDate.set(d, { sessions: r.sessions, conversions: r.conversions })
  }
  const dailyTrend = Array.from(dailyByDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, spend: v.sessions, conversions: v.conversions, clicks: 0, roas: 0 }))

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

  const metricCards = [
    { label: 'Sessions',         value: fmtNum(totals.sessions),   color: '#3b82f6' },
    { label: 'Users',            value: fmtNum(totals.users),      color: '#10b981' },
    { label: 'New Users',        value: fmtNum(totals.new_users),  color: '#6366f1' },
    { label: 'Page Views',       value: fmtNum(totals.page_views), color: '#f59e0b' },
    { label: 'Conversions',      value: fmtNum(totals.conversions),color: '#ec4899' },
    { label: 'Bounce Rate',      value: fmtPct(avgBounceRate),     color: '#ef4444' },
    { label: 'Avg. Session',     value: fmtSec(avgDuration),       color: '#8b5cf6' },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {ga4Rows.length === 0 ? (
          <EmptyState title="No data for this date range" description="Try selecting a wider date range, or wait for the next sync." />
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {metricCards.map(card => (
                <div key={card.label} className="card p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
                    {card.label}
                  </p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
                  <div style={{ width: '100%', height: 3, borderRadius: 9999, background: 'var(--border)', marginTop: 8 }}>
                    <div style={{ width: '60%', height: '100%', borderRadius: 9999, background: card.color }} />
                  </div>
                </div>
              ))}
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
