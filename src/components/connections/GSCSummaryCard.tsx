// GSC Summary Card — shown on the dashboard cockpit when google_search_console is connected.
// Displays total clicks, impressions, avg CTR, avg position, and top 5 queries.

import { createAdminClient } from '@/lib/supabase/server'
import ConnectionSummaryCard from './ConnectionSummaryCard'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'

function fmtNum(n: number) { return n.toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(2)}%` }
function fmtPos(n: number) { return n.toFixed(1) }
function calcDelta(curr: number, prev: number) {
  if (prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

interface Props {
  clientId: string
  connectionId: string
  dateFrom: string
  dateTo: string
  compareDateFrom?: string
  compareDateTo?: string
}

export default async function GSCSummaryCard({ clientId, connectionId, dateFrom, dateTo, compareDateFrom, compareDateTo }: Props) {
  const db = createAdminClient()

  const showCompare = !!(compareDateFrom && compareDateTo)

  const [{ data: rows }, { data: compRows }] = await Promise.all([
    db.from('gsc_metrics')
      .select('clicks, impressions, ctr, position, query')
      .eq('client_id', clientId)
      .eq('connection_id', connectionId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .range(0, 9999),
    showCompare
      ? db.from('gsc_metrics')
          .select('clicks, impressions, ctr, position')
          .eq('client_id', clientId)
          .eq('connection_id', connectionId)
          .gte('date', compareDateFrom!)
          .lte('date', compareDateTo!)
          .range(0, 9999)
      : Promise.resolve({ data: null }),
  ])

  const data    = rows ?? []
  const hasData = data.length > 0

  const totClicks = data.reduce((s, r) => s + (r.clicks      ?? 0), 0)
  const totImpr   = data.reduce((s, r) => s + (r.impressions ?? 0), 0)
  // Impression-weighted averages (matches methodology used on the full GSC page)
  const avgCtr    = totImpr > 0
    ? data.reduce((s, r) => s + (r.ctr      ?? 0) * (r.impressions ?? 0), 0) / totImpr
    : 0
  const avgPos    = totImpr > 0
    ? data.reduce((s, r) => s + (r.position ?? 0) * (r.impressions ?? 0), 0) / totImpr
    : 0

  // Comparison period aggregates
  const compData    = compRows ?? []
  const compClicks  = compData.reduce((s, r) => s + ((r as { clicks?: number }).clicks      ?? 0), 0)
  const compImpr    = compData.reduce((s, r) => s + ((r as { impressions?: number }).impressions ?? 0), 0)
  const compAvgCtr  = compImpr > 0
    ? compData.reduce((s, r) => s + ((r as { ctr?: number }).ctr ?? 0) * ((r as { impressions?: number }).impressions ?? 0), 0) / compImpr
    : 0
  const compAvgPos  = compImpr > 0
    ? compData.reduce((s, r) => s + ((r as { position?: number }).position ?? 0) * ((r as { impressions?: number }).impressions ?? 0), 0) / compImpr
    : 0

  const deltaClicks = showCompare ? calcDelta(totClicks, compClicks) : null
  const deltaImpr   = showCompare ? calcDelta(totImpr,   compImpr)   : null
  const deltaCtr    = showCompare ? calcDelta(avgCtr,    compAvgCtr) : null
  // Position: lower is better, so invert the delta sign for color display
  const deltaPos    = showCompare ? calcDelta(avgPos,    compAvgPos) : null

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

  const metrics = [
    { label: 'Organic Clicks', value: fmtNum(totClicks), delta: deltaClicks },
    { label: 'Impressions',    value: fmtNum(totImpr),   delta: deltaImpr   },
    { label: 'Avg. CTR',       value: fmtPct(avgCtr),    delta: deltaCtr    },
    { label: 'Avg. Position',  value: fmtPos(avgPos),    delta: deltaPos, invert: true },
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
            <DeltaBadge delta={m.delta ?? null} invert={m.invert} />
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
