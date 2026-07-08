'use client'

import { useState, useMemo } from 'react'
import type { MetaAdRow, GoogleAdRow } from '@/lib/ads-library'
import { AdLibraryCard, isAdActive } from './AdLibraryCard'

type Platform     = 'all' | 'meta' | 'google'
type StatusFilter = 'all' | 'active' | 'paused'
type SortKey      = 'spend' | 'impressions' | 'ctr'

function ctr(ad: MetaAdRow | GoogleAdRow): number {
  return ad.impressions > 0 ? ad.clicks / ad.impressions : 0
}

function pill(active: boolean): React.CSSProperties {
  return {
    padding: '0.375rem 0.875rem',
    borderRadius: 6,
    fontSize: '0.8125rem',
    fontWeight: 500,
    cursor: 'pointer',
    border: active ? '1.5px solid #3b82f6' : '1.5px solid #e5e7eb',
    background: active ? '#eff6ff' : '#fff',
    color: active ? '#1d4ed8' : '#4b5563',
  }
}

export function AdLibraryView({ meta, google }: { meta: MetaAdRow[]; google: GoogleAdRow[] }) {
  const [platform, setPlatform] = useState<Platform>('all')
  const [status,   setStatus]   = useState<StatusFilter>('all')
  const [sort,     setSort]     = useState<SortKey>('spend')

  const ads = useMemo(() => {
    let list: (MetaAdRow | GoogleAdRow)[] = []
    if (platform === 'all' || platform === 'meta')   list = list.concat(meta)
    if (platform === 'all' || platform === 'google') list = list.concat(google)
    if (status === 'active') list = list.filter(a => isAdActive(a.ad_status))
    if (status === 'paused') list = list.filter(a => !isAdActive(a.ad_status))
    if (sort === 'spend')       list = [...list].sort((a, b) => b.spend - a.spend)
    if (sort === 'impressions') list = [...list].sort((a, b) => b.impressions - a.impressions)
    if (sort === 'ctr')         list = [...list].sort((a, b) => ctr(b) - ctr(a))
    return list
  }, [meta, google, platform, status, sort])

  return (
    <div>
      {/* Controls */}
      <div style={{
        display: 'flex', gap: '0.625rem', flexWrap: 'wrap',
        alignItems: 'center', marginBottom: '1.5rem',
      }}>
        {/* Platform */}
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {(['all', 'meta', 'google'] as Platform[]).map(p => (
            <button key={p} onClick={() => setPlatform(p)} style={pill(platform === p)}>
              {p === 'all' ? 'All' : p === 'meta' ? 'Meta' : 'Google'}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 22, background: '#e5e7eb', flexShrink: 0 }} />

        {/* Status */}
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {(['all', 'active', 'paused'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatus(s)} style={pill(status === s)}>
              {s === 'all' ? 'All status' : s === 'active' ? 'Active' : 'Paused'}
            </button>
          ))}
        </div>

        {/* Sort — pushed right */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>Sort by</span>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            style={{
              padding: '0.3125rem 0.625rem', borderRadius: 6,
              border: '1.5px solid #e5e7eb', fontSize: '0.8125rem',
              color: '#374151', background: '#fff', cursor: 'pointer',
            }}
          >
            <option value="spend">Spend</option>
            <option value="impressions">Impressions</option>
            <option value="ctr">CTR</option>
          </select>
        </div>
      </div>

      {ads.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '4rem 2rem',
          border: '1.5px dashed #e5e7eb', borderRadius: 12,
          color: '#6b7280', fontSize: '0.9375rem',
        }}>
          No ads match the current filter.
        </div>
      ) : (
        <>
          <p style={{ margin: '0 0 1rem', color: '#6b7280', fontSize: '0.8125rem' }}>
            {ads.length} {ads.length === 1 ? 'ad' : 'ads'}
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1rem',
          }}>
            {ads.map(ad => (
              <AdLibraryCard key={`${ad.platform}-${ad.ad_id}`} ad={ad} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
