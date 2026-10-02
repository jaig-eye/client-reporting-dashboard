'use client'

// Full-size preview of one stock candidate, opened from the strip in the review drawer.
//
// The strip applied an image on a single click of a 132px thumbnail, which is too small
// to judge a photo and gave no way to look before committing — and applying is not free:
// it downloads the file, uploads it into our storage and overwrites featured_image_url.
// This puts a look between the click and the commit, and surfaces the licence and
// photographer, which a thumbnail caption cannot fit. Built on the shared Dialog.

import { useRef } from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react'
import Dialog from '@/components/ui/Dialog'
import type { StockImageCandidate } from '@/lib/content/stockImages'
import ClientImage from './ClientImage'

const SOURCE_LABEL: Record<string, string> = {
  pexels:    'Pexels',
  wikimedia: 'Wikimedia Commons',
  openverse: 'Openverse',
  wp_media:  'Client media library',
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
  /**
   * Authorises the image proxy. Both pictures in this dialog can be the client's own — the
   * candidate when it came from their library, and the current featured image once one of
   * theirs was applied — and their host commonly refuses a direct browser fetch.
   */
  connectionId?: string | null
  onClose: () => void
  onApply: () => void
  /**
   * Why the last apply failed. The call site's own error banner renders at the top of the
   * edit column, far above the Images section, so a reviewer looking at this dialog saw
   * "Applying…" flicker and nothing else.
   */
  error?: string | null
}

export default function StockImageLightbox({ candidate: c, busy, currentImageUrl, connectionId, onClose, onApply, error }: Props) {
  const applyRef = useRef<HTMLButtonElement>(null)

  const meta: string[] = [
    SOURCE_LABEL[c.source] ?? 'Stock',
    c.width && c.height ? `${c.width}×${c.height}` : null,
    c.license,
    c.creator ? `by ${c.creator}` : null,
  ].filter((x): x is string => !!x)

  return (
    <Dialog
      open
      onClose={onClose}
      title={c.title || 'Untitled image'}
      description={meta.join(', ')}
      size="xl"
      busy={busy}
      initialFocus={applyRef}
      bodyClassName="lb-body"
      footer={<>
        {c.sourceUrl && (
          <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost lb-source">
            View the source<ArrowSquareOut size={14} aria-hidden />
          </a>
        )}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
        <button ref={applyRef} type="button" className="btn btn-primary" onClick={onApply} disabled={busy}>
          {busy ? 'Applying…' : 'Use as featured image'}
        </button>
      </>}
    >
      {/* The image gets the room. object-fit: contain, so a portrait or an unusually wide photo
          is shown whole rather than cropped to a lie about what you are choosing. */}
      <div className="lb-stage">
        <ClientImage
          src={c.url}
          alt={c.title}
          connectionId={c.source === 'wp_media' ? connectionId : null}
          style={{ maxWidth: '100%', maxHeight: '62vh', objectFit: 'contain', display: 'block' }}
        />
      </div>

      {error && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{error}</div>}

      {currentImageUrl ? (
        /* Shown only when there is something to lose. The previous featured image is not kept
           anywhere, so this is the last point at which the swap can be reconsidered. */
        <div className="lb-replace">
          <ClientImage
            src={currentImageUrl} alt="Current featured image"
            connectionId={connectionId}
            style={{ width: 54, height: 34, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
          />
          <p><strong>This replaces the current featured image.</strong> The one shown here isn’t kept: you’d need to regenerate or re-upload it.</p>
        </div>
      ) : (
        <p className="ui-hint" style={{ margin: 0 }}>Using it copies the file into your own storage and records its licence and attribution.</p>
      )}
    </Dialog>
  )
}
