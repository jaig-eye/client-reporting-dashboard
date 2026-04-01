'use client'

// AdTable — Ads-Manager-style table layout for ad groups/sets and individual ads.
// Matches the column layout from Meta/Google Ads Manager.
// Used in: campaign/[campaignId] (ad groups) and campaign/[campaignId]/adset/[adsetId] (ads)

import React, { useState } from 'react'
import { fmt$, fmtNum, fmtPct, fmtCurrency, fmtRoas } from '@/lib/metrics'
import type { DisplayMode } from './AdSetCards'
import LightboxImage from './LightboxImage'

// ─────────────────────────────────────────────────────────────────────────────
// Ad Group / Ad Set table
// ─────────────────────────────────────────────────────────────────────────────

export interface AdGroupRow {
  setId:            string
  setName:          string
  spend:            number
  displaySpend:     number
  impressions:      number
  clicks:           number
  conversions:      number
  conversionValue:  number
  roas:             number
  cpl:              number
  ctr:              number
  adCount:          number
  href:             string   // link target for drill-down
}

type AdGroupSortKey = 'setName' | 'displaySpend' | 'conversions' | 'conversionValue' | 'roas' | 'cpl' | 'impressions' | 'clicks' | 'ctr' | 'adCount'

export function AdGroupTable({
  rows,
  conversionLabel,
  isEcom,
  isPMax = false,
}: {
  rows:             AdGroupRow[]
  displayMode?:     DisplayMode
  conversionLabel:  string
  isEcom:           boolean
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
        {isActive && <span className="ml-1" style={{ opacity: 0.5 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
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

  const totSpend  = rows.reduce((s, r) => s + r.displaySpend, 0)
  const totImpr   = rows.reduce((s, r) => s + r.impressions, 0)
  const totClicks = rows.reduce((s, r) => s + r.clicks, 0)
  const totConv   = rows.reduce((s, r) => s + r.conversions, 0)
  const totCv     = rows.reduce((s, r) => s + r.conversionValue, 0)
  const totRoas   = totSpend > 0 && totCv > 0 ? totCv / totSpend : 0
  const totCpl    = totConv > 0 ? totSpend / totConv : 0
  const totCtr    = totImpr > 0 ? totClicks / totImpr : 0

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 680 }}>
        <thead>
          <tr>
            <SortTh sk="setName" align="left">Ad Set / Group</SortTh>
            <SortTh sk="displaySpend">Spend</SortTh>
            {isEcom ? (
              <>
                <SortTh sk="roas">ROAS</SortTh>
                <SortTh sk="conversionValue">Revenue</SortTh>
                <SortTh sk="conversions">Orders</SortTh>
              </>
            ) : (
              <>
                <SortTh sk="conversions">{conversionLabel}</SortTh>
                <SortTh sk="cpl">Cost / Result</SortTh>
              </>
            )}
            <SortTh sk="impressions">Impressions</SortTh>
            <SortTh sk="clicks">Clicks</SortTh>
            <SortTh sk="ctr">CTR</SortTh>
            <SortTh sk="adCount">Ads</SortTh>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <AdGroupTableRow key={row.setId} row={row} isEcom={isEcom} conversionLabel={conversionLabel} />
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
            <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {rows.length} ad set{rows.length !== 1 ? 's' : ''}
            </td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmt$(totSpend)}</td>
            {isEcom ? (
              <>
                <td className="text-xs" style={{ textAlign: 'right', color: roasColor(totRoas) }}>
                  {totRoas > 0 ? fmtRoas(totRoas) : '—'}
                </td>
                <td className="text-xs" style={{ textAlign: 'right' }}>{totCv > 0 ? fmt$(totCv) : '—'}</td>
                <td className="text-xs" style={{ textAlign: 'right' }}>{totConv > 0 ? fmtNum(totConv) : '—'}</td>
              </>
            ) : (
              <>
                <td className="text-xs" style={{ textAlign: 'right' }}>{totConv > 0 ? fmtNum(totConv) : '—'}</td>
                <td className="text-xs" style={{ textAlign: 'right' }}>{totCpl > 0 ? fmtCurrency(totCpl) : '—'}</td>
              </>
            )}
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totImpr)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totClicks)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmtPct(totCtr)}</td>
            <td></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function AdGroupTableRow({
  row, isEcom, conversionLabel,
}: {
  row: AdGroupRow; isEcom: boolean; conversionLabel: string
}) {
  return (
    <tr>
      <td>
        <a href={row.href} style={{ color: 'var(--blue)', fontWeight: 500, textDecoration: 'none', fontSize: '0.85rem' }}>
          {row.setName || row.setId}
        </a>
      </td>
      <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
        {fmt$(row.displaySpend)}
      </td>
      {isEcom ? (
        <>
          <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: roasColor(row.roas) }}>
            {row.roas > 0 ? fmtRoas(row.roas) : '—'}
          </td>
          <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
            {row.conversionValue > 0 ? fmt$(row.conversionValue) : '—'}
          </td>
          <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
            {row.conversions > 0 ? fmtNum(row.conversions) : '—'}
          </td>
        </>
      ) : (
        <>
          <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
            {row.conversions > 0 ? fmtNum(row.conversions) : '—'}
          </td>
          <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
            {row.cpl > 0 ? fmtCurrency(row.cpl) : '—'}
          </td>
        </>
      )}
      <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.impressions)}</td>
      <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.clicks)}</td>
      <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(row.ctr)}</td>
      <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-faint)' }}>{row.adCount}</td>
      <td className="text-xs" style={{ textAlign: 'right' }}>
        <a href={row.href} style={{ color: 'var(--blue)', textDecoration: 'none', whiteSpace: 'nowrap' }}>View →</a>
      </td>
    </tr>
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
  spend:             number
  displaySpend:      number
  impressions:       number
  clicks:            number
  conversions:       number
  conversionValue:   number
  roas:              number
  cpl:               number
  ctr:               number
}

type AdRowSortKey = 'ad_name' | 'displaySpend' | 'conversions' | 'conversionValue' | 'roas' | 'cpl' | 'impressions' | 'clicks' | 'ctr'

export function AdRowTable({
  rows,
  isEcom,
  conversionLabel,
}: {
  rows:             AdRow[]
  isEcom:           boolean
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
        {isActive && <span className="ml-1" style={{ opacity: 0.5 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
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

  const totSpend  = rows.reduce((s, r) => s + r.displaySpend, 0)
  const totImpr   = rows.reduce((s, r) => s + r.impressions, 0)
  const totClicks = rows.reduce((s, r) => s + r.clicks, 0)
  const totConv   = rows.reduce((s, r) => s + r.conversions, 0)
  const totCv     = rows.reduce((s, r) => s + r.conversionValue, 0)
  const totRoas   = totSpend > 0 && totCv > 0 ? totCv / totSpend : 0
  const totCpl    = totConv > 0 ? totSpend / totConv : 0
  const totCtr    = totImpr > 0 ? totClicks / totImpr : 0

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 780 }}>
        <thead>
          <tr>
            <th style={{ width: 48 }}></th>
            <SortTh sk="ad_name" align="left">Ad</SortTh>
            <th>Type</th>
            <SortTh sk="displaySpend">Spend</SortTh>
            {isEcom ? (
              <>
                <SortTh sk="roas">ROAS</SortTh>
                <SortTh sk="conversionValue">Revenue</SortTh>
              </>
            ) : (
              <>
                <SortTh sk="conversions">{conversionLabel}</SortTh>
                <SortTh sk="cpl">Cost / Result</SortTh>
              </>
            )}
            <SortTh sk="impressions">Impressions</SortTh>
            <SortTh sk="clicks">Clicks</SortTh>
            <SortTh sk="ctr">CTR</SortTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <AdTableRow key={row.ad_id} row={row} isEcom={isEcom} conversionLabel={conversionLabel} />
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
            <td></td>
            <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {rows.length} ad{rows.length !== 1 ? 's' : ''}
            </td>
            <td></td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmt$(totSpend)}</td>
            {isEcom ? (
              <>
                <td className="text-xs" style={{ textAlign: 'right', color: roasColor(totRoas) }}>
                  {totRoas > 0 ? fmtRoas(totRoas) : '—'}
                </td>
                <td className="text-xs" style={{ textAlign: 'right' }}>{totCv > 0 ? fmt$(totCv) : '—'}</td>
              </>
            ) : (
              <>
                <td className="text-xs" style={{ textAlign: 'right' }}>{totConv > 0 ? fmtNum(totConv) : '—'}</td>
                <td className="text-xs" style={{ textAlign: 'right' }}>{totCpl > 0 ? fmtCurrency(totCpl) : '—'}</td>
              </>
            )}
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totImpr)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totClicks)}</td>
            <td className="text-xs" style={{ textAlign: 'right' }}>{fmtPct(totCtr)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function AdTableRow({
  row, isEcom, conversionLabel,
}: {
  row: AdRow; isEcom: boolean; conversionLabel: string
}) {
  const previewImg  = row.image_url || row.thumbnail_url || row.video_thumb_url
  const isVideo     = !!row.video_id
  const statusUpper = (row.ad_status ?? '').toUpperCase()
  const isActive    = !row.ad_status || statusUpper === 'ACTIVE' || statusUpper === 'ENABLED'
  const copyPreview = row.creative_title || row.creative_body || row.headlines?.[0] || ''
  const derivedType = row.ad_type
    ? row.ad_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : isVideo ? 'Video' : previewImg ? 'Image' : '—'

  return (
    <tr>
      {/* Thumbnail */}
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

      {/* Name + copy */}
      <td style={{ maxWidth: 260 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: copyPreview ? 2 : 0 }}>
          <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: isActive ? 'var(--green)' : '#9ca3af',
          }} />
          <span className="text-xs font-medium" style={{
            color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220,
          }}>
            {row.ad_name || row.ad_id}
          </span>
        </div>
        {copyPreview && (
          <p className="text-xs" style={{
            color: 'var(--text-faint)', marginLeft: 13,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220,
          }}>
            {copyPreview.length > 70 ? copyPreview.slice(0, 70) + '…' : copyPreview}
          </p>
        )}
      </td>

      <td className="text-xs" style={{ color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{derivedType}</td>

      <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
        {fmt$(row.displaySpend)}
      </td>

      {isEcom ? (
        <>
          <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: roasColor(row.roas) }}>
            {row.roas > 0 ? fmtRoas(row.roas) : '—'}
          </td>
          <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
            {row.conversionValue > 0 ? fmt$(row.conversionValue) : '—'}
          </td>
        </>
      ) : (
        <>
          <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
            {row.conversions > 0 ? fmtNum(row.conversions) : '—'}
          </td>
          <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
            {row.cpl > 0 ? fmtCurrency(row.cpl) : '—'}
          </td>
        </>
      )}

      <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.impressions)}</td>
      <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.clicks)}</td>
      <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(row.ctr)}</td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function roasColor(roas: number): string {
  if (roas >= 3)   return 'var(--green)'
  if (roas >= 1.5) return '#d97706'
  if (roas > 0)    return 'var(--red)'
  return 'var(--text-faint)'
}
