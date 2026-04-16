// Ahrefs Summary Card — shown on the dashboard cockpit when ahrefs connector is connected.
// Displays the most recent Domain Rating, backlinks, referring domains, and organic traffic.

import { createAdminClient } from '@/lib/supabase/server'
import ConnectionSummaryCard from './ConnectionSummaryCard'
import { LinkSimple } from '@phosphor-icons/react/dist/ssr'

interface Props {
  clientId:     string
  dateFrom:     string
  dateTo:       string
}

export default async function AhrefsSummaryCard({ clientId, dateFrom, dateTo }: Props) {
  const db = createAdminClient()

  const { data: rows } = await db
    .from('ahrefs_metrics')
    .select('date, domain_rating, ahrefs_rank, backlinks, referring_domains, organic_keywords, organic_traffic')
    .eq('client_id', clientId)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: false })
    .limit(1)

  const latest = rows?.[0]
  const hasData = !!latest

  function fmtNum(n: number | null | undefined) {
    if (n == null) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
    return n.toLocaleString()
  }

  const metrics = [
    { label: 'Domain Rating',     value: latest?.domain_rating != null ? latest.domain_rating.toFixed(1) : '—' },
    { label: 'Backlinks',         value: fmtNum(latest?.backlinks) },
    { label: 'Referring Domains', value: fmtNum(latest?.referring_domains) },
    { label: 'Ahrefs Rank',       value: latest?.ahrefs_rank != null ? `#${latest.ahrefs_rank.toLocaleString()}` : '—' },
    { label: 'Organic Keywords',  value: fmtNum(latest?.organic_keywords) },
    { label: 'Organic Traffic',   value: fmtNum(latest?.organic_traffic) },
  ]

  return (
    <ConnectionSummaryCard
      title="Authority (Ahrefs)"
      icon={<LinkSimple size={18} />}
      accentColor="#f59e0b"
      href="/dashboard/seo/authority"
      hasData={hasData}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
        {metrics.map(m => (
          <div key={m.label}>
            <p className="metric-label mb-1">{m.label}</p>
            <p style={{ fontSize: '1.25rem', fontWeight: 700, color: hasData ? 'var(--text-primary)' : 'var(--text-faint)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
              {m.value}
            </p>
          </div>
        ))}
      </div>
      {!hasData && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          No data for this period — trigger a sync to populate Ahrefs metrics.
        </p>
      )}
    </ConnectionSummaryCard>
  )
}
