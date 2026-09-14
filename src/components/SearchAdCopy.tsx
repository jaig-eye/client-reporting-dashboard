// SearchAdCopy — displays RSA / ETA ad copy (headlines + descriptions + URL)
// Used in the ad set detail view for Google Search campaigns.

export interface SearchAdCopyRow {
  ad_id:        string
  ad_name:      string
  ad_type:      string | null
  ad_status:    string | null
  ad_strength:  string | null
  headlines:    string[] | null
  descriptions: string[] | null
  final_url:    string | null
  impressions:  number
  clicks:       number
  conversions:  number
  displaySpend: number
  ctr:          number
}

const STRENGTH_STYLE: Record<string, { color: string; bg: string }> = {
  EXCELLENT:    { color: 'var(--green)', bg: 'var(--green-subtle)' },
  GOOD:         { color: 'var(--blue)', bg: 'var(--blue-subtle)' },
  AVERAGE:      { color: 'var(--amber)', bg: 'var(--amber-subtle)' },
  POOR:         { color: 'var(--red)', bg: 'var(--red-subtle)' },
  PENDING:      { color: 'var(--text-muted)', bg: 'var(--bg-subtle)' },
}

function adTypeLabel(t: string | null) {
  if (!t) return null
  if (t.includes('RESPONSIVE_SEARCH')) return 'RSA'
  if (t.includes('EXPANDED_TEXT'))     return 'ETA'
  if (t.includes('RESPONSIVE_DISPLAY')) return 'Display'
  return t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

function statusDot(s: string | null) {
  const on = !s || s === 'ENABLED'
  return (
    <span
      style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
        background: on ? 'var(--green)' : 'var(--text-muted)', marginRight: 5, flexShrink: 0,
      }}
    />
  )
}

export default function SearchAdCopy({ ads }: { ads: SearchAdCopyRow[] }) {
  if (!ads.length) {
    return (
      <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
        No ad copy data for this period.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {ads.map(ad => {
        const strengthStyle = STRENGTH_STYLE[(ad.ad_strength ?? '').toUpperCase()] ?? { color: 'var(--text-muted)', bg: 'var(--bg-subtle)' }
        const typeLabel     = adTypeLabel(ad.ad_type)
        const urlDisplay    = ad.final_url
          ? ad.final_url.replace(/^https?:\/\//, '').replace(/\/$/, '')
          : null

        return (
          <div
            key={ad.ad_id}
            className="rounded-xl border p-4"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
          >
            {/* Header row */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <div className="flex items-center" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {statusDot(ad.ad_status)}
                <span>{ad.ad_name || 'Ad'}</span>
              </div>
              {typeLabel && (
                <span
                  style={{
                    fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em',
                    padding: '1px 7px', borderRadius: 99, background: 'rgba(139,92,246,0.12)', color: '#8b5cf6',
                  }}
                >
                  {typeLabel}
                </span>
              )}
              {ad.ad_strength && (
                <span
                  style={{
                    fontSize: '0.68rem', fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                    background: strengthStyle.bg, color: strengthStyle.color,
                  }}
                >
                  {ad.ad_strength.charAt(0) + ad.ad_strength.slice(1).toLowerCase()} strength
                </span>
              )}
              {/* Mini metrics */}
              <div className="ml-auto flex items-center gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                {ad.impressions > 0 && <span>{ad.impressions.toLocaleString()} impr.</span>}
                {ad.clicks > 0      && <span>{ad.clicks.toLocaleString()} clicks</span>}
                {ad.ctr > 0         && <span>{(ad.ctr * 100).toFixed(2)}% CTR</span>}
              </div>
            </div>

            {/* URL display */}
            {urlDisplay && (
              <p
                className="text-xs mb-2 font-medium truncate"
                style={{ color: 'var(--green)' }}
                title={ad.final_url ?? undefined}
              >
                {urlDisplay}
              </p>
            )}

            {/* Headlines */}
            {(ad.headlines ?? []).length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
                  Headlines
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(ad.headlines ?? []).map((h, i) => (
                    <span
                      key={i}
                      className="text-sm px-2.5 py-1 rounded-lg border"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-base)', lineHeight: 1.4 }}
                    >
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Descriptions */}
            {(ad.descriptions ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
                  Descriptions
                </p>
                <div className="space-y-1">
                  {(ad.descriptions ?? []).map((d, i) => (
                    <p
                      key={i}
                      className="text-sm"
                      style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
                    >
                      {d}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {(ad.headlines ?? []).length === 0 && (ad.descriptions ?? []).length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>No copy fetched — re-sync to populate ad creatives.</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
