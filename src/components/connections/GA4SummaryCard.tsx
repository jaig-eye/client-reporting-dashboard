// GA4 Summary Card — shown on the dashboard cockpit when google_analytics is connected.
// Displays sessions, new users, engagement rate, avg session duration, and conversions.
// Shows top traffic sources (UTM source/medium) from ga4_source_metrics if available.

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
  connectionId?:    string
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
  clientId, connectionId, dateFrom, dateTo, compareDateFrom, compareDateTo,
}: Props) {
  const db          = createAdminClient()
  const showCompare = !!(compareDateFrom && compareDateTo)

  // Build each query then conditionally add connection_id filter.
  // Filtering by connection_id is critical when a client has had multiple GA4 connections
  // (e.g., after reconnecting) — without it both connections' rows are summed, inflating sessions.
  const currQ = db.from('ga4_metrics')
    .select('sessions, new_users, bounce_rate, avg_session_duration, conversions')
    .eq('client_id', clientId)
    .gte('date', dateFrom)
    .lte('date', dateTo)

  const compQ = showCompare
    ? db.from('ga4_metrics')
        .select('sessions, new_users, bounce_rate, conversions')
        .eq('client_id', clientId)
        .gte('date', compareDateFrom!)
        .lte('date', compareDateTo!)
    : null

  const srcQ = db.from('ga4_source_metrics')
    .select('source, medium, sessions')
    .eq('client_id', clientId)
    .gte('date', dateFrom)
    .lte('date', dateTo)

  const [{ data: rows }, { data: compRows }, { data: sourceRows }] = await Promise.all([
    connectionId ? currQ.eq('connection_id', connectionId) : currQ,
    compQ
      ? (connectionId ? compQ.eq('connection_id', connectionId) : compQ)
      : Promise.resolve({ data: null }),
    connectionId ? srcQ.eq('connection_id', connectionId) : srcQ,
  ])

  const allRows = rows ?? []
  // Exclude rows with empty channel_group (unattributed sessions stored as '' instead of 'Direct')
  const data    = allRows.filter(r => (r as { channel_group?: string | null }).channel_group !== '')
  const hasData = allRows.length > 0

  // Aggregate current period totals
  const totSessions    = data.reduce((s, r) => s + (r.sessions ?? 0), 0)
  const totNewUsers    = data.reduce((s, r) => s + (r.new_users ?? 0), 0)
  const totConversions = data.reduce((s, r) => s + (r.conversions ?? 0), 0)
  const bounceSum      = data.reduce((s, r) => s + (r.bounce_rate ?? 0) * (r.sessions ?? 0), 0)
  const durSum         = data.reduce((s, r) => s + (r.avg_session_duration ?? 0) * (r.sessions ?? 0), 0)
  const avgBounce      = totSessions > 0 ? bounceSum / totSessions : 0
  const avgDur         = totSessions > 0 ? durSum    / totSessions : 0
  const engagementRate = 1 - avgBounce

  // Aggregate comparison period totals (filter empty channel_group)
  const compData         = (compRows ?? []).filter(r => (r as { channel_group?: string | null }).channel_group !== '')
  const compSessions     = compData.reduce((s, r) => s + ((r as { sessions?: number }).sessions      ?? 0), 0)
  const compNewUsers     = compData.reduce((s, r) => s + ((r as { new_users?: number }).new_users     ?? 0), 0)
  const compConversions  = compData.reduce((s, r) => s + ((r as { conversions?: number }).conversions ?? 0), 0)
  const compBounceSum    = compData.reduce((s, r) => s + ((r as { bounce_rate?: number }).bounce_rate ?? 0) * ((r as { sessions?: number }).sessions ?? 0), 0)
  const compAvgBounce    = compSessions > 0 ? compBounceSum / compSessions : 0
  const compEngagement   = 1 - compAvgBounce

  const deltaSessions    = showCompare ? calcDelta(totSessions,    compSessions)    : null
  const deltaNewUsers    = showCompare ? calcDelta(totNewUsers,    compNewUsers)    : null
  const deltaEngagement  = showCompare ? calcDelta(engagementRate, compEngagement)  : null
  const deltaConversions = showCompare ? calcDelta(totConversions, compConversions) : null

  // Top 5 source/medium combos by sessions from ga4_source_metrics
  const srcData = sourceRows ?? []
  const sourceMap = new Map<string, number>()
  for (const r of srcData) {
    const key = `${r.source ?? '(direct)'} / ${r.medium ?? '(none)'}`
    sourceMap.set(key, (sourceMap.get(key) ?? 0) + (r.sessions ?? 0))
  }
  const topSources = Array.from(sourceMap.entries())
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
        gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
        gap: '1rem',
        marginBottom: (topSources.length > 0) ? '1.25rem' : 0,
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
        <div>
          <p className="metric-label mb-1">Conversions</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
            {fmtNum(totConversions)}
          </p>
          <DeltaBadge delta={deltaConversions} />
        </div>
      </div>

      {/* Top traffic sources */}
      {topSources.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
          <p className="section-label mb-2">Top Traffic Sources</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topSources.map(([source, sessions]) => (
              <div key={source} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: '0.8125rem', color: 'var(--text-secondary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}>
                  {source}
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
