'use client'

import { useState } from 'react'
import type { CampaignCategory } from '@/lib/types'

interface Campaign {
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
  category: CampaignCategory | null
}

type SortKey = 'campaign_name' | 'spend' | 'clicks' | 'conversions' | 'roas' | 'cpl'

export default function CampaignTable({ campaigns }: { campaigns: Campaign[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...campaigns].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey]
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

  const headers: { key: SortKey; label: string }[] = [
    { key: 'campaign_name', label: 'Campaign' },
    { key: 'spend',         label: 'Spend' },
    { key: 'clicks',        label: 'Clicks' },
    { key: 'conversions',   label: 'Conv.' },
    { key: 'roas',          label: 'ROAS' },
    { key: 'cpl',           label: 'CPL' },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h.key} onClick={() => toggleSort(h.key)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                {h.label}
                {sortKey === h.key && (
                  <span className="ml-1" style={{ opacity: 0.5 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>
                )}
              </th>
            ))}
            <th>Category</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => {
            const showRoas = c.category?.display_mode === 'ecommerce' || (c.roas > 0 && c.conversionValue > 0)
            const convLabel = c.category?.conversion_label
            return (
              <tr key={i}>
                <td
                  className="font-medium"
                  style={{ color: 'var(--text-secondary)', maxWidth: 260 }}
                  title={c.campaign_name}
                >
                  <span className="block truncate">{c.campaign_name}</span>
                </td>
                <td style={{ color: 'var(--text-muted)' }}>${c.spend.toFixed(2)}</td>
                <td style={{ color: 'var(--text-muted)' }}>{c.clicks.toLocaleString()}</td>
                <td style={{ color: 'var(--text-muted)' }}>
                  {c.conversions.toFixed(1)}
                  {convLabel && (
                    <span className="ml-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                      {convLabel.toLowerCase()}
                    </span>
                  )}
                </td>
                <td className="font-semibold whitespace-nowrap">
                  {showRoas ? (
                    <span style={{
                      color: c.roas >= 3 ? 'var(--green)' : c.roas >= 1.5 ? '#d97706' : 'var(--red)'
                    }}>
                      {c.roas.toFixed(2)}x
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-faint)' }}>—</span>
                  )}
                </td>
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
