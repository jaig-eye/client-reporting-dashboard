// GA4 Summary Card — shown on the dashboard cockpit when google_analytics is connected.
// Displays sessions, new users, bounce rate, and avg session duration.
// Also shows a mini top-5 pages table.

import { createAdminClient } from '@/lib/supabase/server'
import ConnectionSummaryCard from './ConnectionSummaryCard'
import { ChartLineUp } from '@phosphor-icons/react/dist/ssr'

function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%` }
function fmtDur(n: number) {
  const m = Math.floor(n / 60); const s = Math.round(n % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

interface Props {
  clientId: string
  connectionId?: string  // kept for API compat but no longer used in query
  dateFrom: string
  dateTo: string
}

export default async function GA4SummaryCard({ clientId, dateFrom, dateTo }: Props) {
  const db = createAdminClient()

  const { data: rows } = await db
    .from('ga4_metrics')
    .select('sessions, new_users, bounce_rate, avg_session_duration, page_path, channel_group')
    .eq('client_id', clientId)
    .gte('date', dateFrom)
    .lte('date', dateTo)

  const data = rows ?? []
  const hasData = data.length > 0

  // Aggregate totals
  const totSessions = data.reduce((s, r) => s + (r.sessions ?? 0), 0)
  const totNewUsers = data.reduce((s, r) => s + (r.new_users ?? 0), 0)
  const avgBounce   = data.length > 0
    ? data.reduce((s, r) => s + (r.bounce_rate ?? 0), 0) / data.length
    : 0
  const avgDur      = data.length > 0
    ? data.reduce((s, r) => s + (r.avg_session_duration ?? 0), 0) / data.length
    : 0

  // Top 5 pages by sessions
  const pageMap = new Map<string, number>()
  for (const r of data) {
    if (r.page_path) {
      pageMap.set(r.page_path, (pageMap.get(r.page_path) ?? 0) + (r.sessions ?? 0))
    }
  }
  const topPages = Array.from(pageMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const metrics = [
    { label: 'Sessions',      value: fmtNum(totSessions) },
    { label: 'New Users',     value: fmtNum(totNewUsers) },
    { label: 'Bounce Rate',   value: fmtPct(avgBounce)   },
    { label: 'Avg. Duration', value: fmtDur(avgDur)      },
  ]

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
        marginBottom: topPages.length > 0 ? '1.25rem' : 0,
      }}>
        {metrics.map(m => (
          <div key={m.label}>
            <p className="metric-label mb-1">{m.label}</p>
            <p style={{
              fontSize: '1.25rem', fontWeight: 700,
              color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.01em',
            }}>
              {m.value}
            </p>
          </div>
        ))}
      </div>

      {/* Top pages */}
      {topPages.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
          <p className="section-label mb-2">Top Pages</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topPages.map(([path, sessions]) => (
              <div key={path} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: '0.8125rem', color: 'var(--text-secondary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}>
                  {path}
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
