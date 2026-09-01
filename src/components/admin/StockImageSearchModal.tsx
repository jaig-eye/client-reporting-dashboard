'use client'

// Free-text stock image search across Pexels, Openverse and Wikimedia Commons.
//
// Opened from the featured-image section of the review drawer. The automatic candidates
// are derived from the post's own keyword, which is often not what a person would search
// for — this lets them look for "workshop bench" instead of
// "powder coating oven ventilation requirements".
//
// Selecting an image is handled by the parent, which already owns the apply-and-swap
// logic used by the inline strip; this component only searches and reports the choice.

import { useState, useEffect, useRef, useCallback } from 'react'
import type { StockImageCandidate } from '@/lib/content/stockImages'

interface Props {
  postId:       string
  /** Seeds the input on open — usually the post's target keyword. */
  initialQuery: string
  onClose:      () => void
  /** Called with the chosen candidate id; the parent applies it. */
  onSelect:     (candidateId: string) => Promise<void>
  /** Lets the parent keep its inline strip in sync with what was searched. */
  onResults:    (candidates: StockImageCandidate[]) => void
}

const SOURCE_LABEL: Record<string, string> = {
  pexels:    'Pexels',
  wikimedia: 'Wikimedia',
}

export default function StockImageSearchModal({
  postId, initialQuery, onClose, onSelect, onResults,
}: Props) {
  const [query,    setQuery]    = useState(initialQuery)
  const [results,  setResults]  = useState<StockImageCandidate[]>([])
  const [loading,  setLoading]  = useState(false)
  const [message,  setMessage]  = useState('')
  const [error,    setError]    = useState('')
  const [applying, setApplying] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setError('Enter at least 3 characters')
      return
    }
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/search-stock-images`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: q.trim() }),
      })
      const data = await res.json() as { candidates?: StockImageCandidate[]; message?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Search failed')
      const found = data.candidates ?? []
      setResults(found)
      setMessage(data.message ?? '')
      // The search replaces what is stored on the post, so the parent's inline strip
      // must be told or it would keep rendering the previous, now-unselectable set.
      onResults(found)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [postId, onResults])

  // Run the seeded query immediately — opening the modal to an empty grid wastes a step
  // when the post's keyword is usually the right first search.
  useEffect(() => {
    inputRef.current?.focus()
    if (initialQuery.trim().length >= 3) void search(initialQuery)
    // Intentionally once on mount; re-running on every `search` identity change would
    // re-query on each keystroke-driven re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes. Registered on document because the overlay is not focusable itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function choose(id: string) {
    setApplying(id)
    try {
      await onSelect(id)
      onClose()
    } finally {
      setApplying(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search free stock images"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)', borderRadius: 10,
          width: 'min(900px, 100%)', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header + search */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: '0.95rem' }}>Search free images</strong>
            <button type="button" onClick={onClose} className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
              Close
            </button>
          </div>

          <form
            onSubmit={e => { e.preventDefault(); void search(query) }}
            style={{ display: 'flex', gap: 8 }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. workshop bench, metal grinding, sprinkler head"
              maxLength={120}
              style={{
                flex: 1, padding: '7px 10px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--bg-base)',
                color: 'var(--text-primary)', fontSize: '0.85rem',
              }}
            />
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ fontSize: '0.8rem', minWidth: 92 }}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>

          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>
            Searches Pexels, Openverse and Wikimedia Commons. All results are free for commercial use.
          </div>
        </div>

        {/* Results */}
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0', color: 'var(--text-muted)' }}>
              <div
                aria-hidden
                style={{
                  width: 30, height: 30, borderRadius: '50%',
                  border: '3px solid var(--border)', borderTopColor: 'var(--text-secondary)',
                  animation: 'stockspin 0.7s linear infinite',
                }}
              />
              <div style={{ fontSize: '0.8rem' }}>Searching three libraries…</div>
              {/* Scoped keyframes — the app has no global animation utility. Honours
                  reduced-motion by falling back to a static ring. */}
              <style>{`
                @keyframes stockspin { to { transform: rotate(360deg) } }
                @media (prefers-reduced-motion: reduce) {
                  [aria-hidden] { animation: none !important }
                }
              `}</style>
            </div>
          )}

          {!loading && error && (
            <div style={{ color: 'var(--red)', fontSize: '0.82rem', padding: '20px 0', textAlign: 'center' }}>
              {error}
            </div>
          )}

          {!loading && !error && searched && results.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '36px 0', textAlign: 'center' }}>
              {message || 'No results.'}
            </div>
          )}

          {!loading && results.length > 0 && (
            <>
              {message && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 10 }}>{message}</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                {results.map(c => {
                  const busy = applying === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={!!applying}
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
                        src={c.thumbnail}
                        alt={c.title}
                        loading="lazy"
                        style={{ width: '100%', height: 108, objectFit: 'cover', display: 'block' }}
                      />
                      <div style={{ padding: '6px 8px', fontSize: '0.68rem', lineHeight: 1.35 }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
                          {busy ? 'Applying…' : c.title}
                        </div>
                        <div style={{ color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                          <span>{SOURCE_LABEL[c.provider ?? ''] ?? c.provider ?? 'stock'}</span>
                          <span>{c.width && c.height ? `${c.width}×${c.height}` : ''}</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
