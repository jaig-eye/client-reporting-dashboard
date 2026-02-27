'use client'

import { useState } from 'react'

interface Campaign {
  name: string
  platform: string
  spend: number
  clicks: number
  conversions: number
  roas: number
}

export default function CampaignTable({ campaigns }: { campaigns: Campaign[] }) {
  const [sortKey, setSortKey] = useState<keyof Campaign>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: keyof Campaign) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...campaigns].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(String(bv)) : String(bv).localeCompare(av)
    return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av)
  })

  if (!campaigns.length) {
    return <p className="text-sm text-gray-400 py-4">No campaign data for this period.</p>
  }

  const headers: { key: keyof Campaign; label: string }[] = [
    { key: 'name', label: 'Campaign' },
    { key: 'platform', label: 'Platform' },
    { key: 'spend', label: 'Spend' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'conversions', label: 'Conv.' },
    { key: 'roas', label: 'ROAS' },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            {headers.map(h => (
              <th
                key={h.key}
                onClick={() => toggleSort(h.key)}
                className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700 select-none"
              >
                {h.label}
                {sortKey === h.key && (
                  <span className="ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
              <td className="py-2.5 px-3 font-medium text-gray-900 max-w-xs truncate">{c.name}</td>
              <td className="py-2.5 px-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  c.platform === 'google' ? 'bg-blue-50 text-blue-700' : 'bg-indigo-50 text-indigo-700'
                }`}>
                  {c.platform === 'google' ? 'Google' : 'Meta'}
                </span>
              </td>
              <td className="py-2.5 px-3 text-gray-700">${c.spend.toFixed(2)}</td>
              <td className="py-2.5 px-3 text-gray-700">{c.clicks.toLocaleString()}</td>
              <td className="py-2.5 px-3 text-gray-700">{c.conversions.toFixed(1)}</td>
              <td className="py-2.5 px-3">
                <span className={`font-semibold ${
                  c.roas >= 3 ? 'text-green-600' : c.roas >= 1.5 ? 'text-yellow-600' : 'text-red-500'
                }`}>
                  {c.roas.toFixed(2)}x
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
