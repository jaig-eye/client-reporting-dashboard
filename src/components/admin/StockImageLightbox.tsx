'use client'

// Full-size preview of one stock candidate, opened from the strip in the review drawer.
//
// The strip applied an image on a single click of a 132px thumbnail, which is too small
// to judge a photo and gave no way to look before committing — and applying is not free:
// it downloads the file, uploads it into our storage and overwrites featured_image_url.
// This puts a look between the click and the commit, and surfaces the licence and
// photographer, which a thumbnail caption cannot fit.

import { useEffect, useRef } from 'react'
import type { StockImageCandidate } from '@/lib/content/stockImages'

const SOURCE_LABEL: Record<string, string> = {
  pexels:    'Pexels',
  wikimedia: 'Wikimedia Commons',
  openverse: 'Openverse',
}

interface Props {
  candidate: StockImageCandidate
  /** True while this image is being downloaded and applied. */
  busy?: boolean
  /**
   * The featured image currently on the post, if any. Applying REPLACES it, and the
   * previous one is not kept anywhere — so when there is one to lose, say so before the
   * click rather than after.
   */
  currentImageUrl?: string | null
  onClose: () => void
  onApply: () => void
}

export default function StockImageLightbox({ candidate: c, busy, currentImageUrl, onClose, onApply }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const applyRef  = useRef<HTMLButtonElement>(null)

  useEffect(() => { applyRef.current?.focus() }, [])

  // Escape closes, Tab is trapped, focus is restored. aria-modal claims the background is
  // inert and Approve/Reject/Save sit behind this.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const f = root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previouslyFocused?.focus?.() }
  }, [onClose])

  const meta: string[] = [
    SOURCE_LABEL[c.source] ?? 'Stock',
    c.width && c.height ? `${c.width}×${c.height}` : null,
    c.license,
  ].filter((x): x is string => !!x)

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Preview: ${c.title}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        ref={dialogRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)', borderRadius: 10,
          maxWidth: 'min(1000px, 100%)', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        {/* The image itself gets the room. object-fit: contain so a portrait or an
            unusually wide photo is shown whole rather than cropped to a lie about what
            you are choosing. */}
        <div style={{ background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, flex: 1, overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={c.url}
            alt={c.title}
            style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block' }}
          />
        </div>

        <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
            {c.title}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {meta.join(' · ')}
            {c.creator ? ` · by ${c.creator}` : ''}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {c.sourceUrl && (
              <a
                href={c.sourceUrl} target="_blank" rel="noopener noreferrer"
                className="btn btn-secondary" style={{ fontSize: '0.78rem' }}
              >
                View source ↗
              </a>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={onClose} disabled={busy}>
              Close
            </button>
            <button
              ref={applyRef}
              type="button" className="btn btn-primary" style={{ fontSize: '0.8rem' }}
              onClick={onApply} disabled={busy}
            >
              {busy ? 'Applying…' : 'Use as featured image'}
            </button>
          </div>

          {currentImageUrl ? (
            /* Shown only when there is something to lose. The previous featured image is
               not retained anywhere, so this is the last point at which the swap can be
               reconsidered. */
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginTop: 10,
              padding: '8px 10px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-subtle)',
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentImageUrl} alt="Current featured image"
                style={{ width: 54, height: 34, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
              />
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                <strong>This replaces the current featured image.</strong>{' '}
                <span style={{ color: 'var(--text-muted)' }}>
                  The one shown here is not kept — you would need to regenerate or re-upload it.
                </span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 8 }}>
              Applying copies the file into your own storage and records its licence and attribution.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
