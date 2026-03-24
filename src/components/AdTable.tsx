// AdTable — Ads-Manager-style table layout for ad groups/sets and individual ads.
// Matches the column layout from Meta/Google Ads Manager (see reference screenshots).
// Used in: campaign/[campaignId] (ad groups) and campaign/[campaignId]/adset/[adsetId] (ads)

import { fmt$, fmtNum, fmtPct, fmtCurrency, fmtRoas } from '@/lib/metrics'
import type { DisplayMode } from './AdSetCards'

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

export function AdGroupTable({
  rows,
  conversionLabel,
  isEcom,
}: {
  rows:             AdGroupRow[]
  displayMode?:     DisplayMode
  conversionLabel:  string
  isEcom:           boolean
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm py-10 text-center" style={{ color: 'var(--text-muted)' }}>
        No ad-level data synced yet.
      </p>
    )
  }

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
            <th style={{ minWidth: 200 }}>Ad Set / Group</th>
            <th style={{ textAlign: 'right' }}>Spend</th>
            {isEcom ? (
              <>
                <th style={{ textAlign: 'right' }}>ROAS</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Orders</th>
              </>
            ) : (
              <>
                <th style={{ textAlign: 'right' }}>{conversionLabel}</th>
                <th style={{ textAlign: 'right' }}>Cost / Result</th>
              </>
            )}
            <th style={{ textAlign: 'right' }}>Impressions</th>
            <th style={{ textAlign: 'right' }}>Clicks</th>
            <th style={{ textAlign: 'right' }}>CTR</th>
            <th style={{ textAlign: 'right' }}>Ads</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
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

export function AdRowTable({
  rows,
  isEcom,
  conversionLabel,
}: {
  rows:             AdRow[]
  isEcom:           boolean
  conversionLabel:  string
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm py-10 text-center" style={{ color: 'var(--text-muted)' }}>
        No ads found in this ad group.
      </p>
    )
  }

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
            <th style={{ minWidth: 220 }}>Ad</th>
            <th>Type</th>
            <th style={{ textAlign: 'right' }}>Spend</th>
            {isEcom ? (
              <>
                <th style={{ textAlign: 'right' }}>ROAS</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
              </>
            ) : (
              <>
                <th style={{ textAlign: 'right' }}>{conversionLabel}</th>
                <th style={{ textAlign: 'right' }}>Cost / Result</th>
              </>
            )}
            <th style={{ textAlign: 'right' }}>Impressions</th>
            <th style={{ textAlign: 'right' }}>Clicks</th>
            <th style={{ textAlign: 'right' }}>CTR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
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
  const typeLabel   = row.ad_type
    ? row.ad_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : '—'

  return (
    <tr>
      {/* Thumbnail */}
      <td style={{ padding: '6px 8px' }}>
        {previewImg ? (
          <div style={{ position: 'relative', width: 40, height: 40 }}>
            <img
              src={previewImg}
              alt={row.ad_name}
              style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, display: 'block' }}
            />
            {isVideo && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: 'rgba(0,0,0,0.35)', borderRadius: 4,
              }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="white">
                  <polygon points="4,2 14,8 4,14" />
                </svg>
              </div>
            )}
          </div>
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

      <td className="text-xs" style={{ color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{typeLabel}</td>

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
