'use client'

import { useState } from 'react'
import LightboxImage from './LightboxImage'

export interface AdSlide {
  ad_id:           string
  ad_name:         string
  image_url:       string | null
  thumbnail_url:   string | null
  video_thumb_url: string | null
  video_id:        string | null
  creative_title:  string | null
  creative_body:   string | null
  ad_status:       string | null
}

export default function AdCreativeSlider({ ads }: { ads: AdSlide[] }) {
  const [index, setIndex] = useState(0)

  // Only show active ads that have at least one image/thumbnail
  const slides = ads.filter(ad => {
    const s = (ad.ad_status ?? '').toUpperCase()
    const isActive = !ad.ad_status || s === 'ACTIVE' || s === 'ENABLED'
    const hasImage = !!(ad.image_url || ad.thumbnail_url || ad.video_thumb_url)
    return isActive && hasImage
  })

  if (slides.length === 0) return null

  const current = slides[Math.min(index, slides.length - 1)]
  const imgSrc  = current.image_url || current.thumbnail_url || current.video_thumb_url || ''

  function prev() { setIndex(i => (i - 1 + slides.length) % slides.length) }
  function next() { setIndex(i => (i + 1) % slides.length) }

  return (
    <div className="card p-5 mb-5">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
        <div>
          <h3 className="section-title" style={{ margin: 0 }}>Ad Creatives</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
            {slides.length} active ad{slides.length !== 1 ? 's' : ''} · click image to view full size
          </p>
        </div>
        {slides.length > 1 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
            {index + 1} / {slides.length}
          </span>
        )}
      </div>

      {/* Slide */}
      <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
        {/* Navigation — prev */}
        {slides.length > 1 && (
          <button
            onClick={prev}
            style={{
              flexShrink: 0, width: 32, height: 32, borderRadius: 16,
              border: '1px solid var(--border)', background: 'var(--bg-surface)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              alignSelf: 'center',
            }}
            aria-label="Previous ad"
          >
            ‹
          </button>
        )}

        {/* Image */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
          <LightboxImage
            src={imgSrc}
            alt={current.ad_name}
            width={200}
            height={200}
            videoId={current.video_id ?? undefined}
          />
        </div>

        {/* Copy */}
        <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
          {current.creative_title && (
            <p style={{
              fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)',
              margin: '0 0 0.375rem', lineHeight: 1.4,
            }}>
              {current.creative_title}
            </p>
          )}
          {current.creative_body && (
            <p style={{
              fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem',
              lineHeight: 1.6,
              display: '-webkit-box',
              WebkitLineClamp: 5,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {current.creative_body}
            </p>
          )}
          {!current.creative_title && !current.creative_body && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', margin: 0 }}>
              No copy available
            </p>
          )}
          <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', margin: '0.5rem 0 0' }}>
            {current.ad_name}
          </p>
        </div>

        {/* Navigation — next */}
        {slides.length > 1 && (
          <button
            onClick={next}
            style={{
              flexShrink: 0, width: 32, height: 32, borderRadius: 16,
              border: '1px solid var(--border)', background: 'var(--bg-surface)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              alignSelf: 'center',
            }}
            aria-label="Next ad"
          >
            ›
          </button>
        )}
      </div>

      {/* Dot indicators */}
      {slides.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginTop: '0.875rem' }}>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              style={{
                width: i === index ? 16 : 6, height: 6, borderRadius: 3,
                border: 'none', cursor: 'pointer', padding: 0,
                background: i === index ? 'var(--blue, #2563eb)' : 'var(--border)',
                transition: 'width 0.2s, background 0.2s',
              }}
              aria-label={`Go to ad ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
