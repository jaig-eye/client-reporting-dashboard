'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Choosing a featured image.
//
// This replaces a column of controls that had accreted inside the review drawer: a search
// box, a "Their library" button, a Clear button, a result count, a horizontal strip of
// stock suggestions, a "Search again" button and an empty-state button — seven controls
// stacked under the featured image, competing for a space that should show one picture.
//
// The horizontal strip was the root of it. A strip fits a drawer, so everything else had to
// fit around the strip; and because a strip shows six thumbnails at 132px, judging a
// photograph meant scrubbing sideways through a viewport the width of a business card. That
// is the wrong shape for the task — picking an image is a BROWSING job, and browsing wants
// area, which a drawer does not have and a modal does.
//
// Two tabs, because the two sources answer different questions:
//   Their library — "did the client already give us a picture of this?" Needs search, because
//                   a mature site has thousands and the answer is one of them.
//   Stock photos  — "is there a usable photo of this subject at all?" Needs no search box:
//                   the queries are derived from the post, which is what makes them relevant,
//                   and a free-text box here was removed once already for producing worse
//                   results than the post's own topic.
//
// Selection is deliberately two-step — click to select, then Apply. Applying overwrites the
// current featured image and is a network round trip, so a single misclick in a dense grid
// should not spend one.
//
// Built on the shared Dialog (its largest size, a fixed height so the grid scrolls inside it).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { Books, MagnifyingGlass, ArrowClockwise } from '@phosphor-icons/react'
import Dialog from '@/components/ui/Dialog'
import { PillTabs } from '@/components/ui/PillTabs'
import type { StockImageCandidate } from '@/lib/content/stockImages'
import ClientImage from './ClientImage'
import { Sk } from '@/components/ui/Skeleton'

type TabId = 'library' | 'stock'

interface Props {
  postTitle?: string | null
  /** The connection whose media library is searched. Without one the library tab explains why. */
  connectionId?: string | null
  /** Stock candidates banked with the post. */
  stockCandidates: StockImageCandidate[]
  /** Shown so the reviewer knows what they are replacing. */
  currentImageUrl?: string | null
  applyingId?: string | null
  applyError?: string | null
  /** Re-runs the derived-topic stock search. */
  onRefreshStock: () => void
  refreshingStock?: boolean
  stockNote?: string
  onApply: (candidate: StockImageCandidate) => void
  /** Opens the full-size look before committing. */
  onPreview?: (candidate: StockImageCandidate) => void
  onClose: () => void
}

const SOURCE_LABEL: Record<string, string> = {
  pexels: 'Pexels', openverse: 'Openverse', wikimedia: 'Wikimedia', wp_media: 'Their library',
}

export default function ImageLibraryModal({
  postTitle, connectionId, stockCandidates, currentImageUrl,
  applyingId, applyError, onRefreshStock, refreshingStock, stockNote, onApply, onPreview, onClose,
}: Props) {
  const [tab, setTab] = useState<TabId>(connectionId ? 'library' : 'stock')
  const [selected, setSelected] = useState<StockImageCandidate | null>(null)

  const [query, setQuery]       = useState('')
  const [media, setMedia]       = useState<StockImageCandidate[]>([])
  const [page, setPage]         = useState(1)
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [searched, setSearched] = useState(false)
  /**
   * The query that produced what is currently on screen — NOT the live text box.
   *
   * "Load more" used to read the box, so typing a new search and pressing Load more without
   * pressing Search appended page 2 of the NEW search onto page 1 of the old one, silently
   * mixing two result sets in one grid.
   */
  const [activeQuery, setActiveQuery] = useState('')
  /** Guards the auto-list against firing again while its first request is still in flight. */
  const listingRef = useRef(false)

  const searchRef = useRef<HTMLInputElement>(null)

  /**
   * `append` is what makes "Load more" additive rather than a page swap. A grid that REPLACED
   * its contents on page 2 would lose the image someone was comparing against.
   */
  const search = useCallback(async (nextPage: number, append: boolean, q: string) => {
    if (!connectionId) return
    setLoading(true)
    setMediaError('')
    try {
      const qs = new URLSearchParams({ connection_id: connectionId, page: String(nextPage) })
      if (q.trim()) qs.set('q', q.trim())
      const res  = await fetch(`/api/admin/wordpress/media?${qs.toString()}`)
      const data = await res.json() as {
        items?: StockImageCandidate[]; total?: number; error?: string
        unsupported?: boolean; reason?: string
      }
      if (data.unsupported) { setMedia([]); setTotal(0); setMediaError(data.reason ?? 'Not available for this site.'); return }
      if (!res.ok) throw new Error(data.error ?? 'Could not search their library')
      const items = data.items ?? []
      setMedia(prev => (append ? [...prev, ...items] : items))
      setTotal(data.total ?? items.length)
      setPage(nextPage)
      setActiveQuery(q)
    } catch (e) {
      if (!append) setMedia([])
      setMediaError(e instanceof Error ? e.message : 'Could not search their library')
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [connectionId])

  // First open of the library tab lists recent uploads — the fastest way to find images
  // somebody added for this piece, and it means the tab is never an empty box.
  useEffect(() => {
    // A ref, not the searched flag: that only flips when the request RESOLVES, so every
    // keystroke during the first round trip fired another request at the client's WordPress.
    if (tab !== 'library' || !connectionId || searched || listingRef.current) return
    listingRef.current = true
    void search(1, false, '')
  }, [tab, connectionId, searched, search])

  const items = tab === 'library' ? media : stockCandidates
  const busy  = applyingId != null

  return (
    <Dialog
      open
      onClose={onClose}
      title="Image library"
      description={postTitle ?? undefined}
      size="xl"
      busy={busy}
      initialFocus={connectionId ? searchRef : undefined}
      className="il-dialog"
      bodyClassName="il-body"
      footer={<>
        <div className="il-selection">
          {applyError ? (
            <span className="il-error" role="alert">{applyError}</span>
          ) : selected ? (
            <>
              <span className="il-sel-title">{selected.title || 'Untitled'}</span>
              {selected.creator ? `, ${selected.creator}` : ''}, {selected.license}
              {currentImageUrl && <span className="il-replaces">Replaces the current featured image.</span>}
            </>
          ) : (
            'Select an image, then use it. Double-click to see it full size.'
          )}
        </div>
        {onPreview && (
          <button type="button" className="btn btn-secondary" disabled={!selected || busy} onClick={() => selected && onPreview(selected)} title="See it full size before using it">
            Preview
          </button>
        )}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!selected || busy} onClick={() => selected && onApply(selected)}>
          <Books size={14} weight="bold" aria-hidden />{busy ? 'Applying…' : 'Use as featured image'}
        </button>
      </>}
    >
      <div className="il-tools">
        {/* Clearing the selection on a tab switch: it used to survive, so Apply could commit an
            image that was no longer anywhere on screen. */}
        <PillTabs
          label="Where to look"
          activeId={tab}
          onSelect={id => { setTab(id as TabId); setSelected(null) }}
          items={[
            { id: 'library', label: 'Their library' },
            { id: 'stock', label: 'Stock photos', count: stockCandidates.length || null },
          ]}
        />
        <div className="il-toolbar">
          {tab === 'library' ? (
            connectionId ? (
              <>
                <label className="il-search">
                  <MagnifyingGlass size={14} weight="bold" aria-hidden />
                  <span className="sr-only">Search the client’s media library</span>
                  <input
                    ref={searchRef}
                    className="input"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !loading) { e.preventDefault(); void search(1, false, query) } }}
                    placeholder="Search their media library"
                  />
                </label>
                <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void search(1, false, query)}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
                <span className="il-note">
                  {mediaError ? mediaError : media.length > 0 ? `${media.length} of ${total.toLocaleString()}` : searched ? 'Nothing found' : ''}
                </span>
              </>
            ) : (
              <span className="il-note">Choose a site connection under Publish to search the client’s own images.</span>
            )
          ) : (
            <>
              <button type="button" className="btn btn-secondary" disabled={refreshingStock} onClick={onRefreshStock}>
                <ArrowClockwise size={13} weight="bold" aria-hidden />{refreshingStock ? 'Searching…' : 'Search again'}
              </button>
              <span className="il-note">{stockNote || 'Searched on this post’s own topic. There’s no search box because that query matches better.'}</span>
            </>
          )}
        </div>
      </div>

      <div className="il-gallery">
        {items.length === 0 && tab === 'library' && loading ? (
          <div className="il-grid" aria-busy="true" aria-label="Loading images">
            {Array.from({ length: 8 }, (_, i) => <Sk key={i} h={112} r={8} />)}
          </div>
        ) : items.length === 0 ? (
          <p className="il-empty">
            {tab === 'library'
              ? (mediaError ? mediaError : connectionId ? 'No images here yet. Try a different search.' : 'No site connection chosen.')
              : 'No stock photos were close enough to this topic. That’s normal for specialised subjects: a confident wrong photo is worse than none.'}
          </p>
        ) : (
          <div className="il-grid">
            {items.map(c => {
              const isSel = selected?.id === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  className="il-item"
                  onClick={() => setSelected(c)}
                  onDoubleClick={() => { setSelected(c); onPreview?.(c) }}
                  disabled={busy}
                  title={`${c.title}${c.creator ? `, ${c.creator}` : ''}, ${c.license}`}
                  aria-pressed={isSel}
                  data-dim={applyingId && applyingId !== c.id ? 'true' : undefined}
                >
                  {/* Their library is served from their own host, so these go through the proxy.
                      Stock thumbnails are on public CDNs that want to be embedded and need no
                      help, and proxying them would fail the host check. */}
                  <ClientImage
                    src={c.thumbnail} alt={c.title} loading="lazy"
                    connectionId={c.source === 'wp_media' ? connectionId : null}
                    style={{ width: '100%', height: 108, objectFit: 'cover', display: 'block', background: 'var(--bg-subtle)' }}
                  />
                  {(applyingId === c.id || tab === 'stock') && (
                    <span className="il-source">{applyingId === c.id ? 'Applying…' : (SOURCE_LABEL[c.source] ?? 'Stock')}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {tab === 'library' && media.length > 0 && media.length < total && (
          <div className="il-more">
            <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void search(page + 1, true, activeQuery)}>
              {loading ? 'Loading…' : `Load more (${(total - media.length).toLocaleString()} left)`}
            </button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
