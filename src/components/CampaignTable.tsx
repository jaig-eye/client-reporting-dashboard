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

  if (!campaigns.length) return <p className="text-sm text-slate-500 py-6 text-center">No campaign data for this period.</p>

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
          <tr className="border-b border-[#1e2a40]">
            {headers.map(h => (
              <th
                key={h.key}
                onClick={() => toggleSort(h.key)}
                className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-300 select-none whitespace-nowrap transition-colors"
              >
                {h.label}{sortKey === h.key && <span className="ml-1 opacity-60">{sortDir === 'desc' ? '↓' : '↑'}</span>}
              </th>
            ))}
            <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Platform</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1e2a40]">
          {sorted.map((c, i) => (
            <tr key={i} className="hover:bg-[#151c30] transition-colors">
              <td className="py-3 px-3 font-medium text-slate-200 max-w-[260px] truncate" title={c.name}>{c.name}</td>
              <td className="py-3 px-3 text-slate-400 whitespace-nowrap">${c.spend.toFixed(2)}</td>
              <td className="py-3 px-3 text-slate-400">{c.clicks.toLocaleString()}</td>
              <td className="py-3 px-3 text-slate-400">{c.conversions.toFixed(1)}</td>
              <td className="py-3 px-3 font-semibold whitespace-nowrap" style={{
                color: c.roas >= 3 ? '#10b981' : c.roas >= 1.5 ? '#f59e0b' : '#f87171'
              }}>
                {c.roas.toFixed(2)}x
              </td>
              <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
                {c.cpl > 0 ? `$${c.cpl.toFixed(2)}` : '—'}
              </td>
              <td className="py-3 px-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  c.platform === 'google' ? 'bg-blue-500/10 text-blue-400' : 'bg-indigo-500/10 text-indigo-400'
                }`}>{c.platform === 'google' ? 'Google' : 'Meta'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
