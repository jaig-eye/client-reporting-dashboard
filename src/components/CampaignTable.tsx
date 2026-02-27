'use client'

import { useState } from 'react'

interface Campaign {
  name: string
  platform: string
  spend: number
  clicks: number
  conversions: number
  roas: number
  cpl: number
  ctr: number
  impressions: number
}

type SortKey = 'spend' | 'clicks' | 'conversions' | 'roas' | 'cpl' | 'name'

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

  if (!campaigns.length) return <p className="text-sm text-gray-400 py-6 text-center">No campaign data for this period.</p>

  const headers: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Campaign' },
    { key: 'spend', label: 'Spend' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'conversions', label: 'Conv.' },
    { key: 'roas', label: 'ROAS' },
    { key: 'cpl', label: 'CPL' },
  ]

  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-gray-100">
            {headers.map(h => (
              <th
                key={h.key}
                onClick={() => toggleSort(h.key)}
                className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-800 select-none whitespace-nowrap"
              >
                {h.label}{sortKey === h.key && <span className="ml-1 opacity-60">{sortDir === 'desc' ? '↓' : '↑'}</span>}
              </th>
            ))}
            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Platform</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {sorted.map((c, i) => (
            <tr key={i} className="hover:bg-gray-50 transition-colors">
              <td className="py-3 px-3 font-medium text-gray-900 max-w-[260px] truncate" title={c.name}>{c.name}</td>
              <td className="py-3 px-3 text-gray-700 whitespace-nowrap">${c.spend.toFixed(2)}</td>
              <td className="py-3 px-3 text-gray-700">{c.clicks.toLocaleString()}</td>
              <td className="py-3 px-3 text-gray-700">{c.conversions.toFixed(1)}</td>
              <td className="py-3 px-3 font-semibold whitespace-nowrap" style={{
                color: c.roas >= 3 ? '#059669' : c.roas >= 1.5 ? '#d97706' : '#ef4444'
              }}>
                {c.roas.toFixed(2)}x
              </td>
              <td className="py-3 px-3 text-gray-700 whitespace-nowrap">
                {c.cpl > 0 ? `$${c.cpl.toFixed(2)}` : '—'}
              </td>
              <td className="py-3 px-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  c.platform === 'google' ? 'bg-blue-50 text-blue-700' : 'bg-indigo-50 text-indigo-700'
                }`}>{c.platform === 'google' ? 'Google' : 'Meta'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
