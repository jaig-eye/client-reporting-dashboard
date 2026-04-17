// Ahrefs Summary Card — shown on the dashboard cockpit when ahrefs connector is connected.
// Displays the most recent Domain Rating, backlinks, referring domains, and organic traffic.
// Supports optional comparison period to show delta badges.

import { createAdminClient } from '@/lib/supabase/server'
import ConnectionSummaryCard from './ConnectionSummaryCard'
import { LinkSimple } from '@phosphor-icons/react/dist/ssr'

interface Props {
  clientId:         string
  dateFrom:         string
  dateTo:           string
  compareDateFrom?: string
  compareDateTo?:   string
}

function fmtNum(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

function calcDelta(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
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

function DrDeltaBadge({ curr, prev }: { curr: number | null; prev: number | null }) {
  if (curr == null || prev == null) return null
  const diff = curr - prev
  const positive = diff >= 0
  return (
    <span style={{
      fontSize: '0.7rem', fontWeight: 600, marginTop: 2,
      color: positive ? 'var(--green)' : 'var(--red)',
    }}>
      {diff >= 0 ? '+' : ''}{diff.toFixed(1)}
    </span>
  )
}

export default async function AhrefsSummaryCard({
  clientId, dateFrom, dateTo, compareDateFrom, compareDateTo,
}: Props) {
  const db          = createAdminClient()
  const showCompare = !!(compareDateFrom && compareDateTo)

  const [{ data: currRows }, { data: compRows }] = await Promise.all([
    db.from('ahrefs_metrics')
      .select('date, domain_rating, ahrefs_rank, backlinks, referring_domains, organic_keywords, organic_traffic')
      .eq('client_id', clientId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: false })
      .limit(1),
    showCompare
      ? db.from('ahrefs_metrics')
          .select('domain_rating, backlinks, referring_domains, organic_keywords, organic_traffic')
          .eq('client_id', clientId)
          .gte('date', compareDateFrom!)
          .lte('date', compareDateTo!)
          .order('date', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null }),
  ])

  const latest  = currRows?.[0]
  const comp    = compRows?.[0]
  const hasData = !!latest

  const deltaBacklinks  = showCompare ? calcDelta(latest?.backlinks         ?? null, comp?.backlinks         ?? null) : null
  const deltaRefDomains = showCompare ? calcDelta(latest?.referring_domains ?? null, comp?.referring_domains ?? null) : null
  const deltaOrgKw      = showCompare ? calcDelta(latest?.organic_keywords  ?? null, comp?.organic_keywords  ?? null) : null
  const deltaOrgTraffic = showCompare ? calcDelta(latest?.organic_traffic   ?? null, comp?.organic_traffic   ?? null) : null

  return (
    <ConnectionSummaryCard
      title="Authority (Ahrefs)"
      icon={<LinkSimple size={18} />}
      accentColor="#f59e0b"
      href="/dashboard/seo/authority"
      hasData={hasData}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
        {/* Domain Rating — absolute delta */}
        <div>
          <p className="metric-label mb-1">Domain Rating</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: hasData ? 'var(--text-primary)' : 'var(--text-faint)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
            {latest?.domain_rating != null ? latest.domain_rating.toFixed(1) : '—'}
          </p>
          <DrDeltaBadge curr={latest?.domain_rating ?? null} prev={comp?.domain_rating ?? null} />
        </div>

        {/* Backlinks */}
        <div>
          <p className="metric-label mb-1">Backlinks</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: hasData ? 'var(--text-primary)' : 'var(--text-faint)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
            {fmtNum(latest?.backlinks)}
          </p>
          <DeltaBadge delta={deltaBacklinks} />
        </div>

        {/* Referring Domains */}
        <div>
          <p className="metric-label mb-1">Referring Domains</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: hasData ? 'var(--text-primary)' : 'var(--text-faint)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
            {fmtNum(latest?.referring_domains)}
          </p>
          <DeltaBadge delta={deltaRefDomains} />
        </div>

        {/* Ahrefs Rank */}
        <div>
          <p className="metric-label mb-1">Ahrefs Rank</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: hasData ? 'var(--text-primary)' : 'var(--text-faint)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
            {latest?.ahrefs_rank != null ? `#${latest.ahrefs_rank.toLocaleString()}` : '—'}
          </p>
        </div>

        {/* Organic Keywords */}
        <div>
          <p className="metric-label mb-1">Organic Keywords</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: hasData ? 'var(--text-primary)' : 'var(--text-faint)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
            {fmtNum(latest?.organic_keywords)}
          </p>
          <DeltaBadge delta={deltaOrgKw} />
        </div>

        {/* Organic Traffic */}
        <div>
          <p className="metric-label mb-1">Organic Traffic</p>
          <p style={{ fontSize: '1.25rem', fontWeight: 700, color: hasData ? 'var(--text-primary)' : 'var(--text-faint)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
            {fmtNum(latest?.organic_traffic)}
          </p>
          <DeltaBadge delta={deltaOrgTraffic} />
        </div>
      </div>

      {!hasData && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          No data for this period — trigger a sync to populate Ahrefs metrics.
        </p>
      )}
    </ConnectionSummaryCard>
  )
}
