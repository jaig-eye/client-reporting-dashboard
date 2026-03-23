'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { CampaignCategory } from '@/lib/types'

interface Campaign {
  campaign_id: string
  campaign_name: string
  source: string
  spend: number
  clicks: number
  conversions: number
  conversionValue: number
  roas: number
  cpl: number
  ctr: number
  impressions: number
  cpm: number
  adFuelSpend?: number
  category: CampaignCategory | null
}

type SortKey = 'campaign_name' | 'spend' | 'adFuelSpend' | 'clicks' | 'conversions' | 'roas' | 'cpl'

export default function CampaignTable({
  campaigns,
  adFuelCut = 0,
  isEcomDash = false,
  connectionId,
  dateFrom,
  dateTo,
}: {
  campaigns: Campaign[]
  adFuelCut?: number
  isEcomDash?: boolean
  connectionId?: string
  dateFrom?: string
  dateTo?: string
}) {
  const showAdFuel = adFuelCut > 0

  const [sortKey, setSortKey] = useState<SortKey>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...campaigns].sort((a, b) => {
    const av = a[sortKey] ?? a.spend
    const bv = b[sortKey] ?? b.spend
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

  function SortTh({ sk, children }: { sk: SortKey; children: React.ReactNode }) {
    return (
      <th onClick={() => toggleSort(sk)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        {children}
        {sortKey === sk && (
          <span className="ml-1" style={{ opacity: 0.5 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>
        )}
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
    })
    return `/dashboard/campaign/${encodeURIComponent(c.campaign_id)}?${qs}`
  }

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <SortTh sk="campaign_name">Campaign</SortTh>
            <SortTh sk={showAdFuel ? 'adFuelSpend' : 'spend'}>
              {showAdFuel ? 'Ad Fuel Cost' : 'Spend'}
            </SortTh>
            <SortTh sk="clicks">Clicks</SortTh>
            <SortTh sk="conversions">Conv.</SortTh>
            {isEcomDash ? (
              <SortTh sk="roas">ROAS</SortTh>
            ) : (
              <th style={{ color: 'var(--text-muted)' }}>CTR</th>
            )}
            <SortTh sk="cpl">CPL</SortTh>
            <th>Category</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => {
            const rowIsEcom = c.category?.display_mode === 'ecommerce'
            const convLabel = c.category?.conversion_label
            const link      = drillLink(c)
            const displaySpend = showAdFuel ? (c.adFuelSpend ?? c.spend) : c.spend

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
                <td style={{ color: 'var(--text-muted)' }}>${displaySpend.toFixed(2)}</td>
                <td style={{ color: 'var(--text-muted)' }}>{c.clicks.toLocaleString()}</td>
                <td style={{ color: 'var(--text-muted)' }}>
                  {c.conversions.toFixed(1)}
                  {convLabel && (
                    <span className="ml-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                      {convLabel.toLowerCase()}
                    </span>
                  )}
                </td>
                {isEcomDash ? (
                  <td className="font-semibold whitespace-nowrap">
                    {rowIsEcom && c.roas > 0 ? (
                      <span style={{ color: c.roas >= 3 ? 'var(--green)' : c.roas >= 1.5 ? '#d97706' : 'var(--red)' }}>
                        {c.roas.toFixed(2)}x
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-faint)' }}>—</span>
                    )}
                  </td>
                ) : (
                  <td style={{ color: 'var(--text-muted)' }}>
                    {c.ctr > 0 ? `${(c.ctr * 100).toFixed(2)}%` : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                  </td>
                )}
                <td style={{ color: 'var(--text-muted)' }}>
                  {c.cpl > 0 ? `$${c.cpl.toFixed(2)}` : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </td>
                <td>
                  {c.category ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ background: c.category.color }}
                      />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {c.category.name}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>—</span>
                  )}
                </td>
                <td>
                  <span
                    className="badge"
                    style={{
                      background: c.source === 'google_ads' ? '#eff6ff' : '#f5f3ff',
                      color:      c.source === 'google_ads' ? '#2563eb' : '#7c3aed',
                      border:     c.source === 'google_ads' ? '1px solid #bfdbfe' : '1px solid #ddd6fe',
                    }}
                  >
                    {c.source === 'google_ads' ? 'Google' : 'Meta'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
