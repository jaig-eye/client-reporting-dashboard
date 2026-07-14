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
    whiteSpace: 'nowrap',
    border:     active ? '1.5px solid #3b82f6' : '1.5px solid #e5e7eb',
    background: active ? '#eff6ff' : '#fff',
    color:      active ? '#1d4ed8' : '#4b5563',
  }
}

export function AdLibraryView({
  meta,
  google,
  token,
}: {
  meta:    MetaAdRow[]
  google:  GoogleAdRow[]
  token?:  string
}) {
  const [platform, setPlatform] = useState<Platform>('all')
  const [status,   setStatus]   = useState<StatusFilter>('all')
  const [sort,     setSort]     = useState<SortKey>('spend')

  const ads = useMemo(() => {
    let list: (MetaAdRow | GoogleAdRow)[] = []
    if (platform === 'all' || platform === 'meta')   list = list.concat(meta)
    if (platform === 'all' || platform === 'google') list = list.concat(google)
    if (status === 'active') list = list.filter(a =>  isAdActive(a.ad_status))
    if (status === 'paused') list = list.filter(a => !isAdActive(a.ad_status))
    if (sort === 'spend')       list = [...list].sort((a, b) => b.spend       - a.spend)
    if (sort === 'impressions') list = [...list].sort((a, b) => b.impressions - a.impressions)
    if (sort === 'ctr')         list = [...list].sort((a, b) => ctr(b)        - ctr(a))
    return list
  }, [meta, google, platform, status, sort])

  return (
    <div>
      <style>{`
        .adlib-controls {
          display: flex; gap: 0.625rem; flex-wrap: wrap;
          align-items: center; margin-bottom: 1.5rem;
        }
        .adlib-filter-row { display: flex; gap: 0.25rem; flex-wrap: wrap; }
        .adlib-sep { width: 1px; height: 22px; background: #e5e7eb; flex-shrink: 0; }
        .adlib-sort { margin-left: auto; display: flex; align-items: center; gap: 0.5rem; }
        .adlib-sort select { min-width: 0; }
        .adlib-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1rem;
        }
        @media (max-width: 600px) {
          .adlib-controls { flex-direction: column; align-items: stretch; gap: 0.625rem; }
          .adlib-sep { display: none; }
          .adlib-filter-row { gap: 0.3125rem; }
          .adlib-sort { margin-left: 0; justify-content: space-between; }
          .adlib-sort select { flex: 1; }
          .adlib-grid { grid-template-columns: 1fr; }
        }
        @media (min-width: 601px) and (max-width: 880px) {
          .adlib-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      {/* Controls */}
      <div className="adlib-controls">
        <div className="adlib-filter-row">
          {(['all', 'meta', 'google'] as Platform[]).map(p => (
            <button key={p} onClick={() => setPlatform(p)} style={pill(platform === p)}>
              {p === 'all' ? 'All' : p === 'meta' ? 'Meta' : 'Google'}
            </button>
          ))}
        </div>

        <div className="adlib-sep" />

        <div className="adlib-filter-row">
          {(['all', 'active', 'paused'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatus(s)} style={pill(status === s)}>
              {s === 'all' ? 'All status' : s === 'active' ? 'Active' : 'Paused'}
            </button>
          ))}
        </div>

        <div className="adlib-sort">
          <span style={{ fontSize: '0.8125rem', color: '#6b7280', whiteSpace: 'nowrap' }}>Sort by</span>
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
          <div className="adlib-grid">
            {ads.map(ad => (
              <AdLibraryCard key={`${ad.platform}-${ad.ad_id}`} ad={ad} token={token} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
