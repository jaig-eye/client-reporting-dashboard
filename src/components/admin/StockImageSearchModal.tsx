'use client'

// Free stock image picker — Pexels, Openverse and Wikimedia Commons.
//
// WHY THIS OPENS WITHOUT CALLING ANYTHING
// Post generation banks a POOL of candidates on the post (up to 24). This modal browses
// that pool, so opening it, paging through it and picking from it cost nothing: no
// upstream call, no quota spent, and nothing that can fail or stall while a reviewer is
// waiting. Pexels' free tier is 200 requests/HOUR, and a backlog cron run generating 15
// posts concurrently is exactly the burst that reaches it — so the reviewer-facing path
// had to stop being a source of load.
//
// Fetching is therefore always explicit and always labelled: "Get new images" re-runs
// the post's own topic, and typing a phrase searches for that instead. When a refetch
// finds nothing new, the existing pool is kept rather than cleared — an empty grid is
// never a better outcome than the images already banked.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { StockImageCandidate } from '@/lib/content/stockImages'

interface Props {
  postId: string
  /** The pool already banked on the post. Browsed for free; never refetched on open. */
  initialCandidates: StockImageCandidate[]
  /** Seeds the search box — usually the post's target keyword. */
  initialQuery: string
  onClose:   () => void
  /** Called with the chosen candidate id; the parent applies it. Rejects on failure. */
  onSelect:  (candidateId: string) => Promise<void>
  /** Reports a refreshed pool so the parent's inline strip stays in sync. */
  onResults: (candidates: StockImageCandidate[]) => void
}

// Keyed on the normalised `source`, not `provider` — provider carries the UPSTREAM host
// Openverse aggregated from ('flickr', 'museumsvictoria', …), which surfaced raw.
const SOURCE_LABEL: Record<string, string> = {
  pexels:    'Pexels',
  wikimedia: 'Wikimedia',
  openverse: 'Openverse',
}

const PAGE_SIZE = 8

export default function StockImageSearchModal({
  postId, initialCandidates, initialQuery, onClose, onSelect, onResults,
}: Props) {
  const [query,      setQuery]      = useState('')
  const [pool,       setPool]       = useState<StockImageCandidate[]>(initialCandidates)
  const [page,       setPage]       = useState(0)
  const [loading,    setLoading]    = useState(false)
  const [message,    setMessage]    = useState('')
  // A fetch failure hides the grid only if there is nothing to show; an APPLY failure
  // must never hide it, because the reviewer needs the grid to choose something else.
  const [error,      setError]      = useState('')
  const [applyError, setApplyError] = useState('')
  const [applying,   setApplying]   = useState<string | null>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const pageCount = Math.max(1, Math.ceil(pool.length / PAGE_SIZE))
  const visible = useMemo(
    () => pool.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [pool, page],
  )

  /**
   * Advance to the next page of the SAME pool. Free — no request.
   * With one page or fewer, this deliberately shows the same images again rather than
   * disabling: "there is nothing else banked" is clearer shown than greyed out.
   */
  function showDifferent() {
    setApplyError('')
    setPage(p => (p + 1) % pageCount)
  }

  /** The only paths that spend quota. Always user-initiated, never on open. */
  const fetchImages = useCallback(async (q?: string) => {
    setLoading(true)
    setError('')
    setApplyError('')
    setMessage('')
    try {
      const endpoint = q
        ? `/api/admin/content/posts/${postId}/search-stock-images`
        : `/api/admin/content/posts/${postId}/find-stock-images`
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(q ? { body: JSON.stringify({ query: q }) } : {}),
      })
      const data = await res.json() as {
        candidates?: StockImageCandidate[]; message?: string; error?: string
      }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Could not fetch images')

      const found = data.candidates ?? []
      if (found.length > 0) {
        setPool(found)
        setPage(0)
        onResults(found)
        setMessage(data.message ?? '')
      } else {
        // Keep what we have. The server also declines to persist an empty result, so
        // clearing the grid here would show nothing while the post still holds a
        // perfectly good, selectable set.
        setMessage(
          pool.length > 0
            ? 'Nothing new matched — still showing the images already found.'
            : (data.message ?? 'No matching free images found.'),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fetch images')
    } finally {
      setLoading(false)
    }
  }, [postId, onResults, pool.length])

  useEffect(() => { inputRef.current?.focus() }, [])

  // Escape closes; Tab is trapped. aria-modal="true" tells assistive tech the background
  // is inert, so letting Tab walk out to Reject / Save Changes contradicts that — and
  // those are destructive controls to land on unannounced. Focus is restored on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const f = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  async function choose(id: string) {
    setApplying(id)
    setApplyError('')
    try {
      await onSelect(id)
      onClose()
    } catch (e) {
      // Stay OPEN. Closing regardless made a failed apply indistinguishable from a
      // success — reachable via a dead provider CDN (502), a slow download (timeout),
      // an unsupported type (415), or a stale candidate id (400).
      setApplyError(e instanceof Error ? e.message : 'Could not apply that image')
    } finally {
      setApplying(null)
    }
  }

  const btn: React.CSSProperties = { fontSize: '0.8rem' }

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Choose a free stock image"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        ref={dialogRef}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)', borderRadius: 10,
          width: 'min(900px, 100%)', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: '0.95rem' }}>Free stock images</strong>
            <button type="button" onClick={onClose} className="btn btn-secondary" style={btn}>Close</button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button" onClick={showDifferent}
              disabled={loading || pool.length === 0}
              className="btn btn-secondary" style={btn}
              title={pageCount > 1
                ? `Show the next ${PAGE_SIZE} of ${pool.length} already found`
                : 'No other images are banked for this post'}
            >
              ⟳ Show different
            </button>
            <button
              type="button" onClick={() => void fetchImages()}
              disabled={loading} className="btn btn-secondary" style={btn}
              title="Search the libraries again for this post's topic"
            >
              {loading ? 'Fetching…' : 'Get new images'}
            </button>
          </div>

          <form
            onSubmit={e => { e.preventDefault(); if (query.trim().length >= 3) void fetchImages(query.trim()) }}
            style={{ display: 'flex', gap: 8, marginTop: 10 }}
          >
            <input
              ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Or search something else — e.g. workshop bench"
              maxLength={120}
              style={{
                flex: 1, padding: '7px 10px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--bg-base)',
                color: 'var(--text-primary)', fontSize: '0.85rem',
              }}
            />
            <button
              type="submit" disabled={loading || query.trim().length < 3}
              className="btn btn-primary" style={{ ...btn, minWidth: 88 }}
            >
              Search
            </button>
          </form>

          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>
            {pool.length > 0
              ? `${pool.length} image${pool.length === 1 ? '' : 's'} found for this post · showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, pool.length)}. All free for commercial use.`
              : 'Nothing banked for this post yet — use “Get new images” or search.'}
          </div>
        </div>

        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {applyError && (
            <div style={{
              color: 'var(--red)', fontSize: '0.78rem', marginBottom: 10,
              padding: '8px 10px', borderRadius: 6,
              border: '1px solid var(--red)', background: 'rgba(220,38,38,0.06)',
            }}>
              {applyError} — pick another image or close and try again.
            </div>
          )}

          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0', color: 'var(--text-muted)' }}>
              <div
                aria-hidden className="stock-spinner"
                style={{
                  width: 30, height: 30, borderRadius: '50%',
                  border: '3px solid var(--border)', borderTopColor: 'var(--text-secondary)',
                }}
              />
              <div role="status" aria-live="polite" style={{ fontSize: '0.8rem' }}>
                Searching three libraries…
              </div>
              {/* Scoped to the spinner's own class — an earlier version disabled
                  animation on every [aria-hidden] element on the page. */}
              <style>{`
                @keyframes stockspin { to { transform: rotate(360deg) } }
                .stock-spinner { animation: stockspin 0.7s linear infinite }
                @media (prefers-reduced-motion: reduce) { .stock-spinner { animation: none } }
              `}</style>
            </div>
          )}

          {!loading && error && (
            <div style={{ color: 'var(--red)', fontSize: '0.82rem', padding: '16px 0', textAlign: 'center' }}>
              {error}
            </div>
          )}

          {!loading && message && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 10 }}>{message}</div>
          )}

          {!loading && visible.length === 0 && !error && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '36px 0', textAlign: 'center' }}>
              No images to show yet.
            </div>
          )}

          {!loading && visible.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
              {visible.map(c => {
                const busy = applying === c.id
                return (
                  <button
                    key={c.id} type="button" disabled={!!applying}
                    onClick={() => void choose(c.id)}
                    title={`${c.title}${c.creator ? ` — ${c.creator}` : ''}`}
                    style={{
                      padding: 0, border: '1px solid var(--border)', borderRadius: 8,
                      overflow: 'hidden', background: 'var(--bg-subtle)', textAlign: 'left',
                      cursor: applying ? 'default' : 'pointer', opacity: busy ? 0.55 : 1,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.thumbnail} alt={c.title} loading="lazy"
                      style={{ width: '100%', height: 108, objectFit: 'cover', display: 'block' }}
                    />
                    <div style={{ padding: '6px 8px', fontSize: '0.68rem', lineHeight: 1.35 }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
                        {busy ? 'Applying…' : c.title}
                      </div>
                      <div style={{ color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                        <span>{SOURCE_LABEL[c.source] ?? 'Stock'}</span>
                        <span>{c.width && c.height ? `${c.width}×${c.height}` : ''}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
