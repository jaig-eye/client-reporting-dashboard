'use client'

import { useState, useEffect, useCallback } from 'react'

const IMAGE_TYPES = new Set(['MARKETING_IMAGE', 'SQUARE_MARKETING_IMAGE', 'PORTRAIT_MARKETING_IMAGE'])
const LOGO_TYPES  = new Set(['LOGO', 'LANDSCAPE_LOGO'])

interface PMaxAsset {
  asset_id:     string
  field_type:   string
  text_content: string | null
  image_url:    string | null
  video_id:     string | null
}

function typeLabel(fieldType: string): string {
  if (fieldType === 'PORTRAIT_MARKETING_IMAGE') return 'portrait'
  if (fieldType === 'SQUARE_MARKETING_IMAGE')   return 'square'
  if (fieldType === 'MARKETING_IMAGE')          return 'landscape'
  return fieldType.replace(/_/g, ' ').toLowerCase()
}

export default function PMaxAssetSlider({ assets }: { assets: PMaxAsset[] }) {
  const [failed,      setFailed]      = useState<Set<string>>(new Set())
  const [lightbox,    setLightbox]    = useState<number | null>(null)
  const [videoModal,  setVideoModal]  = useState<string | null>(null)

  const imageAssets = assets.filter(a => IMAGE_TYPES.has(a.field_type) && a.image_url)
  const logoAssets  = assets.filter(a => LOGO_TYPES.has(a.field_type)  && a.image_url)
  const videoAssets = assets.filter(a => a.field_type === 'YOUTUBE_VIDEO' && a.video_id)

  const workingImages = imageAssets.filter(a => !failed.has(a.asset_id))

  function markFailed(assetId: string) {
    setFailed(prev => { const next = new Set(prev); next.add(assetId); return next })
  }

  const closeLightbox  = useCallback(() => setLightbox(null), [])
  const prevLightbox   = useCallback(() => setLightbox(i => i === null ? null : (i - 1 + workingImages.length) % workingImages.length), [workingImages.length])
  const nextLightbox   = useCallback(() => setLightbox(i => i === null ? null : (i + 1) % workingImages.length), [workingImages.length])

  useEffect(() => {
    if (lightbox === null && videoModal === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape')      { setLightbox(null); setVideoModal(null) }
      if (lightbox !== null) {
        if (e.key === 'ArrowLeft')  prevLightbox()
        if (e.key === 'ArrowRight') nextLightbox()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, videoModal, prevLightbox, nextLightbox])

  // Prevent body scroll when overlay open
  useEffect(() => {
    if (lightbox !== null || videoModal !== null) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [lightbox, videoModal])

  const hasContent = workingImages.length > 0 || logoAssets.length > 0 || videoAssets.length > 0
  if (!hasContent && imageAssets.length === 0 && logoAssets.length === 0 && videoAssets.length === 0) return null

  return (
    <div style={{ marginBottom: '1.5rem' }}>

      {/* ── Image grid ───────────────────────────────────────────────────────── */}
      {imageAssets.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
            Images
          </p>

          {workingImages.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>No previewable images</p>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: '0.5rem',
            }}>
              {workingImages.map((a, i) => (
                <button
                  key={a.asset_id}
                  onClick={() => setLightbox(i)}
                  style={{
                    position: 'relative', padding: 0, border: '1px solid var(--border)',
                    borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in',
                    background: 'var(--bg-subtle)', aspectRatio: '4/3',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--blue)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 0 2px var(--blue-subtle)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none' }}
                  aria-label={`View ${typeLabel(a.field_type)} image ${i + 1}`}
                >
                  <img
                    src={a.image_url!}
                    alt={typeLabel(a.field_type)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onError={() => markFailed(a.asset_id)}
                  />
                  {/* Type badge overlay */}
                  <span style={{
                    position: 'absolute', bottom: 4, left: 4,
                    fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                    background: 'rgba(0,0,0,0.55)', color: '#fff',
                    padding: '1px 5px', borderRadius: 3, lineHeight: 1.6,
                  }}>
                    {typeLabel(a.field_type)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Hidden preload for broken-URL detection */}
          <div style={{ display: 'none' }}>
            {imageAssets.map(a => (
              <img key={a.asset_id} src={a.image_url!} alt="" onError={() => markFailed(a.asset_id)} />
            ))}
          </div>
        </div>
      )}

      {/* ── Logos ────────────────────────────────────────────────────────────── */}
      {logoAssets.length > 0 && (
        <div style={{ marginTop: imageAssets.length > 0 ? '1.25rem' : 0 }}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
            Logos
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {logoAssets.map(a => (
              <div
                key={a.asset_id + a.field_type}
                style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', padding: '0.5rem', background: 'var(--bg-base)' }}
              >
                <img src={a.image_url!} alt="logo" style={{ height: 48, objectFit: 'contain', display: 'block' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Videos ───────────────────────────────────────────────────────────── */}
      {videoAssets.length > 0 && (
        <div style={{ marginTop: (imageAssets.length > 0 || logoAssets.length > 0) ? '1.25rem' : 0 }}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
            Videos
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {videoAssets.map(a => (
              <button
                key={a.asset_id}
                onClick={() => setVideoModal(a.video_id)}
                style={{
                  display: 'block', borderRadius: 8, overflow: 'hidden',
                  border: '1px solid var(--border)', width: 200, position: 'relative',
                  cursor: 'pointer', padding: 0, background: 'none',
                }}
                aria-label="Play video"
              >
                <img
                  src={`https://img.youtube.com/vi/${a.video_id}/mqdefault.jpg`}
                  alt="video thumbnail"
                  style={{ width: '100%', objectFit: 'cover', display: 'block' }}
                />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="#333"><polygon points="5,3 13,8 5,13" /></svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Image lightbox ───────────────────────────────────────────────────── */}
      {lightbox !== null && workingImages[lightbox] && (
        <div
          onClick={closeLightbox}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: '1rem',
          }}
        >
          {/* Close */}
          <button
            onClick={closeLightbox}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '50%', width: 36, height: 36, color: '#fff',
              cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>

          {/* Prev */}
          {workingImages.length > 1 && (
            <button
              onClick={e => { e.stopPropagation(); prevLightbox() }}
              style={{
                position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '50%', width: 44, height: 44, color: '#fff',
                cursor: 'pointer', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1,
              }}
              aria-label="Previous image"
            >
              ‹
            </button>
          )}

          {/* Image */}
          <div
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '85vh', position: 'relative' }}
          >
            <img
              src={workingImages[lightbox].image_url!}
              alt={typeLabel(workingImages[lightbox].field_type)}
              style={{
                maxWidth: '90vw', maxHeight: '85vh',
                objectFit: 'contain', borderRadius: 8, display: 'block',
                boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              }}
            />
            {/* Counter + type */}
            <div style={{
              position: 'absolute', bottom: -28, left: 0, right: 0,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.55)', textTransform: 'capitalize' }}>
                {typeLabel(workingImages[lightbox].field_type)}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' }}>
                {lightbox + 1} / {workingImages.length}
              </span>
            </div>
          </div>

          {/* Next */}
          {workingImages.length > 1 && (
            <button
              onClick={e => { e.stopPropagation(); nextLightbox() }}
              style={{
                position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '50%', width: 44, height: 44, color: '#fff',
                cursor: 'pointer', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1,
              }}
              aria-label="Next image"
            >
              ›
            </button>
          )}
        </div>
      )}

      {/* ── YouTube video modal ──────────────────────────────────────────────── */}
      {videoModal && (
        <div
          onClick={() => setVideoModal(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: '1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 800, borderRadius: 12, overflow: 'hidden', background: '#000', position: 'relative' }}
          >
            <button
              onClick={() => setVideoModal(null)}
              style={{
                position: 'absolute', top: 8, right: 8, zIndex: 1,
                background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
                width: 32, height: 32, color: '#fff', cursor: 'pointer', fontSize: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="Close video"
            >
              ×
            </button>
            <iframe
              src={`https://www.youtube.com/embed/${videoModal}?autoplay=1`}
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
              style={{ width: '100%', aspectRatio: '16/9', border: 'none', display: 'block' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
