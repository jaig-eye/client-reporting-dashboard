'use client'

import { useState } from 'react'
import LightboxImage from './LightboxImage'

const IMAGE_TYPES = new Set(['MARKETING_IMAGE', 'SQUARE_MARKETING_IMAGE', 'PORTRAIT_MARKETING_IMAGE'])
const LOGO_TYPES  = new Set(['LOGO', 'LANDSCAPE_LOGO'])

interface PMaxAsset {
  asset_id:     string
  field_type:   string
  text_content: string | null
  image_url:    string | null
  video_id:     string | null
}

export default function PMaxAssetSlider({ assets }: { assets: PMaxAsset[] }) {
  const [index, setIndex] = useState(0)
  // Track image IDs that failed to load so we can hide them
  const [failed, setFailed] = useState<Set<string>>(new Set())

  const imageAssets = assets.filter(a => IMAGE_TYPES.has(a.field_type) && a.image_url)
  const logoAssets  = assets.filter(a => LOGO_TYPES.has(a.field_type)  && a.image_url)
  const videoAssets = assets.filter(a => a.field_type === 'YOUTUBE_VIDEO' && a.video_id)

  // Working images — exclude ones that errored
  const workingImages = imageAssets.filter(a => !failed.has(a.asset_id))

  function markFailed(assetId: string) {
    setFailed(prev => { const next = new Set(prev); next.add(assetId); return next })
  }

  // Clamp index to valid range when images disappear
  const clampedIndex = workingImages.length > 0 ? Math.min(index, workingImages.length - 1) : 0

  function prev() { setIndex(i => (i - 1 + workingImages.length) % workingImages.length) }
  function next() { setIndex(i => (i + 1) % workingImages.length) }

  const hasContent = workingImages.length > 0 || logoAssets.length > 0 || videoAssets.length > 0

  if (!hasContent && imageAssets.length === 0 && logoAssets.length === 0 && videoAssets.length === 0) {
    return null
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>

      {/* Images slider */}
      {imageAssets.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
            Images
          </p>

          {workingImages.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>
              No previewable images
            </p>
          ) : (
            <>
              {/* Slide area */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.5rem', background: 'var(--bg-subtle)',
                borderRadius: 8, border: '1px solid var(--border)',
              }}>
                {/* Prev */}
                {workingImages.length > 1 && (
                  <button
                    onClick={prev}
                    style={{
                      flexShrink: 0, width: 32, height: 32, borderRadius: 16,
                      border: '1px solid var(--border)', background: 'var(--bg-surface)',
                      color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    aria-label="Previous image"
                  >
                    ‹
                  </button>
                )}

                {/* Current image */}
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minHeight: 140 }}>
                  <LightboxImage
                    src={workingImages[clampedIndex].image_url!}
                    alt={workingImages[clampedIndex].field_type.replace(/_/g, ' ').toLowerCase()}
                    width={220}
                    height={160}
                  />
                </div>

                {/* Next */}
                {workingImages.length > 1 && (
                  <button
                    onClick={next}
                    style={{
                      flexShrink: 0, width: 32, height: 32, borderRadius: 16,
                      border: '1px solid var(--border)', background: 'var(--bg-surface)',
                      color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    aria-label="Next image"
                  >
                    ›
                  </button>
                )}
              </div>

              {/* Counter + type label */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <p style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', margin: 0 }}>
                  {workingImages[clampedIndex].field_type.replace(/_/g, ' ').toLowerCase()}
                </p>
                {workingImages.length > 1 && (
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                    {clampedIndex + 1} / {workingImages.length}
                  </span>
                )}
              </div>

              {/* Dot indicators */}
              {workingImages.length > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginTop: 8 }}>
                  {workingImages.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setIndex(i)}
                      style={{
                        width: i === clampedIndex ? 16 : 6, height: 6, borderRadius: 3,
                        border: 'none', cursor: 'pointer', padding: 0,
                        background: i === clampedIndex ? 'var(--blue, #2563eb)' : 'var(--border)',
                        transition: 'width 0.2s, background 0.2s',
                      }}
                      aria-label={`Go to image ${i + 1}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Hidden preload images — used to detect broken URLs client-side */}
          <div style={{ display: 'none' }}>
            {imageAssets.map(a => (
              <img
                key={a.asset_id}
                src={a.image_url!}
                alt=""
                onError={() => markFailed(a.asset_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Logos */}
      {logoAssets.length > 0 && (
        <div style={{ marginTop: imageAssets.length > 0 ? '1.25rem' : 0 }}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
            Logos
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {logoAssets.map(a => (
              <div
                key={a.asset_id + a.field_type}
                style={{
                  borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)',
                  padding: '0.5rem', background: 'var(--bg-base)',
                }}
              >
                <img
                  src={a.image_url!}
                  alt="logo"
                  style={{ height: 48, objectFit: 'contain', display: 'block' }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Videos */}
      {videoAssets.length > 0 && (
        <div style={{ marginTop: (imageAssets.length > 0 || logoAssets.length > 0) ? '1.25rem' : 0 }}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
            Videos
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {videoAssets.map(a => (
              <a
                key={a.asset_id}
                href={`https://www.youtube.com/watch?v=${a.video_id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', width: 200, position: 'relative', textDecoration: 'none' }}
              >
                <img
                  src={`https://img.youtube.com/vi/${a.video_id}/mqdefault.jpg`}
                  alt="video thumbnail"
                  style={{ width: '100%', objectFit: 'cover', display: 'block' }}
                />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="#333">
                      <polygon points="5,3 13,8 5,13" />
                    </svg>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
