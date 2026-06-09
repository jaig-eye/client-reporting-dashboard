'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import type { ColumnKey } from '@/lib/metric-layouts'
import { fmtCurrency } from '@/lib/metrics'

export interface Campaign {
  campaign_id: string
  campaign_name: string
  source: string
  status?: string | null
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  ctr: number
  convRate: number
  cpl: number        // CPA — kept as cpl for backwards compat
  display_mode?: string | null
  daily_budget?: number | null
  adset_budget?: number | null  // Meta: per-ad-set budget when CBO is off
}

type SortKey = 'campaign_name' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'conversions' | 'convRate' | 'cpl'

// DEFAULT_COLUMNS is only used when no layout is passed (should not happen in production).
// Layout-driven column selection happens in dashboard/page.tsx via activeLayout.table_columns.
const DEFAULT_COLUMNS: ColumnKey[] = [
  'campaign_name', 'status', 'spend', 'impressions', 'clicks',
  'ctr', 'conversions', 'conv_rate', 'cpa',
]

export default function CampaignTable({
  campaigns,
  connectionId,
  connectionsBySource,
  dateFrom,
  dateTo,
  compare,
  campaignBasePath = '/dashboard/campaign',
  columns,
}: {
  campaigns: Campaign[]
  connectionId?: string
  connectionsBySource?: Record<string, string>
  dateFrom?: string
  dateTo?: string
  compare?: string
  campaignBasePath?: string
  columns?: ColumnKey[]
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const activeCols = columns ?? DEFAULT_COLUMNS

  function toggleSort(key: SortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir('desc') }
    else if (sortDir === 'desc') setSortDir('asc')
    else setSortKey(null)
  }

  const sorted = sortKey === null ? campaigns : [...campaigns].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(String(bv)) : String(bv).localeCompare(av)
    return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av)
  })

  if (!campaigns.length) {
    return (
      <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
        No campaign data for this period.
      </p>
    )
  }

  function drillLink(c: Campaign) {
    const connId = connectionsBySource?.[c.source] ?? connectionId
    if (!connId) return null
    const qs = new URLSearchParams({
      source: c.source,
      connectionId: connId,
      ...(dateFrom ? { from: dateFrom } : {}),
      ...(dateTo   ? { to:   dateTo   } : {}),
      ...(compare  ? { compare }        : {}),
    })
    return `${campaignBasePath}/${encodeURIComponent(c.campaign_id)}?${qs}`
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const totSpend   = campaigns.reduce((s, c) => s + c.spend, 0)
  const totImpr    = campaigns.reduce((s, c) => s + c.impressions, 0)
  const totClick   = campaigns.reduce((s, c) => s + c.clicks, 0)
  const totConv    = campaigns.reduce((s, c) => s + c.conversions, 0)
  const totRevenue = campaigns.reduce((s, c) => s + c.conversionValue, 0)
  const totCtr     = totImpr  > 0 ? totClick / totImpr  : 0
  const totCR      = totClick > 0 ? totConv  / totClick : 0
  const totCpa     = totConv  > 0 ? totSpend / totConv  : 0
  const totRoas    = totSpend > 0 ? totRevenue / totSpend : 0

  function fmtPct(n: number) { return n > 0 ? `${(n * 100).toFixed(2)}%` : '—' }
  function fmtNum(n: number) { return n > 0 ? n.toLocaleString() : '—' }

  // ── Column definitions ────────────────────────────────────────────────────
  function SortTh({ sk, children, left }: { sk: SortKey; children: React.ReactNode; left?: boolean }) {
    const isAct = sortKey === sk
    return (
      <th onClick={() => toggleSort(sk)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: left ? 'left' : 'right' }}>
        {children}
        {isAct && <span className="ml-1" style={{ opacity: 0.5, display: 'inline-flex', alignItems: 'center' }}>{sortDir === 'desc' ? <CaretDown size={9} aria-hidden /> : <CaretUp size={9} aria-hidden />}</span>}
      </th>
    )
  }

  type ColDef = {
    header: () => React.ReactNode
    cell: (c: Campaign) => React.ReactNode
    foot: () => React.ReactNode
  }

  const COL: Record<ColumnKey, ColDef> = {
    campaign_name: {
      header: () => <SortTh sk="campaign_name" left>Name</SortTh>,
      cell: (c) => {
        const link = drillLink(c)
        return (
          <td className="font-medium" style={{ color: 'var(--text-secondary)', maxWidth: 260 }} title={c.campaign_name}>
            {link ? (
              <Link href={link} className="block truncate hover:underline" style={{ color: 'var(--blue)' }}>{c.campaign_name}</Link>
            ) : (
              <span className="block truncate">{c.campaign_name}</span>
            )}
          </td>
        )
      },
      foot: () => <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</td>,
    },
    status: {
      header: () => <th style={{ whiteSpace: 'nowrap' }}>Status</th>,
      cell: (c) => {
        const statusUp = (c.status ?? '').toUpperCase()
        const isActive = !c.status || statusUp === 'ENABLED' || statusUp === 'ACTIVE'
        const isPaused = statusUp === 'PAUSED'
        return (
          <td>
            {c.status ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', fontWeight: 600, color: isActive ? 'var(--green)' : isPaused ? '#d97706' : 'var(--text-faint)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: isActive ? 'var(--green)' : isPaused ? '#d97706' : '#9ca3af' }} />
                {isActive ? 'Active' : isPaused ? 'Paused' : statusUp.charAt(0) + statusUp.slice(1).toLowerCase()}
              </span>
            ) : (
              <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</span>
            )}
          </td>
        )
      },
      foot: () => <td></td>,
    },
    spend: {
      header: () => <SortTh sk="spend">Cost</SortTh>,
      cell: (c) => <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtCurrency(c.spend)}</td>,
      foot: () => <td className="text-xs" style={{ textAlign: 'right' }}>{fmtCurrency(totSpend)}</td>,
    },
    impressions: {
      header: () => <SortTh sk="impressions">Impr.</SortTh>,
      cell: (c) => <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{c.impressions > 0 ? c.impressions.toLocaleString() : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>,
      foot: () => <td className="text-xs" style={{ textAlign: 'right' }}>{totImpr.toLocaleString()}</td>,
    },
    clicks: {
      header: () => <SortTh sk="clicks">Clicks</SortTh>,
      cell: (c) => <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{c.clicks.toLocaleString()}</td>,
      foot: () => <td className="text-xs" style={{ textAlign: 'right' }}>{totClick.toLocaleString()}</td>,
    },
    ctr: {
      header: () => <SortTh sk="ctr">CTR</SortTh>,
      cell: (c) => <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{c.ctr > 0 ? `${(c.ctr * 100).toFixed(2)}%` : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>,
      foot: () => <td className="text-xs" style={{ textAlign: 'right' }}>{fmtPct(totCtr)}</td>,
    },
    conversions: {
      header: () => <SortTh sk="conversions">Conv.</SortTh>,
      cell: (c) => <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{c.conversions > 0 ? c.conversions.toFixed(1) : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>,
      foot: () => <td className="text-xs" style={{ textAlign: 'right' }}>{totConv > 0 ? totConv.toFixed(1) : '—'}</td>,
    },
    conv_rate: {
      header: () => <SortTh sk="convRate">Conv Rate</SortTh>,
      cell: (c) => <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{c.convRate > 0 ? `${(c.convRate * 100).toFixed(2)}%` : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>,
      foot: () => <td className="text-xs" style={{ textAlign: 'right' }}>{fmtPct(totCR)}</td>,
    },
    cpa: {
      header: () => <SortTh sk="cpl">CPA</SortTh>,
      cell: (c) => <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{c.cpl > 0 ? fmtCurrency(c.cpl) : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>,
      foot: () => <td className="text-xs" style={{ textAlign: 'right' }}>{totCpa > 0 ? fmtCurrency(totCpa) : '—'}</td>,
    },
    roas: {
      header: () => <th style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>ROAS</th>,
      cell: (c) => {
        const roas = c.spend > 0 && c.conversionValue > 0 ? c.conversionValue / c.spend : 0
        return <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{roas > 0 ? `${roas.toFixed(2)}x` : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
      },
      foot: () => <td className="text-xs" style={{ textAlign: 'right' }}>{totRoas > 0 ? `${totRoas.toFixed(2)}x` : '—'}</td>,
    },
    revenue: {
      header: () => <th style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>Revenue</th>,
      cell: (c) => <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{c.conversionValue > 0 ? fmtCurrency(c.conversionValue) : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>,
      foot: () => <td className="text-xs" style={{ textAlign: 'right' }}>{totRevenue > 0 ? fmtCurrency(totRevenue) : '—'}</td>,
    },
    daily_budget: {
      header: () => <th style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>Daily Budget</th>,
      cell: (c) => <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{c.daily_budget ? fmtCurrency(c.daily_budget) : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>,
      foot: () => <td></td>,
    },
    adset_budget: {
      header: () => <th style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>Ad Set Budget</th>,
      cell: (c) => <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{c.adset_budget ? fmtCurrency(c.adset_budget) : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>,
      foot: () => <td></td>,
    },
  }

  const visibleCols = activeCols.filter(k => k in COL)

  const minWidth = Math.max(400, visibleCols.length * 90)

  return (
    <div className="overflow-x-auto">
      <table className="data-table" style={{ minWidth }}>
        <thead>
          <tr>
            {visibleCols.map(k => <React.Fragment key={k}>{COL[k].header()}</React.Fragment>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => (
            <tr key={i}>
              {visibleCols.map(k => <React.Fragment key={k}>{COL[k].cell(c)}</React.Fragment>)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
            {visibleCols.map(k => <React.Fragment key={k}>{COL[k].foot()}</React.Fragment>)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
