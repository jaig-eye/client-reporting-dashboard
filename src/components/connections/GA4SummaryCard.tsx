// GA4 Summary Card — shown on the dashboard cockpit when google_analytics is connected.
// Displays sessions, new users, engagement rate, and avg session duration.
// Supports optional comparison period to show delta badges.

import { createAdminClient } from '@/lib/supabase/server'
import ConnectionSummaryCard from './ConnectionSummaryCard'
import { ChartLineUp } from '@phosphor-icons/react/dist/ssr'

function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%` }
function fmtDur(n: number) {
  const m = Math.floor(n / 60); const s = Math.round(n % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
function calcDelta(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

interface Props {
  clientId:         string
  connectionId?:    string  // kept for API compat but no longer used in query
  dateFrom:         string
  dateTo:           string
  compareDateFrom?: string
  compareDateTo?:   string
}

function DeltaBadge({ delta, invert = false }: { delta: number | null; invert?: boolean }) {
  if (delta === null) return null
  const positive = invert ? delta < 0 : delta >= 0
  return (
    <span style={{
      fontSize: '0.7rem', fontWeight: 600, marginTop: 2,
      color: positive ? 'var(--green)' : 'var(--red)',
    }}>
      {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
    </span>
  )
}

export default async function GA4SummaryCard({
  clientId, dateFrom, dateTo, compareDateFrom, compareDateTo,
}: Props) {
  const db          = createAdminClient()
  const showCompare = !!(compareDateFrom && compareDateTo)

  const [{ data: rows }, { data: compRows }] = await Promise.all([
    db.from('ga4_metrics')
      .select('sessions, new_users, bounce_rate, avg_session_duration, channel_group')
      .eq('client_id', clientId)
      .gte('date', dateFrom)
      .lte('date', dateTo),
    showCompare
      ? db.from('ga4_metrics')
          .select('sessions, new_users, bounce_rate')
          .eq('client_id', clientId)
          .gte('date', compareDateFrom!)
          .lte('date', compareDateTo!)
      : Promise.resolve({ data: null }),
  ])

  const data    = rows ?? []
  const hasData = data.length > 0

  // Aggregate current period totals
  const totSessions = data.reduce((s, r) => s + (r.sessions ?? 0), 0)
  const totNewUsers = data.reduce((s, r) => s + (r.new_users ?? 0), 0)
  const bounceSum   = data.reduce((s, r) => s + (r.bounce_rate ?? 0) * (r.sessions ?? 0), 0)
  const durSum      = data.reduce((s, r) => s + (r.avg_session_duration ?? 0) * (r.sessions ?? 0), 0)
  const avgBounce   = totSessions > 0 ? bounceSum / totSessions : 0
  const avgDur      = totSessions > 0 ? durSum    / totSessions : 0
  const engagementRate = 1 - avgBounce

  // Aggregate comparison period totals
  const compData         = compRows ?? []
  const compSessions     = compData.reduce((s, r) => s + ((r as { sessions?: number }).sessions  ?? 0), 0)
  const compNewUsers     = compData.reduce((s, r) => s + ((r as { new_users?: number }).new_users ?? 0), 0)
  const compBounceSum    = compData.reduce((s, r) => s + ((r as { bounce_rate?: number }).bounce_rate ?? 0) * ((r as { sessions?: number }).sessions ?? 0), 0)
  const compAvgBounce    = compSessions > 0 ? compBounceSum / compSessions : 0
  const compEngagement   = 1 - compAvgBounce

  const deltaSessions   = showCompare ? calcDelta(totSessions,    compSessions)   : null
  const deltaNewUsers   = showCompare ? calcDelta(totNewUsers,    compNewUsers)   : null
  const deltaEngagement = showCompare ? calcDelta(engagementRate, compEngagement) : null

  // Top 5 channels by sessions
  const channelMap = new Map<string, number>()
  for (const r of data) {
    const ch = r.channel_group ?? 'Unassigned'
    channelMap.set(ch, (channelMap.get(ch) ?? 0) + (r.sessions ?? 0))
  }
  const topChannels = Array.from(channelMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return (
    <ConnectionSummaryCard
      title="Google Analytics"
      icon={<ChartLineUp size={18} />}
      accentColor="#e37400"
      href="/dashboard/analytics"
      hasData={hasData}
    >
      {/* Metric tiles */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '1rem',
        marginBottom: topChannels.length > 0 ? '1.25rem' : 0,
      }}>
        <div>
          <p className="metric-label mb-1">Sessions</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
            {fmtNum(totSessions)}
          </p>
          <DeltaBadge delta={deltaSessions} />
        </div>
        <div>
          <p className="metric-label mb-1">New Users</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
            {fmtNum(totNewUsers)}
          </p>
          <DeltaBadge delta={deltaNewUsers} />
        </div>
        <div>
          <p className="metric-label mb-1">Engagement</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
            {fmtPct(engagementRate)}
          </p>
          <DeltaBadge delta={deltaEngagement} />
        </div>
        <div>
          <p className="metric-label mb-1">Avg. Duration</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
            {fmtDur(avgDur)}
          </p>
        </div>
      </div>

      {/* Top channels */}
      {topChannels.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
          <p className="section-label mb-2">Sessions by Channel</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topChannels.map(([channel, sessions]) => (
              <div key={channel} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: '0.8125rem', color: 'var(--text-secondary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}>
                  {channel}
                </span>
                <span style={{
                  fontSize: '0.8125rem', fontWeight: 600,
                  color: 'var(--text-primary)', flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmtNum(sessions)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ConnectionSummaryCard>
  )
}
