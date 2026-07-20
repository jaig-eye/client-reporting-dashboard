'use client'

import { useState } from 'react'
import type { MetaAdRow, GoogleAdRow } from '@/lib/ads-library'

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(0)
}

function fmtCtr(clicks: number, impressions: number): string {
  if (impressions === 0) return '—'
  return ((clicks / impressions) * 100).toFixed(2) + '%'
}

export function isAdActive(status: string): boolean {
  const s = (status ?? '').toUpperCase()
  return s === 'ACTIVE' || s === 'ENABLED'
}

function googleTypeLabel(t: string | null): string | null {
  if (!t) return null
  if (t === 'RESPONSIVE_DISPLAY_AD') return 'Display'
  if (t === 'DEMAND_GEN_MULTI_ASSET_AD' || t === 'DEMAND_GEN_VIDEO_RESPONSIVE_AD') return 'Demand Gen'
  if (t === 'ASSET_GROUP') return 'PMax'
  return null
}

export function AdLibraryCard({ ad, clientId }: { ad: MetaAdRow | GoogleAdRow; clientId?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [lightbox, setLightbox] = useState(false)

  const active = isAdActive(ad.ad_status)

  // For Meta ads, route through the proxy so expired CDN signatures are refreshed automatically.
  // The proxy fetches a live URL from the Graph API (cached 30 min) and returns a 302 redirect.
  const proxyUrl = (clientId && ad.platform === 'meta')
    ? `/api/proxy/meta-image?ad_id=${encodeURIComponent(ad.ad_id)}&client_id=${encodeURIComponent(clientId)}`
    : null

  const previewUrl = proxyUrl ?? (ad.platform === 'meta'
    ? (ad.image_url ?? ad.video_thumb_url ?? ad.thumbnail_url ?? null)
    : (ad.image_url ?? null))

  const isVideo = ad.platform === 'meta' && !!ad.video_thumb_url

  const headline = ad.platform === 'meta'
    ? (ad.creative_title ?? '')
    : ((ad.headlines ?? []).slice(0, 3).join(' | '))

  const body = ad.platform === 'meta'
    ? (ad.creative_body ?? '')
    : ((ad.descriptions ?? []).slice(0, 2).join(' '))

  const metrics = [
    { label: 'Spend', value: fmtMoney(ad.spend) },
    { label: 'Impr',  value: fmtCompact(ad.impressions) },
    { label: 'CTR',   value: fmtCtr(ad.clicks, ad.impressions) },
    { label: 'Conv',  value: fmtCompact(ad.conversions) },
  ]

  return (
    <div style={{
      background: '#fff',
      border: '1.5px solid #e5e7eb',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'box-shadow 0.15s',
    }}>
      {/* Creative thumbnail */}
      <div style={{
        width: '100%', aspectRatio: '16/9',
        background: '#f3f4f6', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
      }}>
        {previewUrl ? (
          <>
            {/* Blurred background fill */}
            <img
              src={previewUrl}
              aria-hidden
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                filter: 'blur(14px) brightness(0.6)',
                transform: 'scale(1.15)',
                pointerEvents: 'none',
              }}
            />
            {/* Main image */}
            <img
              src={previewUrl}
              alt={ad.ad_name}
              style={{
                position: 'relative', zIndex: 1,
                width: '100%', height: '100%',
                objectFit: 'contain',
                cursor: 'zoom-in',
              }}
              onClick={() => setLightbox(true)}
              onError={e => {
                const el = e.target as HTMLImageElement
                el.style.display = 'none'
                const prev = el.previousElementSibling as HTMLImageElement | null
                if (prev) prev.style.display = 'none'
              }}
            />
            {isVideo && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.52)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="white">
                    <path d="M6.5 5.5l9 4.5-9 4.5V5.5z"/>
                  </svg>
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: ad.platform === 'meta' ? '#eff6ff' : '#f0fdf4',
          }}>
            <span style={{ fontSize: '1.75rem', opacity: 0.4 }}>
              {ad.platform === 'meta' ? '📘' : '🔵'}
            </span>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && previewUrl && (
        <div
          onClick={() => setLightbox(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
            padding: '1rem',
          }}
        >
          <img
            src={previewUrl}
            alt={ad.ad_name}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }}
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(false)}
            style={{
              position: 'absolute', top: 20, right: 24,
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#fff', fontSize: '1.5rem', lineHeight: 1, opacity: 0.8,
              padding: '0.5rem',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Card content */}
      <div style={{ padding: '0.875rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

        {/* Badges row */}
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '0.6875rem', fontWeight: 600, padding: '0.125rem 0.5rem', borderRadius: 4,
            background: ad.platform === 'meta' ? '#eff6ff' : '#f0fdf4',
            color:      ad.platform === 'meta' ? '#1d4ed8' : '#15803d',
          }}>
            {ad.platform === 'meta' ? 'Meta' : 'Google'}
          </span>
          <span style={{
            fontSize: '0.6875rem', fontWeight: 600, padding: '0.125rem 0.5rem', borderRadius: 4,
            background: active ? '#f0fdf4' : '#f9fafb',
            color:      active ? '#15803d' : '#6b7280',
          }}>
            {active ? 'Active' : 'Paused'}
          </span>
          {ad.platform === 'google' && googleTypeLabel(ad.ad_type) && (
            <span style={{
              fontSize: '0.6875rem', fontWeight: 500, padding: '0.125rem 0.5rem', borderRadius: 4,
              background: '#dcfce7', color: '#166534',
            }}>
              {googleTypeLabel(ad.ad_type)}
            </span>
          )}
          {ad.platform === 'meta' && ad.adset_daily_budget != null && (
            <span style={{
              fontSize: '0.6875rem', fontWeight: 500, padding: '0.125rem 0.5rem', borderRadius: 4,
              background: '#fefce8', color: '#854d0e',
            }}>
              {fmtMoney(ad.adset_daily_budget)}/day
            </span>
          )}
        </div>

        {/* Ad name */}
        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: '#111827', lineHeight: 1.4 }}>
          {ad.ad_name || 'Untitled Ad'}
        </p>

        {/* Campaign › Adset context */}
        <p style={{ margin: 0, fontSize: '0.75rem', color: '#9ca3af', lineHeight: 1.3 }}>
          {ad.platform === 'meta'
            ? [ad.campaign_name, ad.adset_name].filter(Boolean).join(' › ')
            : [ad.campaign_name, ad.ad_group_name].filter(Boolean).join(' › ')}
        </p>

        {/* Copy preview */}
        {(headline || body) && (
          <div style={{ flex: 1, minHeight: 0 }}>
            {headline && (
              <p style={{ margin: '0 0 0.25rem', fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }}>
                {headline}
              </p>
            )}
            {body && (
              <>
                <p style={{
                  margin: 0, fontSize: '0.75rem', color: '#6b7280', lineHeight: 1.5,
                  display: '-webkit-box',
                  WebkitLineClamp: expanded ? undefined : 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: expanded ? 'visible' : 'hidden',
                }}>
                  {body}
                </p>
                {body.length > 120 && (
                  <button
                    onClick={() => setExpanded(e => !e)}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      color: '#3b82f6', fontSize: '0.75rem', marginTop: '0.25rem',
                    }}
                  >
                    {expanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Metrics row */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0.25rem', paddingTop: '0.625rem',
          borderTop: '1px solid #f3f4f6', marginTop: 'auto',
        }}>
          {metrics.map(({ label, value }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 600, color: '#111827' }}>{value}</p>
              <p style={{ margin: 0, fontSize: '0.6875rem', color: '#9ca3af' }}>{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
