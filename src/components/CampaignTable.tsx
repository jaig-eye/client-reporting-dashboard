'use client'

import React, { useState } from 'react'
import Link from 'next/link'

export interface Campaign {
  campaign_id: string
  campaign_name: string
  source: string          // kept for drill-down URL, not displayed
  status?: string | null  // ENABLED, PAUSED, REMOVED, etc.
  spend: number           // cost after markup ("Cost")
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  ctr: number
  convRate: number        // conversions / clicks
  cpl: number
  display_mode?: string | null
}

type SortKey = 'campaign_name' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'conversions' | 'convRate' | 'cpl'

export default function CampaignTable({
  campaigns,
  connectionId,
  dateFrom,
  dateTo,
  compare,
  campaignBasePath = '/dashboard/campaign',
}: {
  campaigns: Campaign[]
  connectionId?: string
  dateFrom?: string
  dateTo?: string
  compare?: string
  campaignBasePath?: string
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

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

  function SortTh({ sk, children, left }: { sk: SortKey; children: React.ReactNode; left?: boolean }) {
    const isActive = sortKey === sk
    return (
      <th onClick={() => toggleSort(sk)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: left ? 'left' : 'right' }}>
        {children}
        {isActive && <span className="ml-1" style={{ opacity: 0.5 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
      </th>
    )
  }

  function drillLink(c: Campaign) {
    if (!connectionId) return null
    const qs = new URLSearchParams({
      source: c.source,
      connectionId,
      ...(dateFrom ? { from: dateFrom } : {}),
      ...(dateTo   ? { to:   dateTo   } : {}),
      ...(compare  ? { compare }        : {}),
    })
    return `${campaignBasePath}/${encodeURIComponent(c.campaign_id)}?${qs}`
  }

  // Totals
  const totSpend = campaigns.reduce((s, c) => s + c.spend, 0)
  const totImpr  = campaigns.reduce((s, c) => s + c.impressions, 0)
  const totClick = campaigns.reduce((s, c) => s + c.clicks, 0)
  const totConv  = campaigns.reduce((s, c) => s + c.conversions, 0)
  const totCtr   = totImpr > 0 ? totClick / totImpr : 0
  const totCR    = totClick > 0 ? totConv / totClick : 0
  const totCpl   = totConv > 0 ? totSpend / totConv : 0

  return (
    <div className="overflow-x-auto">
      <table className="data-table" style={{ minWidth: 860 }}>
        <thead>
          <tr>
            <SortTh sk="campaign_name" left>Campaign</SortTh>
            <th style={{ whiteSpace: 'nowrap' }}>Status</th>
            <SortTh sk="spend">Cost</SortTh>
            <SortTh sk="impressions">Impr.</SortTh>
            <SortTh sk="clicks">Clicks</SortTh>
            <SortTh sk="ctr">CTR</SortTh>
            <SortTh sk="conversions">Conv.</SortTh>
            <SortTh sk="convRate">Conv Rate</SortTh>
            <SortTh sk="cpl">CPL</SortTh>
            <th style={{ whiteSpace: 'nowrap' }}>Mode</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => {
            const link      = drillLink(c)
            const isEcom    = c.display_mode === 'ecommerce'
            const statusUp  = (c.status ?? '').toUpperCase()
            const isActive  = !c.status || statusUp === 'ENABLED' || statusUp === 'ACTIVE'
            const isPaused  = statusUp === 'PAUSED'

            return (
              <tr key={i}>
                <td
                  className="font-medium"
                  style={{ color: 'var(--text-secondary)', maxWidth: 260 }}
                  title={c.campaign_name}
                >
                  {link ? (
                    <Link
                      href={link}
                      className="block truncate hover:underline"
                      style={{ color: 'var(--blue)' }}
                    >
                      {c.campaign_name}
                    </Link>
                  ) : (
                    <span className="block truncate">{c.campaign_name}</span>
                  )}
                </td>
                <td>
                  {c.status ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: '0.7rem', fontWeight: 600,
                      color: isActive ? 'var(--green)' : isPaused ? '#d97706' : 'var(--text-faint)',
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: isActive ? 'var(--green)' : isPaused ? '#d97706' : '#9ca3af',
                      }} />
                      {isActive ? 'Active' : isPaused ? 'Paused' : statusUp.charAt(0) + statusUp.slice(1).toLowerCase()}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</span>
                  )}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>${c.spend.toFixed(2)}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {c.impressions > 0 ? c.impressions.toLocaleString() : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{c.clicks.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {c.ctr > 0 ? `${(c.ctr * 100).toFixed(2)}%` : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {c.conversions > 0 ? c.conversions.toFixed(1) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {c.convRate > 0 ? `${(c.convRate * 100).toFixed(2)}%` : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {c.cpl > 0 ? `$${c.cpl.toFixed(2)}` : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </td>
                <td>
                  <span
                    className="badge"
                    style={isEcom
                      ? { background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }
                      : { background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }
                    }
                  >
                    {isEcom ? 'Ecom' : 'Lead Gen'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
            <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
            </td>
            <td></td>
            <td className="text-xs" style={{ textAlign: 'right' }}>${totSpend.toFixed(2)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totImpr.toLocaleString()}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totClick.toLocaleString()}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totCtr > 0 ? `${(totCtr * 100).toFixed(2)}%` : '—'}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totConv > 0 ? totConv.toFixed(1) : '—'}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totCR > 0 ? `${(totCR * 100).toFixed(2)}%` : '—'}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totCpl > 0 ? `$${totCpl.toFixed(2)}` : '—'}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
