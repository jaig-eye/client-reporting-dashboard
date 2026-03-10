'use client'

import { useState } from 'react'

interface AdRow {
  ad_id: string
  ad_name: string
  ad_type: string | null
  group_name: string | null
  thumbnail_url: string | null
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  roas: number
  cpl: number
  ctr: number
  adFuelSpend?: number
}

type SortKey = 'ad_name' | 'spend' | 'adFuelSpend' | 'clicks' | 'conversions' | 'roas' | 'cpl'

export default function AdTable({
  ads,
  adFuelCut = 0,
}: {
  ads: AdRow[]
  adFuelCut?: number
}) {
  const showAdFuel = adFuelCut > 0
  const [sortKey, setSortKey] = useState<SortKey>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...ads].sort((a, b) => {
    const av = a[sortKey] ?? a.spend
    const bv = b[sortKey] ?? b.spend
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(String(bv)) : String(bv).localeCompare(av)
    return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av)
  })

  if (!ads.length) {
    return (
      <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
        No ad-level data synced yet. Run a sync to populate ad metrics.
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

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 48 }} />
            <SortTh sk="ad_name">Ad</SortTh>
            {showAdFuel ? (
              <>
                <SortTh sk="adFuelSpend">AF Cost</SortTh>
                <SortTh sk="spend">Raw Spend</SortTh>
              </>
            ) : (
              <SortTh sk="spend">Spend</SortTh>
            )}
            <SortTh sk="clicks">Clicks</SortTh>
            <SortTh sk="conversions">Conv.</SortTh>
            <SortTh sk="roas">ROAS</SortTh>
            <SortTh sk="cpl">CPL</SortTh>
            <th>CTR</th>
            <th>Ad Group / Set</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ad) => {
            const showRoas = ad.roas > 0 && ad.conversionValue > 0
            const afRoas   = showAdFuel && ad.adFuelSpend && ad.adFuelSpend > 0
              ? ad.conversionValue / ad.adFuelSpend
              : null

            return (
              <tr key={ad.ad_id}>
                {/* Thumbnail */}
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  {ad.thumbnail_url ? (
                    <img
                      src={ad.thumbnail_url}
                      alt={ad.ad_name}
                      className="h-10 w-10 object-cover rounded"
                      style={{ border: '1px solid var(--border)' }}
                    />
                  ) : (
                    <div
                      className="h-10 w-10 rounded flex items-center justify-center text-xs font-medium"
                      style={{ background: 'var(--bg-subtle)', color: 'var(--text-faint)', border: '1px solid var(--border)' }}
                    >
                      {ad.ad_type ? ad.ad_type.slice(0, 3).toUpperCase() : 'AD'}
                    </div>
                  )}
                </td>

                {/* Ad name */}
                <td
                  className="font-medium"
                  style={{ color: 'var(--text-secondary)', maxWidth: 220 }}
                  title={ad.ad_name}
                >
                  <span className="block truncate">{ad.ad_name || ad.ad_id}</span>
                </td>

                {/* Spend */}
                {showAdFuel ? (
                  <>
                    <td className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      ${(ad.adFuelSpend ?? ad.spend).toFixed(2)}
                    </td>
                    <td style={{ color: 'var(--text-faint)' }}>${ad.spend.toFixed(2)}</td>
                  </>
                ) : (
                  <td style={{ color: 'var(--text-muted)' }}>${ad.spend.toFixed(2)}</td>
                )}

                <td style={{ color: 'var(--text-muted)' }}>{ad.clicks.toLocaleString()}</td>
                <td style={{ color: 'var(--text-muted)' }}>{ad.conversions.toFixed(1)}</td>

                {/* ROAS */}
                <td className="font-semibold whitespace-nowrap">
                  {showRoas ? (
                    <span style={{
                      color: (showAdFuel ? afRoas ?? 0 : ad.roas) >= 3 ? 'var(--green)'
                           : (showAdFuel ? afRoas ?? 0 : ad.roas) >= 1.5 ? '#d97706' : 'var(--red)'
                    }}>
                      {showAdFuel && afRoas != null ? `${afRoas.toFixed(2)}x` : `${ad.roas.toFixed(2)}x`}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-faint)' }}>—</span>
                  )}
                </td>

                <td style={{ color: 'var(--text-muted)' }}>
                  {ad.cpl > 0 ? `$${ad.cpl.toFixed(2)}` : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </td>

                <td style={{ color: 'var(--text-muted)' }}>
                  {ad.ctr > 0 ? `${(ad.ctr * 100).toFixed(2)}%` : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </td>

                <td style={{ color: 'var(--text-muted)', maxWidth: 180 }}>
                  <span className="block truncate text-xs">{ad.group_name ?? '—'}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
