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
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { Books, MagnifyingGlass, ArrowClockwise } from '@phosphor-icons/react'
import type { StockImageCandidate } from '@/lib/content/stockImages'

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

  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null
    searchRef.current?.focus()
    return () => { openerRef.current?.focus?.() }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (!applyingId) onClose(); return }
      if (e.key !== 'Tab') return
      // Tab was untrapped here while all three sibling dialogs trap it, so keyboard focus
      // walked out of a modal covering the page and into the drawer behind it.
      const root = dialogRef.current
      if (!root) return
      const f = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, applyingId])

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

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 14px', fontSize: '0.8125rem', fontWeight: active ? 700 : 500,
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    // border AFTER borderBottom resets it, so the active underline never rendered. Only the
    // three sides that need clearing are cleared.
    background: 'none', cursor: 'pointer',
    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    borderBottom: `2px solid ${active ? 'var(--blue)' : 'transparent'}`,
  })

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Choose a featured image"
      onClick={() => { if (!busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1150, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        ref={dialogRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated, #fff)', borderRadius: 10,
          width: 'min(940px, 100%)', height: 'min(680px, 90vh)',
          border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 18px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>Image library</strong>
            {postTitle && (
              <span style={{
                fontSize: '0.75rem', color: 'var(--text-muted)', flex: 1, minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {postTitle}
              </span>
            )}
            <button type="button" onClick={onClose} disabled={busy}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', padding: 4 }}
              aria-label="Close the image library"
            >
              ×
            </button>
          </div>

          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            {/* Clearing the selection on a tab switch: it used to survive, so Apply could
                commit an image that was no longer anywhere on screen. */}
            <button type="button" style={tabStyle(tab === 'library')} onClick={() => { setTab('library'); setSelected(null) }} aria-pressed={tab === 'library'}>
              Their library
            </button>
            <button type="button" style={tabStyle(tab === 'stock')} onClick={() => { setTab('stock'); setSelected(null) }} aria-pressed={tab === 'stock'}>
              Stock photos {stockCandidates.length > 0 ? `· ${stockCandidates.length}` : ''}
            </button>
          </div>
        </div>

        {/* Tab controls */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {tab === 'library' ? (
            connectionId ? (
              <>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <MagnifyingGlass
                    size={14} weight="bold"
                    style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }}
                  />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !loading) { e.preventDefault(); void search(1, false, query) } }}
                    placeholder="Search their media library…"
                    className="input"
                    style={{ width: '100%', fontSize: '0.8125rem', padding: '0.35rem 0.5rem 0.35rem 1.75rem' }}
                    aria-label="Search the client's media library"
                  />
                </div>
                <button type="button" className="btn btn-secondary" disabled={loading}
                  onClick={() => void search(1, false, query)} style={{ fontSize: '0.78rem' }}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {mediaError
                    ? mediaError
                    : media.length > 0
                      ? `${media.length} of ${total.toLocaleString()}`
                      : searched ? 'Nothing found' : ''}
                </span>
              </>
            ) : (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Choose a site connection under Publish to search the client&rsquo;s own images.
              </span>
            )
          ) : (
            <>
              <button type="button" className="btn btn-secondary" disabled={refreshingStock}
                onClick={onRefreshStock} style={{ fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <ArrowClockwise size={13} weight="bold" />
                {refreshingStock ? 'Searching…' : 'Search again'}
              </button>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flex: 1 }}>
                {stockNote || 'Searched on this post’s own topic — there is no free-text box because the derived query matches better.'}
              </span>
            </>
          )}
        </div>

        {/* Gallery */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {items.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>
              {tab === 'library'
                ? (loading ? 'Loading…'
                  : mediaError ? mediaError
                  : connectionId ? 'No images here yet. Try a different search.'
                  : 'No site connection chosen.')
                : 'No stock photos cleared the relevance bar for this topic. That is a normal result for specialised subjects — a confident wrong photo is worse than none.'}
            </p>
          ) : (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10,
            }}>
              {items.map(c => {
                const isSel = selected?.id === c.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    onDoubleClick={() => { setSelected(c); onPreview?.(c) }}
                    disabled={busy}
                    title={`${c.title}${c.creator ? ` — ${c.creator}` : ''} · ${c.license}`}
                    aria-pressed={isSel}
                    style={{
                      padding: 0, cursor: busy ? 'default' : 'pointer', textAlign: 'left',
                      background: 'var(--bg-base)', overflow: 'hidden', borderRadius: 8,
                      border: `2px solid ${isSel ? 'var(--blue)' : 'var(--border)'}`,
                      boxShadow: isSel ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none',
                      opacity: applyingId && applyingId !== c.id ? 0.5 : 1,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.thumbnail} alt={c.title} loading="lazy"
                      style={{ width: '100%', height: 108, objectFit: 'cover', display: 'block' }}
                    />
                    <div style={{ padding: '5px 7px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {applyingId === c.id ? 'Applying…' : (SOURCE_LABEL[c.source] ?? 'Stock')}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {tab === 'library' && media.length > 0 && media.length < total && (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button type="button" className="btn btn-secondary" disabled={loading}
                onClick={() => void search(page + 1, true, activeQuery)} style={{ fontSize: '0.78rem' }}>
                {loading ? 'Loading…' : `Load more (${(total - media.length).toLocaleString()} left)`}
              </button>
            </div>
          )}
        </div>

        {/* Footer — selection, consequence, action */}
        <div style={{
          borderTop: '1px solid var(--border)', padding: '12px 18px',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 180, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {applyError ? (
              <span style={{ color: 'var(--red)' }}>{applyError}</span>
            ) : selected ? (
              <>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selected.title || 'Untitled'}</span>
                {selected.creator ? ` · ${selected.creator}` : ''} · {selected.license}
                {currentImageUrl && (
                  <div style={{ color: 'var(--amber, #b45309)', marginTop: 2 }}>
                    Replaces the current featured image.
                  </div>
                )}
              </>
            ) : (
              'Select an image, then apply it. Double-click applies straight away.'
            )}
          </div>
          {onPreview && (
            <button
              type="button" className="btn btn-secondary"
              disabled={!selected || busy}
              onClick={() => selected && onPreview(selected)}
              style={{ fontSize: '0.8125rem' }}
              title="See it full size before applying"
            >
              Preview
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose} style={{ fontSize: '0.8125rem' }}>
            Cancel
          </button>
          <button
            type="button" className="btn btn-primary"
            disabled={!selected || busy}
            onClick={() => selected && onApply(selected)}
            style={{ fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Books size={14} weight="bold" />
            {busy ? 'Applying…' : 'Use as featured image'}
          </button>
        </div>
      </div>
    </div>
  )
}
