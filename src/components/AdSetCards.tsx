// AdSetCards — visual card layout for ads grouped by ad set / ad group.
// Adapts metrics display based on campaign display_mode:
//   lead_gen  → Leads, CPL, Spend as hero metrics
//   ecommerce → ROAS, Revenue, Spend as hero metrics
//   others    → falls back to lead_gen layout

import { fmt$, fmtNum, fmtRoas, fmtPct, fmtCurrency, applyAdFuel } from '@/lib/metrics'

export interface AdCardData {
  ad_id:           string
  ad_name:         string
  ad_type:         string | null
  thumbnail_url:   string | null
  spend:           number
  impressions:     number
  clicks:          number
  conversions:     number
  conversionValue: number
  roas:            number
  cpl:             number
  ctr:             number
  adFuelSpend:     number
}

export interface AdSetData {
  setId:            string
  setName:          string
  spend:            number
  impressions:      number
  clicks:           number
  conversions:      number
  conversionValue:  number
  ads:              AdCardData[]
}

export type DisplayMode = 'lead_gen' | 'ecommerce' | 'awareness' | 'engagement' | 'custom'

export default function AdSetCards({
  adSets,
  displayMode = 'lead_gen',
  adFuelCut = 0,
  conversionLabel = 'Conversions',
  groupLabel = 'Ad Set',
}: {
  adSets:           AdSetData[]
  displayMode?:     DisplayMode
  adFuelCut?:       number
  conversionLabel?: string
  groupLabel?:      string
}) {
  if (adSets.length === 0) {
    return (
      <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
        No ad-level data synced yet. Run a sync to populate ad metrics.
      </p>
    )
  }

  const isEcom = displayMode === 'ecommerce'

  return (
    <div className="space-y-8">
      {adSets.map(set => {
        const setRoas = set.spend > 0 && set.conversionValue > 0 ? set.conversionValue / set.spend : 0
        const setCpl  = set.conversions > 0 ? set.spend / set.conversions : 0
        const setCtr  = set.impressions > 0 ? set.clicks / set.impressions : 0
        const displaySpend = adFuelCut > 0 ? applyAdFuel(set.spend, adFuelCut) : set.spend

        return (
          <div key={set.setId}>
            {/* ── Ad set header ──────────────────────────────────── */}
            <div
              className="flex items-start justify-between gap-4 mb-4 px-3 py-2.5 rounded-lg"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
            >
              <div>
                {/* Group type label */}
                <p className="text-xs font-medium uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
                  {groupLabel}
                </p>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {set.setName || groupLabel}
                </h3>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>{fmt$(displaySpend)}{adFuelCut > 0 && <span style={{ color: 'var(--text-faint)' }}> ({fmt$(set.spend)} raw)</span>}</span>
                  {isEcom ? (
                    <>
                      <span style={{ color: 'var(--border)' }}>·</span>
                      <span
                        className="font-medium"
                        style={{ color: setRoas >= 3 ? 'var(--green)' : setRoas >= 1.5 ? '#d97706' : setRoas > 0 ? 'var(--red)' : 'var(--text-faint)' }}
                      >
                        {setRoas > 0 ? `${fmtRoas(setRoas)} ROAS` : 'No conv. value'}
                      </span>
                      <span style={{ color: 'var(--border)' }}>·</span>
                      <span>{fmt$(set.conversionValue)} revenue</span>
                      <span style={{ color: 'var(--border)' }}>·</span>
                      <span>{fmtNum(set.conversions)} orders</span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: 'var(--border)' }}>·</span>
                      <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {set.conversions.toFixed(0)} {conversionLabel.toLowerCase()}
                      </span>
                      {setCpl > 0 && (
                        <>
                          <span style={{ color: 'var(--border)' }}>·</span>
                          <span>{fmtCurrency(setCpl)} CPL</span>
                        </>
                      )}
                      <span style={{ color: 'var(--border)' }}>·</span>
                      <span>{fmtPct(setCtr)} CTR</span>
                    </>
                  )}
                </div>
              </div>
              <span
                className="text-xs flex-shrink-0 mt-5"
                style={{ color: 'var(--text-faint)' }}
              >
                {set.ads.length} ad{set.ads.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* ── Ad cards grid ──────────────────────────────────── */}
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}
            >
              {set.ads.map(ad => (
                <AdCard
                  key={ad.ad_id}
                  ad={ad}
                  isEcom={isEcom}
                  adFuelCut={adFuelCut}
                  conversionLabel={conversionLabel}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual ad card
// ─────────────────────────────────────────────────────────────────────────────

export function AdCard({
  ad,
  isEcom,
  adFuelCut,
  conversionLabel,
}: {
  ad:               AdCardData
  isEcom:           boolean
  adFuelCut:        number
  conversionLabel:  string
}) {
  const displaySpend = adFuelCut > 0 ? ad.adFuelSpend : ad.spend
  const roasColor    = ad.roas >= 3 ? 'var(--green)' : ad.roas >= 1.5 ? '#d97706' : 'var(--red)'
  const showRoas     = ad.roas > 0 && ad.conversionValue > 0
  const adTypeLabel  = ad.ad_type
    ? ad.ad_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Ad'

  return (
    <div
      className="card flex flex-col overflow-hidden"
      style={{ borderRadius: 8, padding: 0 }}
    >
      {/* Thumbnail or placeholder */}
      {ad.thumbnail_url ? (
        <img
          src={ad.thumbnail_url}
          alt={ad.ad_name}
          className="w-full object-cover flex-shrink-0"
          style={{ aspectRatio: '1.91 / 1', background: 'var(--bg-subtle)' }}
        />
      ) : (
        <div
          className="w-full flex flex-col items-center justify-center flex-shrink-0"
          style={{
            aspectRatio: '1.91 / 1',
            background: 'var(--bg-subtle)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>
            {adTypeLabel}
          </span>
        </div>
      )}

      {/* Card body */}
      <div className="flex flex-col flex-1 p-3" style={{ gap: 8 }}>
        {/* Ad name */}
        <p
          className="text-xs font-medium leading-snug"
          style={{
            color: 'var(--text-secondary)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={ad.ad_name}
        >
          {ad.ad_name || ad.ad_id}
        </p>

        {/* Metrics */}
        <div className="mt-auto space-y-1.5">
          {/* Spend */}
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Spend</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              {fmt$(displaySpend)}
            </span>
          </div>

          {isEcom ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>ROAS</span>
                <span
                  className="text-xs font-semibold"
                  style={{ color: showRoas ? roasColor : 'var(--text-faint)' }}
                >
                  {showRoas ? fmtRoas(ad.roas) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Revenue</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {ad.conversionValue > 0 ? fmt$(ad.conversionValue) : '—'}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{conversionLabel}</span>
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {ad.conversions > 0 ? ad.conversions.toFixed(0) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>CPL</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {ad.cpl > 0 ? fmtCurrency(ad.cpl) : '—'}
                </span>
              </div>
            </>
          )}

          {/* Divider + engagement */}
          <div
            className="flex items-center justify-between pt-1.5"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {fmtNum(ad.clicks)} clicks
            </span>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {fmtPct(ad.ctr)} CTR
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
