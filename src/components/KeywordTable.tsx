'use client'

import { useState } from 'react'
import StatusPill from './dashboard/StatusPill'
import SortableTh from './dashboard/SortableTh'

export interface KeywordRow {
  keyword_text:      string
  match_type:        string | null
  keyword_status:    string | null
  impressions:       number
  clicks:            number
  conversions:       number
  spend:             number
  displaySpend:      number   // after adFuel
  ctr:               number
  cpc:               number
  cpl:               number
}

type SortKey = 'keyword_text' | 'impressions' | 'clicks' | 'spend' | 'conversions' | 'cpl'

const MATCH_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  BROAD:  { bg: 'var(--amber-subtle)', color: 'var(--amber)', label: 'Broad' },
  PHRASE: { bg: 'var(--green-subtle)', color: 'var(--green)', label: 'Phrase' },
  EXACT:  { bg: 'var(--blue-subtle)', color: 'var(--blue)', label: 'Exact' },
}

function matchBadge(mt: string | null) {
  const style = MATCH_BADGE[mt ?? ''] ?? { bg: 'var(--bg-subtle)', color: 'var(--text-muted)', label: mt ?? '—' }
  return (
    <span
      style={{
        display: 'inline-block', padding: '1px 7px', borderRadius: 99, fontSize: '0.68rem',
        fontWeight: 600, letterSpacing: '0.03em', whiteSpace: 'nowrap',
        background: style.bg, color: style.color,
      }}
    >
      {style.label}
    </span>
  )
}

function fmt$(n: number) {
  return n >= 1000
    ? `$${(n / 1000).toFixed(1)}k`
    : `$${n.toFixed(2)}`
}

export default function KeywordTable({
  rows,
  conversionLabel = 'Conv.',
  isEcom = false,
  adFuelLabel = 'Cost',
}: {
  rows: KeywordRow[]
  conversionLabel?: string
  isEcom?: boolean
  adFuelLabel?: string
}) {
  const [sortKey, setSortKey] = useState<SortKey>('impressions')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('desc') }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey]; const bv = b[sortKey]
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(String(bv)) : String(bv).localeCompare(av)
    return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av)
  })

  if (!rows.length) {
    return (
      <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
        No keyword data for this period.
      </p>
    )
  }

  function SortTh({ sk, children, right }: { sk: SortKey; children: React.ReactNode; right?: boolean }) {
    return <SortableTh active={sortKey === sk} dir={sortDir} onSort={() => toggleSort(sk)} align={right ? 'right' : 'left'}>{children}</SortableTh>
  }

  return (
    <div className="table-scroll">
      <table className="data-table ads-table">
        <thead>
          <tr>
            <SortTh sk="keyword_text">Keyword</SortTh>
            <th className="ads-table__status-th">Status</th>
            <th style={{ whiteSpace: 'nowrap' }}>Match</th>
            <SortTh sk="impressions" right>Impressions</SortTh>
            <SortTh sk="clicks" right>Clicks</SortTh>
            <th style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>CTR</th>
            <SortTh sk="spend" right>{adFuelLabel}</SortTh>
            <th style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>Avg. CPC</th>
            <SortTh sk="conversions" right>{conversionLabel}</SortTh>
            {!isEcom && <SortTh sk="cpl" right>CPA</SortTh>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            return (
              <tr key={i}>
                <td className="ads-table__name" style={{ maxWidth: 300 }}>
                  <span title={r.keyword_text} className="ads-table__title ads-table__title--mono">
                    {r.keyword_text}
                  </span>
                </td>
                <td><StatusPill status={r.keyword_status ?? 'ENABLED'} activeLabel="Enabled" /></td>
                <td>{matchBadge(r.match_type)}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{r.impressions.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{r.clicks.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {r.ctr > 0 ? `${(r.ctr * 100).toFixed(2)}%` : '—'}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt$(r.displaySpend)}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {r.cpc > 0 ? `$${r.cpc.toFixed(2)}` : '—'}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {r.conversions > 0 ? r.conversions.toFixed(1) : '—'}
                </td>
                {!isEcom && (
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                    {r.cpl > 0 ? `$${r.cpl.toFixed(2)}` : '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
