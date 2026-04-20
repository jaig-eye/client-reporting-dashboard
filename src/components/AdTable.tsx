'use client'

// AdTable — Ads-Manager-style table layout for ad groups/sets and individual ads.
// Column order: Name, Daily Budget, Cost, Impressions, Clicks, CTR, Conv, Conv Rate, CPA

import React, { useState } from 'react'
import { fmt$, fmtNum, fmtPct, fmtCurrency } from '@/lib/metrics'
import LightboxImage from './LightboxImage'
import { CaretDown, CaretUp, Rows, SquaresFour } from '@phosphor-icons/react'

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
  cpc?:             number
  cpm?:             number
  roas?:            number
  revenue?:         number
}

type AdGroupSortKey = 'setName' | 'spend' | 'conversions' | 'cpl' | 'impressions' | 'clicks' | 'ctr' | 'convRate' | 'adCount' | 'cpc' | 'cpm' | 'roas' | 'revenue'

export function AdGroupTable({
  rows,
  conversionLabel,
  isPMax = false,
  tableColumns,
}: {
  rows:             AdGroupRow[]
  conversionLabel:  string
  isPMax?:          boolean
  tableColumns?:    string[]
}) {
  const showCol = (key: string) => !tableColumns || tableColumns.includes(key)
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
            {showCol('spend') && <SortTh sk="spend">Cost</SortTh>}
            {showCol('impressions') && <SortTh sk="impressions">Impr.</SortTh>}
            {showCol('clicks') && <SortTh sk="clicks">Clicks</SortTh>}
            {showCol('ctr') && <SortTh sk="ctr">CTR</SortTh>}
            {showCol('cpc') && <SortTh sk="cpc">Avg. CPC</SortTh>}
            {showCol('cpm') && <SortTh sk="cpm">CPM</SortTh>}
            {showCol('conversions') && <SortTh sk="conversions">{conversionLabel}</SortTh>}
            {showCol('conv_rate') && <SortTh sk="convRate">Conv Rate</SortTh>}
            {showCol('cpa') && <SortTh sk="cpl">CPA</SortTh>}
            {showCol('roas') && <SortTh sk="roas">ROAS</SortTh>}
            {showCol('revenue') && <SortTh sk="revenue">Revenue</SortTh>}
            {showCol('ad_count') && <SortTh sk="adCount">Ads</SortTh>}
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
              {showCol('spend') && <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{fmt$(row.spend)}</td>}
              {showCol('impressions') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.impressions)}</td>}
              {showCol('clicks') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.clicks)}</td>}
              {showCol('ctr') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(row.ctr)}</td>}
              {showCol('cpc') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.cpc ? fmtCurrency(row.cpc) : '—'}</td>}
              {showCol('cpm') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.cpm ? fmtCurrency(row.cpm) : '—'}</td>}
              {showCol('conversions') && <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{row.conversions > 0 ? fmtNum(row.conversions) : '—'}</td>}
              {showCol('conv_rate') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.convRate > 0 ? fmtPct(row.convRate) : '—'}</td>}
              {showCol('cpa') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.cpl > 0 ? fmtCurrency(row.cpl) : '—'}</td>}
              {showCol('roas') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.roas && row.roas > 0 ? `${row.roas.toFixed(2)}x` : '—'}</td>}
              {showCol('revenue') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.revenue && row.revenue > 0 ? fmt$(row.revenue) : '—'}</td>}
              {showCol('ad_count') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-faint)' }}>{row.adCount}</td>}
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
            {showCol('spend') && <td className="text-xs" style={{ textAlign: 'right' }}>{fmt$(totSpend)}</td>}
            {showCol('impressions') && <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totImpr)}</td>}
            {showCol('clicks') && <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totClicks)}</td>}
            {showCol('ctr') && <td className="text-xs" style={{ textAlign: 'right' }}>{totCtr > 0 ? fmtPct(totCtr) : '—'}</td>}
            {showCol('cpc') && <td className="text-xs" style={{ textAlign: 'right' }}>{totClicks > 0 ? fmtCurrency(totSpend / totClicks) : '—'}</td>}
            {showCol('cpm') && <td className="text-xs" style={{ textAlign: 'right' }}>{totImpr > 0 ? fmtCurrency((totSpend / totImpr) * 1000) : '—'}</td>}
            {showCol('conversions') && <td className="text-xs" style={{ textAlign: 'right' }}>{totConv > 0 ? fmtNum(totConv) : '—'}</td>}
            {showCol('conv_rate') && <td className="text-xs" style={{ textAlign: 'right' }}>{totCR > 0 ? fmtPct(totCR) : '—'}</td>}
            {showCol('cpa') && <td className="text-xs" style={{ textAlign: 'right' }}>{totCpl > 0 ? fmtCurrency(totCpl) : '—'}</td>}
            {showCol('roas') && <td className="text-xs" style={{ textAlign: 'right' }}>{(() => { const totCv = rows.reduce((s, r) => s + (r.revenue ?? 0), 0); return totCv > 0 && totSpend > 0 ? `${(totCv / totSpend).toFixed(2)}x` : '—' })()}</td>}
            {showCol('revenue') && <td className="text-xs" style={{ textAlign: 'right' }}>{(() => { const totCv = rows.reduce((s, r) => s + (r.revenue ?? 0), 0); return totCv > 0 ? fmt$(totCv) : '—' })()}</td>}
            {showCol('ad_count') && <td></td>}
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
  showCardView = false,
  tableColumns,
}: {
  rows:             AdRow[]
  conversionLabel:  string
  showCardView?:    boolean
  tableColumns?:    string[]
}) {
  const showCol = (key: string) => !tableColumns || tableColumns.includes(key)
  const [sortKey, setSortKey]   = useState<AdRowSortKey | null>(null)
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc')
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list')
  const [previewAd, setPreviewAd] = useState<AdRow | null>(null)

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

  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 30, height: 30, borderRadius: 6, border: '1px solid var(--border)',
    cursor: 'pointer', background: 'var(--bg-surface)', color: 'var(--text-secondary)',
  }

  return (
    <>
      {/* View toggle header */}
      {showCardView && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: '0.75rem' }}>
          <button
            onClick={() => setViewMode('list')}
            aria-label="List view"
            style={{ ...btnBase, background: viewMode === 'list' ? 'var(--bg-active, #eff6ff)' : 'var(--bg-surface)', color: viewMode === 'list' ? 'var(--blue, #2563eb)' : 'var(--text-secondary)', borderColor: viewMode === 'list' ? 'var(--blue, #2563eb)' : 'var(--border)' }}
          >
            <Rows size={14} weight={viewMode === 'list' ? 'bold' : 'regular'} />
          </button>
          <button
            onClick={() => setViewMode('cards')}
            aria-label="Card view"
            style={{ ...btnBase, background: viewMode === 'cards' ? 'var(--bg-active, #eff6ff)' : 'var(--bg-surface)', color: viewMode === 'cards' ? 'var(--blue, #2563eb)' : 'var(--text-secondary)', borderColor: viewMode === 'cards' ? 'var(--blue, #2563eb)' : 'var(--border)' }}
          >
            <SquaresFour size={14} weight={viewMode === 'cards' ? 'bold' : 'regular'} />
          </button>
        </div>
      )}

      {/* Card grid view */}
      {showCardView && viewMode === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
          {sorted.map(row => {
            const previewImg  = row.image_url || row.thumbnail_url || row.video_thumb_url
            const statusUpper = (row.ad_status ?? '').toUpperCase()
            const isActive    = !row.ad_status || statusUpper === 'ACTIVE' || statusUpper === 'ENABLED'
            const isPaused    = statusUpper === 'PAUSED'
            const displayName = row.creative_title || row.ad_name || row.ad_id
            return (
              <div
                key={row.ad_id}
                onClick={() => setPreviewAd(row)}
                style={{
                  border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden',
                  background: 'var(--bg-surface)', cursor: 'pointer',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  transition: 'box-shadow 0.15s, transform 0.1s',
                }}
              >
                {/* Image */}
                {previewImg ? (
                  <img
                    src={previewImg}
                    alt={row.ad_name}
                    style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{
                    width: '100%', aspectRatio: '1/1', background: 'var(--bg-subtle)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No image</span>
                  </div>
                )}

                <div style={{ padding: '0.75rem' }}>
                  {/* Status badge */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    color: isActive ? 'var(--green)' : isPaused ? '#d97706' : 'var(--text-faint)',
                    marginBottom: 6,
                  }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: isActive ? 'var(--green)' : isPaused ? '#d97706' : '#9ca3af',
                    }} />
                    {isActive ? 'Active' : isPaused ? 'Paused' : (statusUpper || 'Unknown')}
                  </span>

                  {/* Ad name / title */}
                  <p style={{
                    fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)',
                    margin: '0 0 0.625rem',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    lineHeight: 1.35,
                  }}>
                    {displayName}
                  </p>

                  {/* Metrics grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem 0.75rem' }}>
                    <div>
                      <p style={{ fontSize: '0.6rem', color: 'var(--text-faint)', margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Spend</p>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{fmt$(row.spend)}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: '0.6rem', color: 'var(--text-faint)', margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {row.conversions > 0 ? 'CPA' : 'CTR'}
                      </p>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {row.conversions > 0 ? fmtCurrency(row.cpl) : fmtPct(row.ctr)}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: '0.6rem', color: 'var(--text-faint)', margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Results</p>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {row.conversions > 0 ? fmtNum(row.conversions) : fmtNum(row.clicks)}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: '0.6rem', color: 'var(--text-faint)', margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Impr.</p>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(row.impressions)}</p>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* List / table view */
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ width: 48 }}></th>
                <SortTh sk="ad_name" align="left">Ad</SortTh>
                <th style={{ whiteSpace: 'nowrap' }}>Status</th>
                {showCol('spend') && <SortTh sk="spend">Cost</SortTh>}
                {showCol('impressions') && <SortTh sk="impressions">Impr.</SortTh>}
                {showCol('clicks') && <SortTh sk="clicks">Clicks</SortTh>}
                {showCol('ctr') && <SortTh sk="ctr">CTR</SortTh>}
                {showCol('conversions') && <SortTh sk="conversions">{conversionLabel}</SortTh>}
                {showCol('conv_rate') && <SortTh sk="convRate">Conv Rate</SortTh>}
                {showCol('cpa') && <SortTh sk="cpl">CPA</SortTh>}
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => {
                const previewImg  = row.image_url || row.thumbnail_url || row.video_thumb_url
                const statusUpper = (row.ad_status ?? '').toUpperCase()
                const isActive    = !row.ad_status || statusUpper === 'ACTIVE' || statusUpper === 'ENABLED'
                const isPaused    = statusUpper === 'PAUSED'
                const copyPreview = row.creative_title || row.creative_body || row.headlines?.[0] || ''
                const thumbSize   = showCardView ? 80 : 56

                return (
                  <tr key={row.ad_id}>
                    <td style={{ padding: '6px 8px' }}>
                      {previewImg ? (
                        showCardView ? (
                          /* Meta: clicking thumbnail opens the same preview modal as card view */
                          <button
                            onClick={() => setPreviewAd(row)}
                            title="Preview ad"
                            style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', display: 'block', flexShrink: 0 }}
                          >
                            <img
                              src={previewImg}
                              alt={row.ad_name}
                              style={{ width: thumbSize, height: thumbSize, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                            />
                          </button>
                        ) : (
                          <LightboxImage
                            src={previewImg}
                            alt={row.ad_name}
                            width={thumbSize}
                            height={thumbSize}
                            videoId={row.video_id ?? undefined}
                            fullSrc={row.image_url ?? undefined}
                          />
                        )
                      ) : (
                        <div style={{
                          width: thumbSize, height: thumbSize, borderRadius: 6,
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
                    {showCol('spend') && <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{fmt$(row.spend)}</td>}
                    {showCol('impressions') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.impressions)}</td>}
                    {showCol('clicks') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(row.clicks)}</td>}
                    {showCol('ctr') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(row.ctr)}</td>}
                    {showCol('conversions') && <td className="text-xs" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{row.conversions > 0 ? fmtNum(row.conversions) : '—'}</td>}
                    {showCol('conv_rate') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.convRate > 0 ? fmtPct(row.convRate) : '—'}</td>}
                    {showCol('cpa') && <td className="text-xs" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.cpl > 0 ? fmtCurrency(row.cpl) : '—'}</td>}
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
                {showCol('spend') && <td className="text-xs" style={{ textAlign: 'right' }}>{fmt$(totSpend)}</td>}
                {showCol('impressions') && <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totImpr)}</td>}
                {showCol('clicks') && <td className="text-xs" style={{ textAlign: 'right' }}>{fmtNum(totClicks)}</td>}
                {showCol('ctr') && <td className="text-xs" style={{ textAlign: 'right' }}>{totCtr > 0 ? fmtPct(totCtr) : '—'}</td>}
                {showCol('conversions') && <td className="text-xs" style={{ textAlign: 'right' }}>{totConv > 0 ? fmtNum(totConv) : '—'}</td>}
                {showCol('conv_rate') && <td className="text-xs" style={{ textAlign: 'right' }}>{totCR > 0 ? fmtPct(totCR) : '—'}</td>}
                {showCol('cpa') && <td className="text-xs" style={{ textAlign: 'right' }}>{totCpl > 0 ? fmtCurrency(totCpl) : '—'}</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Ad preview modal — Facebook-card style */}
      {previewAd && (
        <div
          onClick={() => setPreviewAd(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: '1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 420,
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)', overflow: 'hidden',
            }}
          >
            {/* FB-style header */}
            <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%', background: '#e5e7eb', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}>
                📢
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: '#111' }}>Your Page</p>
                <p style={{ margin: 0, fontSize: '0.7rem', color: '#65676b' }}>Sponsored · 🌐</p>
              </div>
              <button
                onClick={() => setPreviewAd(null)}
                style={{
                  background: 'none', border: 'none', fontSize: 22, cursor: 'pointer',
                  color: '#9ca3af', lineHeight: 1, padding: '0 4px', flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>

            {/* Body copy */}
            {(previewAd.creative_body || previewAd.descriptions?.[0]) && (
              <p style={{
                margin: '0 1rem 0.625rem', fontSize: '0.875rem', color: '#1c1e21', lineHeight: 1.55,
                display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {previewAd.creative_body || previewAd.descriptions?.[0]}
              </p>
            )}

            {/* Image */}
            {(previewAd.image_url || previewAd.thumbnail_url || previewAd.video_thumb_url) && (
              <img
                src={previewAd.image_url || previewAd.thumbnail_url || previewAd.video_thumb_url!}
                alt="ad creative"
                style={{ width: '100%', maxHeight: 320, objectFit: 'cover', display: 'block' }}
              />
            )}

            {/* Headline + CTA strip — fall back to ad_name when creative has no title */}
            <div style={{
              padding: '0.625rem 1rem', background: '#f0f2f5',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <div style={{ minWidth: 0 }}>
                <p style={{
                  margin: 0, fontSize: '0.875rem', fontWeight: 700, color: '#1c1e21',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {previewAd.creative_title || previewAd.headlines?.[0] || previewAd.ad_name}
                </p>
              </div>
              <button style={{
                background: '#e4e6eb', border: 'none', borderRadius: 6, padding: '6px 14px',
                fontSize: '0.8125rem', fontWeight: 600, cursor: 'default', color: '#1c1e21', whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                Learn more
              </button>
            </div>

            {/* Ad name footer */}
            <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid #e5e7eb' }}>
              <p style={{ margin: 0, fontSize: '0.7rem', color: '#9ca3af' }}>Ad: {previewAd.ad_name}</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
