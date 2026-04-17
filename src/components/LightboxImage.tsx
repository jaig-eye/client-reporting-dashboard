'use client'

import { useState, useEffect } from 'react'

/**
 * Renders a thumbnail image. Clicking opens a full-resolution lightbox.
 * If videoId is provided, clicking links out to YouTube in a new tab.
 */
export default function LightboxImage({
  src,
  alt,
  width = 40,
  height = 40,
  videoId,
  fullSrc,
}: {
  src:      string
  alt:      string
  width?:   number
  height?:  number
  videoId?: string | null
  fullSrc?: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (videoId) {
    return (
      <a
        href={`https://www.youtube.com/watch?v=${videoId}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', width, height, position: 'relative', flexShrink: 0 }}
      >
        <img src={src} alt={alt} style={{ width, height, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(0,0,0,0.35)', borderRadius: 4,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="white">
            <polygon points="4,2 14,8 4,14" />
          </svg>
        </div>
      </a>
    )
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="View full size"
        style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', display: 'block', width, height, flexShrink: 0 }}
      >
        <img src={src} alt={alt} style={{ width, height, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, cursor: 'zoom-out',
          }}
        >
          <img
            src={fullSrc ?? src}
            alt={alt}
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '92vw', maxHeight: '90vh',
              objectFit: 'contain', borderRadius: 8,
              cursor: 'default', boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            }}
          />
          <button
            onClick={() => setOpen(false)}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'rgba(255,255,255,0.15)', border: 'none',
              color: 'white', width: 40, height: 40, borderRadius: 20,
              cursor: 'pointer', fontSize: 24, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>
      )}
    </>
  )
}
