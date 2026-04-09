// GSC Summary Card — shown on the dashboard cockpit when google_search_console is connected.
// Displays total clicks, impressions, avg CTR, avg position, and top 5 queries.

import { createAdminClient } from '@/lib/supabase/server'
import ConnectionSummaryCard from './ConnectionSummaryCard'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'

function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(2)}%` }
function fmtPos(n: number) { return n.toFixed(1) }

interface Props {
  clientId: string
  connectionId: string
  dateFrom: string
  dateTo: string
}

export default async function GSCSummaryCard({ clientId, connectionId, dateFrom, dateTo }: Props) {
  const db = createAdminClient()

  const { data: rows } = await db
    .from('gsc_metrics')
    .select('clicks, impressions, ctr, position, query')
    .eq('client_id', clientId)
    .eq('connection_id', connectionId)
    .gte('date', dateFrom)
    .lte('date', dateTo)

  const data = rows ?? []
  const hasData = data.length > 0

  const totClicks = data.reduce((s, r) => s + (r.clicks ?? 0), 0)
  const totImpr   = data.reduce((s, r) => s + (r.impressions ?? 0), 0)
  const avgCtr    = data.length > 0
    ? data.reduce((s, r) => s + (r.ctr ?? 0), 0) / data.length
    : 0
  const avgPos    = data.length > 0
    ? data.reduce((s, r) => s + (r.position ?? 0), 0) / data.length
    : 0

  // Top 5 queries by clicks
  const queryMap = new Map<string, number>()
  for (const r of data) {
    if (r.query) {
      queryMap.set(r.query, (queryMap.get(r.query) ?? 0) + (r.clicks ?? 0))
    }
  }
  const topQueries = Array.from(queryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const metrics = [
    { label: 'Clicks',       value: fmtNum(totClicks) },
    { label: 'Impressions',  value: fmtNum(totImpr)   },
    { label: 'Avg. CTR',     value: fmtPct(avgCtr)    },
    { label: 'Avg. Position',value: fmtPos(avgPos)    },
  ]

  return (
    <ConnectionSummaryCard
      title="Search Console"
      icon={<MagnifyingGlass size={18} />}
      accentColor="#34a853"
      href="/dashboard/seo/search-console"
      hasData={hasData}
    >
      {/* Metric tiles */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '1rem',
        marginBottom: topQueries.length > 0 ? '1.25rem' : 0,
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

      {/* Top queries */}
      {topQueries.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
          <p className="section-label mb-2">Top Queries</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topQueries.map(([query, clicks]) => (
              <div key={query} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: '0.8125rem', color: 'var(--text-secondary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}>
                  {query}
                </span>
                <span style={{
                  fontSize: '0.8125rem', fontWeight: 600,
                  color: 'var(--text-primary)', flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmtNum(clicks)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ConnectionSummaryCard>
  )
}
