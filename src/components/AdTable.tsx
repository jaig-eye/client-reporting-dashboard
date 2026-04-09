'use client'

// AdTable — Ads-Manager-style table layout for ad groups/sets and individual ads.
// Column order: Name, Daily Budget, Cost, Impressions, Clicks, CTR, Conv, Conv Rate, CPL

import React, { useState } from 'react'
import { fmt$, fmtNum, fmtPct, fmtCurrency } from '@/lib/metrics'
import LightboxImage from './LightboxImage'
import { CaretDown, CaretUp } from '@phosphor-icons/react'

// ─────────────────────────────────────────────────────────────────────────────
// Ad Group / Ad Set table
// ─────────────────────────────────────────────────────────────────────────────

export interface AdGroupRow {
  setId:            string
  setName:          string
  spend:            number   // cost after markup
  impressions:      number
  clicks:           number
  conversions:      number
  conversionValue:  number
  ctr:              number
  convRate:         number   // conversions / clicks
  cpl:              number
  adCount:          number
  href:             string
}

type AdGroupSortKey = 'setName' | 'spend' | 'conversions' | 'cpl' | 'impressions' | 'clicks' | 'ctr' | 'convRate' | 'adCount'

export function AdGroupTable({
  rows,
  conversionLabel,
  isPMax = false,
}: {
  rows:             AdGroupRow[]
  conversionLabel:  string
  isPMax?:          boolean
}) {
  const [sortKey, setSortKey] = useState<AdGroupSortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: AdGroupSortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir('desc') }
    else if (sortDir === 'desc') setSortDir('asc')
    else setSortKey(null)
  }

  function SortTh({ sk, align = 'right', children }: { sk: AdGroupSortKey; align?: 'left' | 'right'; children: React.ReactNode }) {
    const isActive = sortKey === sk
    return (
      <th
        onClick={() => toggleSort(sk)}
        style={{ textAlign: align, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        {children}
        {isActive && <span className="ml-1" style={{ opacity: 0.5, display: 'inline-flex', alignItems: 'center' }}>{sortDir === 'desc' ? <CaretDown size={9} aria-hidden /> : <CaretUp size={9} aria-hidden />}</span>}
      </th>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm py-10 text-center" style={{ color: 'var(--text-muted)' }}>
        {isPMax
          ? 'Performance Max campaigns use asset groups — individual ad group data is not available via the Google Ads API.'
          : 'No ad-level data synced yet.'}
      </p>
    )
  }

  const sorted = sortKey === null ? rows : [...rows].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(String(bv)) : String(bv).localeCompare(av)
    return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av)
  })

  const totSpend  = rows.reduce((s, r) => s + r.spend, 0)
  const totImpr   = rows.reduce((s, r) => s + r.impressions, 0)
  const totClicks = rows.reduce((s, r) => s + r.clicks, 0)
  const totConv   = rows.reduce((s, r) => s + r.conversions, 0)
  const totCtr    = totImpr > 0 ? totClicks / totImpr : 0
  const totCR     = totClicks > 0 ? totConv / totClicks : 0
  const totCpl    = totConv > 0 ? totSpend / totConv : 0

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 740 }}>
        <thead>
          <tr>
            <SortTh sk="setName" align="left">Ad Set / Group</SortTh>
            <SortTh sk="spend">Cost</SortTh>
            <SortTh sk="impressions">Impr.</SortTh>
            <SortTh sk="clicks">Clicks</SortTh>
            <SortTh sk="ctr">CTR</SortTh>
            <SortTh sk="conversions">{conversionLabel}</SortTh>
            <SortTh sk="convRate">Conv Rate</SortTh>
            <SortTh sk="cpl">CPL</SortTh>
            <SortTh sk="adCount">Ads</SortTh>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={row.setId}>
              <td>
                <a href={row.href} style={{ color: 'var(--blue)', fontWeight: 500, textDecoration: 'none', fontSize: '0.85rem' }}>
                  {row.setName || row.setId}
                </a>
              </td>
              <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                {fmt$(row.spend)}
              </td>
              <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.impressions)}</td>
              <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.clicks)}</td>
              <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(row.ctr)}</td>
              <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                {row.conversions > 0 ? fmtNum(row.conversions) : '—'}
              </td>
              <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                {row.convRate > 0 ? fmtPct(row.convRate) : '—'}
              </td>
              <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                {row.cpl > 0 ? fmtCurrency(row.cpl) : '—'}
              </td>
              <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-faint)' }}>{row.adCount}</td>
              <td className="text-xs" style={{ textAlign: 'right' }}>
                <a href={row.href} style={{ color: 'var(--blue)', textDecoration: 'none', whiteSpace: 'nowrap' }}>View →</a>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
            <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {rows.length} ad set{rows.length !== 1 ? 's' : ''}
            </td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmt$(totSpend)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totImpr)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totClicks)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totCtr > 0 ? fmtPct(totCtr) : '—'}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totConv > 0 ? fmtNum(totConv) : '—'}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totCR > 0 ? fmtPct(totCR) : '—'}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totCpl > 0 ? fmtCurrency(totCpl) : '—'}</td>
            <td></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual Ads table
// ─────────────────────────────────────────────────────────────────────────────

export interface AdRow {
  ad_id:             string
  ad_name:           string
  ad_type:           string | null
  ad_status:         string | null
  ad_strength:       string | null
  image_url:         string | null
  video_id:          string | null
  video_thumb_url:   string | null
  thumbnail_url:     string | null
  creative_body:     string | null
  creative_title:    string | null
  headlines:         string[] | null
  descriptions:      string[] | null
  final_url:         string | null
  spend:             number    // cost after markup
  impressions:       number
  clicks:            number
  conversions:       number
  conversionValue:   number
  ctr:               number
  convRate:          number   // conversions / clicks
  cpl:               number
}

type AdRowSortKey = 'ad_name' | 'spend' | 'conversions' | 'cpl' | 'impressions' | 'clicks' | 'ctr' | 'convRate'

export function AdRowTable({
  rows,
  conversionLabel,
}: {
  rows:             AdRow[]
  conversionLabel:  string
}) {
  const [sortKey, setSortKey] = useState<AdRowSortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: AdRowSortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir('desc') }
    else if (sortDir === 'desc') setSortDir('asc')
    else setSortKey(null)
  }

  function SortTh({ sk, align = 'right', children }: { sk: AdRowSortKey; align?: 'left' | 'right'; children: React.ReactNode }) {
    const isActive = sortKey === sk
    return (
      <th
        onClick={() => toggleSort(sk)}
        style={{ textAlign: align, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        {children}
        {isActive && <span className="ml-1" style={{ opacity: 0.5, display: 'inline-flex', alignItems: 'center' }}>{sortDir === 'desc' ? <CaretDown size={9} aria-hidden /> : <CaretUp size={9} aria-hidden />}</span>}
      </th>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm py-10 text-center" style={{ color: 'var(--text-muted)' }}>
        No ads found in this ad group.
      </p>
    )
  }

  const sorted = sortKey === null ? rows : [...rows].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(String(bv)) : String(bv).localeCompare(av)
    return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av)
  })

  const totSpend  = rows.reduce((s, r) => s + r.spend, 0)
  const totImpr   = rows.reduce((s, r) => s + r.impressions, 0)
  const totClicks = rows.reduce((s, r) => s + r.clicks, 0)
  const totConv   = rows.reduce((s, r) => s + r.conversions, 0)
  const totCtr    = totImpr > 0 ? totClicks / totImpr : 0
  const totCR     = totClicks > 0 ? totConv / totClicks : 0
  const totCpl    = totConv > 0 ? totSpend / totConv : 0

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 780 }}>
        <thead>
          <tr>
            <th style={{ width: 48 }}></th>
            <SortTh sk="ad_name" align="left">Ad</SortTh>
            <th style={{ whiteSpace: 'nowrap' }}>Status</th>
            <SortTh sk="spend">Cost</SortTh>
            <SortTh sk="impressions">Impr.</SortTh>
            <SortTh sk="clicks">Clicks</SortTh>
            <SortTh sk="ctr">CTR</SortTh>
            <SortTh sk="conversions">{conversionLabel}</SortTh>
            <SortTh sk="convRate">Conv Rate</SortTh>
            <SortTh sk="cpl">CPL</SortTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => {
            const previewImg  = row.image_url || row.thumbnail_url || row.video_thumb_url
            const isVideo     = !!row.video_id
            const statusUpper = (row.ad_status ?? '').toUpperCase()
            const isActive    = !row.ad_status || statusUpper === 'ACTIVE' || statusUpper === 'ENABLED'
            const isPaused    = statusUpper === 'PAUSED'
            const copyPreview = row.creative_title || row.creative_body || row.headlines?.[0] || ''

            return (
              <tr key={row.ad_id}>
                <td style={{ padding: '6px 8px' }}>
                  {previewImg ? (
                    <LightboxImage
                      src={previewImg}
                      alt={row.ad_name}
                      width={40}
                      height={40}
                      videoId={row.video_id ?? undefined}
                    />
                  ) : (
                    <div style={{
                      width: 40, height: 40, borderRadius: 4,
                      background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Ad</span>
                    </div>
                  )}
                </td>
                <td style={{ maxWidth: 220 }}>
                  <span className="text-xs font-medium" style={{
                    color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200, display: 'block',
                  }}>
                    {row.ad_name || row.ad_id}
                  </span>
                  {copyPreview && (
                    <p className="text-xs" style={{
                      color: 'var(--text-faint)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200,
                    }}>
                      {copyPreview.length > 60 ? copyPreview.slice(0, 60) + '…' : copyPreview}
                    </p>
                  )}
                </td>
                <td>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: '0.7rem', fontWeight: 600,
                    color: isActive ? 'var(--green)' : isPaused ? '#d97706' : 'var(--text-faint)',
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: isActive ? 'var(--green)' : isPaused ? '#d97706' : '#9ca3af',
                    }} />
                    {isActive ? 'Active' : isPaused ? 'Paused' : (statusUpper || '—')}
                  </span>
                </td>
                <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {fmt$(row.spend)}
                </td>
                <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.impressions)}</td>
                <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.clicks)}</td>
                <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(row.ctr)}</td>
                <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {row.conversions > 0 ? fmtNum(row.conversions) : '—'}
                </td>
                <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {row.convRate > 0 ? fmtPct(row.convRate) : '—'}
                </td>
                <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                  {row.cpl > 0 ? fmtCurrency(row.cpl) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
            <td></td>
            <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {rows.length} ad{rows.length !== 1 ? 's' : ''}
            </td>
            <td></td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmt$(totSpend)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totImpr)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totClicks)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totCtr > 0 ? fmtPct(totCtr) : '—'}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totConv > 0 ? fmtNum(totConv) : '—'}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totCR > 0 ? fmtPct(totCR) : '—'}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{totCpl > 0 ? fmtCurrency(totCpl) : '—'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
