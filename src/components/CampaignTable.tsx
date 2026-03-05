'use client'

import { useState } from 'react'
import { GOAL_TYPE_DEFS, shouldShowRoas } from '@/lib/goal-types'
import type { GoalType } from '@/lib/types'

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
  goalType: GoalType
  conversionLabel: string
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

  const thCls = 'text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-300 select-none whitespace-nowrap transition-colors'

  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {headers.map(h => (
              <th key={h.key} onClick={() => toggleSort(h.key)} className={thCls}>
                {h.label}{sortKey === h.key && <span className="ml-1 opacity-50">{sortDir === 'desc' ? '↓' : '↑'}</span>}
              </th>
            ))}
            <th className={`${thCls} cursor-default hover:text-slate-500`}>Goal</th>
            <th className={`${thCls} cursor-default hover:text-slate-500`}>Platform</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => {
            const def = GOAL_TYPE_DEFS[c.goalType]
            const showRoas = shouldShowRoas(c.goalType)
            return (
              <tr
                key={i}
                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                className="transition-colors hover:bg-white/[0.025]"
              >
                <td className="py-3 px-3 font-medium text-slate-200 max-w-[260px] truncate" title={c.name}>
                  {c.name}
                </td>
                <td className="py-3 px-3 text-slate-400 whitespace-nowrap">${c.spend.toFixed(2)}</td>
                <td className="py-3 px-3 text-slate-400">{c.clicks.toLocaleString()}</td>
                <td className="py-3 px-3 text-slate-400">
                  <span>{c.conversions.toFixed(1)}</span>
                  {c.conversionLabel && c.goalType !== 'unset' && (
                    <span className="text-slate-600 ml-1 text-xs">{c.conversionLabel.toLowerCase()}</span>
                  )}
                </td>
                <td className="py-3 px-3 font-semibold whitespace-nowrap">
                  {showRoas ? (
                    <span style={{ color: c.roas >= 3 ? '#10b981' : c.roas >= 1.5 ? '#f59e0b' : '#f87171' }}>
                      {c.roas.toFixed(2)}x
                    </span>
                  ) : (
                    <span className="text-slate-700">—</span>
                  )}
                </td>
                <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
                  {!showRoas && c.cpl > 0 ? `$${c.cpl.toFixed(2)}` : <span className="text-slate-700">—</span>}
                </td>
                <td className="py-3 px-3">
                  {c.goalType !== 'unset' ? (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${def.badgeClasses}`}>
                      {def.badge}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-700">—</span>
                  )}
                </td>
                <td className="py-3 px-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    c.platform === 'google' ? 'bg-blue-500/10 text-blue-400' : 'bg-indigo-500/10 text-indigo-400'
                  }`}>
                    {c.platform === 'google' ? 'Google' : 'Meta'}
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
