// Ahrefs Summary Card — shown on the dashboard cockpit when ahrefs connector is connected.
// Displays the most recent Domain Rating, backlinks, referring domains, and organic traffic.
// Supports optional comparison period to show delta badges.

import React from 'react'
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

  const tileDefs: Array<{ key: string; label: string; display: string; delta?: React.ReactNode }> = [
    {
      key:     'domain_rating',
      label:   'Domain Rating',
      display: latest?.domain_rating != null ? latest.domain_rating.toFixed(1) : null!,
      delta:   <DrDeltaBadge curr={latest?.domain_rating ?? null} prev={comp?.domain_rating ?? null} />,
    },
    {
      key:     'backlinks',
      label:   'Backlinks',
      display: latest?.backlinks != null ? fmtNum(latest.backlinks) : null!,
      delta:   <DeltaBadge delta={deltaBacklinks} />,
    },
    {
      key:     'referring_domains',
      label:   'Referring Domains',
      display: latest?.referring_domains != null ? fmtNum(latest.referring_domains) : null!,
      delta:   <DeltaBadge delta={deltaRefDomains} />,
    },
    {
      key:     'ahrefs_rank',
      label:   'Ahrefs Rank',
      display: latest?.ahrefs_rank != null ? `#${latest.ahrefs_rank.toLocaleString()}` : null!,
    },
    {
      key:     'organic_keywords',
      label:   'Organic Keywords',
      display: latest?.organic_keywords != null ? fmtNum(latest.organic_keywords) : null!,
      delta:   <DeltaBadge delta={deltaOrgKw} />,
    },
    {
      key:     'organic_traffic',
      label:   'Organic Traffic',
      display: latest?.organic_traffic != null ? fmtNum(latest.organic_traffic) : null!,
      delta:   <DeltaBadge delta={deltaOrgTraffic} />,
    },
  ].filter(t => t.display != null)

  return (
    <ConnectionSummaryCard
      title="Authority (Ahrefs)"
      icon={<LinkSimple size={18} />}
      accentColor="#f59e0b"
      href="/dashboard/seo/authority"
      hasData={hasData}
    >
      {tileDefs.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
          {tileDefs.map(t => (
            <div key={t.key}>
              <p className="metric-label mb-1">{t.label}</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
                {t.display}
              </p>
              {t.delta}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          No data for this period — trigger a sync to populate Ahrefs metrics.
        </p>
      )}
    </ConnectionSummaryCard>
  )
}
