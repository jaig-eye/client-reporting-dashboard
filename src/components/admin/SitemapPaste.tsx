'use client'

// A quiet way in for a site that blocks our servers: paste its sitemap instead of fetching it.
// Used by the Sitemap tab and the setup wizard. The parse route adds pasted pages to the cache
// without pruning anything, so a paste of one part of a site is safe.

import { useState } from 'react'

export interface PastedPage { url: string; title: string | null; isPriority: boolean; isExcluded: boolean }

export default function SitemapPaste({ clientId, onImported }: {
  clientId: string
  /** The client's full page list after the import, and any notes from the parser. */
  onImported: (pages: PastedPage[], notes: string | null) => void
}) {
  const [open, setOpen]       = useState(false)
  const [text, setText]       = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  if (!open) {
    return (
      <button type="button" className="smp-link" onClick={() => setOpen(true)}>
        Site blocking the fetch? Paste the sitemap instead
      </button>
    )
  }

  async function importPaste() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/content/sitemap-parse?client_id=${clientId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ xml: text }),
      })
      const data = await res.json().catch(() => ({ error: 'The import failed.' }))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'The import failed.')
      onImported(data as PastedPage[], res.headers.get('X-Sitemap-Notes'))
      setText('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="smp">
      <label className="smp-label" htmlFor={`smp-${clientId}`}>
        Open the sitemap in your browser, select everything and copy it (view the page source for the raw XML), then paste it here.
        A list of page URLs, one per line, works too. Pages are added to the ones already imported.
      </label>
      <textarea
        id={`smp-${clientId}`}
        className="input smp-text"
        rows={6}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={'<urlset>…<loc>https://example.com/page</loc>…</urlset>'}
        spellCheck={false}
      />
      {error && <p className="smp-error" role="alert">{error}</p>}
      <div className="smp-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={importPaste} disabled={busy || !text.trim()}>
          {busy ? 'Importing…' : 'Import pages'}
        </button>
        <button type="button" className="smp-link" onClick={() => { setOpen(false); setError('') }} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}
