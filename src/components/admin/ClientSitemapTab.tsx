'use client'

import { useState, useEffect } from 'react'
import { Star, MinusCircle, MapPin } from '@phosphor-icons/react'

type SitemapPage = {
  url:           string
  title:         string | null
  isPriority:    boolean
  isExcluded:    boolean
  isServicePage: boolean
}

type ManualLink = { url: string; label: string }

// Heuristic: does this URL look like a blog/news/article post (vs. a money page)?
const BLOG_PATH_RE = /\/(blog|blogs|news|article|articles|post|posts)(\/|$)/i
function isBlogUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    if (BLOG_PATH_RE.test(path)) return true
    if (/\/(19|20)\d{2}\/\d{1,2}\//.test(path)) return true  // dated permalinks e.g. /2024/05/
    return false
  } catch {
    return BLOG_PATH_RE.test(url.toLowerCase())
  }
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
      {children}
      {hint && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — {hint}</span>}
    </label>
  )
}

export default function ClientSitemapTab({ clientId }: { clientId: string }) {
  const [pages,   setPages]   = useState<SitemapPage[]>([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error,   setError]   = useState('')
  const [notes,   setNotes]   = useState<string | null>(null)
  const [search,  setSearch]  = useState('')
  const [saving,  setSaving]  = useState<Set<string>>(new Set())
  const [hoveredUrl, setHoveredUrl] = useState<string | null>(null)
  // url → display index, captured at load. See snapshotOrder / the render sort.
  const [displayOrder, setDisplayOrder] = useState<Map<string, number>>(new Map())
  const [bulkBusy, setBulkBusy] = useState(false)

  // Sitemap config state
  const [sitemapUrls,   setSitemapUrls]   = useState<string[]>([])
  const [manualLinks,   setManualLinks]   = useState<ManualLink[]>([])
  const [excludeProducts, setExcludeProducts] = useState(false)
  const [configSaving,  setConfigSaving]  = useState(false)
  const [configSaved,   setConfigSaved]   = useState(false)
  const [configError,   setConfigError]   = useState('')

  useEffect(() => {
    loadPages()
    loadConfig()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function loadConfig() {
    try {
      const res = await fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      if (!res.ok) return
      const d = await res.json() as Record<string, unknown>
      const urls: string[] = Array.isArray(d.sitemap_urls) && (d.sitemap_urls as string[]).length > 0
        ? d.sitemap_urls as string[]
        : (d.sitemap_url ? [String(d.sitemap_url)] : [])
      setSitemapUrls(urls)
      setExcludeProducts(d.exclude_product_sitemaps === true)
      const links: ManualLink[] = ((d.manual_link_urls ?? []) as string[]).map(s => {
        try { const p = JSON.parse(s); if (p?.url) return { url: String(p.url), label: String(p.label ?? '') } } catch { /* skip */ }
        if (typeof s === 'string' && s.startsWith('http')) return { url: s, label: '' }
        return null
      }).filter(Boolean) as ManualLink[]
      setManualLinks(links)
    } catch { /* non-fatal */ }
  }

  async function saveConfig() {
    setConfigSaving(true); setConfigError(''); setConfigSaved(false)
    try {
      const res = await fetch('/api/admin/content/client-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:        clientId,
          sitemap_urls:     sitemapUrls.filter(u => u.trim()),
          manual_link_urls: manualLinks.filter(l => l.url.trim()).map(l => JSON.stringify({ url: l.url.trim(), label: l.label.trim() })),
          exclude_product_sitemaps: excludeProducts,
        }),
      })
      if (!res.ok) { const d = await res.json(); setConfigError(d.error || 'Failed to save'); return }
      setConfigSaved(true); setTimeout(() => setConfigSaved(false), 2500)
    } catch { setConfigError('Failed to save') } finally { setConfigSaving(false) }
  }

  function addSitemap()                                        { setSitemapUrls(p => [...p, '']) }
  function updateSitemap(i: number, val: string)               { setSitemapUrls(p => p.map((u, idx) => idx === i ? val : u)) }
  function removeSitemap(i: number)                            { setSitemapUrls(p => p.filter((_, idx) => idx !== i)) }
  function addManualLink()                                     { setManualLinks(p => [...p, { url: '', label: '' }]) }
  function updateManualLink(i: number, f: 'url' | 'label', v: string) {
    setManualLinks(p => p.map((l, idx) => idx === i ? { ...l, [f]: v } : l))
  }
  function removeManualLink(i: number)                         { setManualLinks(p => p.filter((_, idx) => idx !== i)) }

  /**
   * Capture the grouped display order (priority → normal → excluded, then A-Z) ONCE
   * per load. The render sorts by this snapshot instead of by the live flags, so
   * toggling a flag restyles the row in place rather than relocating it.
   */
  function snapshotOrder(data: SitemapPage[]) {
    const ordered = [...data].sort((a, b) => {
      if (a.isPriority && !b.isPriority) return -1
      if (!a.isPriority && b.isPriority) return 1
      if (a.isExcluded && !b.isExcluded) return 1
      if (!a.isExcluded && b.isExcluded) return -1
      return a.url.localeCompare(b.url)
    })
    setDisplayOrder(new Map(ordered.map((p, i) => [p.url, i])))
  }

  async function loadPages() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/content/sitemap-pages?client_id=${clientId}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load')
      const data = await res.json() as SitemapPage[]
      setPages(data)
      snapshotOrder(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pages')
    } finally {
      setLoading(false)
    }
  }

  async function fetchFromSitemap() {
    setFetching(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/content/sitemap-parse?client_id=${clientId}`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      const data = await res.json() as SitemapPage[]
      setPages(data)
      snapshotOrder(data)
      // A parse can succeed and still have done something the operator should
      // know about — product sitemaps skipped, stale rows pruned, or a degraded
      // save because migration 183 is missing. These were logged server-side and
      // never shown.
      setNotes(res.headers.get('X-Sitemap-Notes'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sitemap')
    } finally {
      setFetching(false)
    }
  }

  async function toggleFlag(url: string, field: 'is_priority' | 'is_excluded' | 'is_service_page', currentVal: boolean) {
    setSaving(prev => new Set(prev).add(url))

    // Optimistic update
    setPages(prev => prev.map(p => {
      if (p.url !== url) return p
      if (field === 'is_priority') return { ...p, isPriority: !currentVal, isExcluded: !currentVal ? false : p.isExcluded }
      if (field === 'is_service_page') return { ...p, isServicePage: !currentVal }
      return { ...p, isExcluded: !currentVal, isPriority: !currentVal ? false : p.isPriority }
    }))

    try {
      const body: Record<string, unknown> = { client_id: clientId, url }
      if (field === 'is_priority') {
        body.is_priority = !currentVal
        if (!currentVal) body.is_excluded = false
      } else if (field === 'is_service_page') {
        body.is_service_page = !currentVal
      } else {
        body.is_excluded = !currentVal
        if (!currentVal) body.is_priority = false
      }

      const res = await fetch('/api/admin/content/sitemap-pages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      loadPages() // revert on error
    } finally {
      setSaving(prev => { const n = new Set(prev); n.delete(url); return n })
    }
  }

  // Bulk-exclude every detected blog/post URL that isn't already excluded.
  const blogCandidates = pages.filter(p => !p.isExcluded && isBlogUrl(p.url))
  async function bulkExcludeBlogs() {
    if (blogCandidates.length === 0) return
    const urls = blogCandidates.map(p => p.url)
    setBulkBusy(true); setError('')
    // Optimistic
    setPages(prev => prev.map(p => urls.includes(p.url) ? { ...p, isExcluded: true, isPriority: false } : p))
    try {
      const res = await fetch('/api/admin/content/sitemap-pages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Clear is_priority too (priority + excluded are mutually exclusive), matching
        // the optimistic update and the single-toggle path.
        body: JSON.stringify({ client_id: clientId, urls, is_excluded: true, is_priority: false }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to exclude')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to exclude blogs')
      loadPages()  // revert on error
    } finally {
      setBulkBusy(false)
    }
  }

  const filtered = pages.filter(p =>
    !search || p.url.toLowerCase().includes(search.toLowerCase()) ||
    (p.title ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Sort by the order captured at load time, NOT by the live flags.
  //
  // Sorting on isPriority/isExcluded directly meant every star/exclude click
  // re-ordered the list underneath the cursor: the row you just clicked jumped to
  // the top or the bottom, everything below it shifted up, and the viewport
  // appeared to leap. Freezing the order until the next load keeps the row exactly
  // where it is — the icon and styling still update instantly, so the click is
  // clearly acknowledged without moving anything. The new grouping is applied the
  // next time the list is loaded or re-fetched.
  const sorted = [...filtered].sort((a, b) => {
    const ai = displayOrder.get(a.url)
    const bi = displayOrder.get(b.url)
    if (ai !== undefined && bi !== undefined) return ai - bi
    if (ai !== undefined) return -1          // known rows before newly-appeared ones
    if (bi !== undefined) return 1
    return a.url.localeCompare(b.url)
  })

  const priorityCount    = pages.filter(p => p.isPriority).length
  const excludedCount    = pages.filter(p => p.isExcluded).length
  const servicePageCount = pages.filter(p => p.isServicePage).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Sitemaps & Internal Links ─────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 className="section-title" style={{ marginBottom: 2 }}>Sitemaps &amp; Internal Links</h3>
            <p className="section-desc" style={{ margin: 0 }}>Sitemaps give the AI page context for internal linking. Always-include links are injected into every generated post.</p>
          </div>
          <button
            type="button"
            onClick={saveConfig}
            disabled={configSaving}
            className="btn btn-primary"
            style={{ fontSize: '0.8125rem', padding: '0.375rem 0.875rem', flexShrink: 0 }}
          >
            {configSaving ? 'Saving…' : configSaved ? 'Saved ✓' : 'Save'}
          </button>
        </div>

        {configError && <p style={{ fontSize: '0.8125rem', color: 'var(--red)', margin: 0 }}>{configError}</p>}

        {/* Ecommerce escape hatch. Off by default because on a store the product
            page is usually the most valuable thing an article can link to — the
            round-robin quota in the parser is what handles catalogue scale, so
            this is only for clients whose SKUs are not useful link targets. */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={excludeProducts}
            onChange={e => setExcludeProducts(e.target.checked)}
            style={{ width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
          />
          <span>
            <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
              Skip individual product pages
            </span>
            <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
              {excludeProducts
                ? 'Product sitemaps are ignored. Category and collection sitemaps are still included — those are strong link targets.'
                : 'Products are included. Every sub-sitemap gets a fair share of the 500-page cache, so a large catalogue cannot crowd out your service pages and articles. Turn this on only if individual products are not worth linking to.'}
            </span>
          </span>
        </label>

        <div>
          <Label hint="for internal link suggestions">Sitemap URLs</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {sitemapUrls.map((url, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input className="input" type="url" style={{ flex: 1 }} value={url} onChange={e => updateSitemap(i, e.target.value)} placeholder="https://example.com/sitemap.xml" />
                <button type="button" onClick={() => removeSitemap(i)} style={{ flexShrink: 0, fontSize: '0.75rem', color: 'var(--text-faint)', padding: '0.25rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button type="button" onClick={addSitemap} className="btn btn-secondary" style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}>+ Add Sitemap</button>
          </div>
        </div>

        <div>
          <Label hint="included as internal links in every generated post">Always-Include Links</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {manualLinks.map((link, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input className="input" type="url" style={{ flex: 2 }} value={link.url} onChange={e => updateManualLink(i, 'url', e.target.value)} placeholder="https://example.com/services" />
                <input className="input" style={{ flex: 1 }} value={link.label} onChange={e => updateManualLink(i, 'label', e.target.value)} placeholder="Label" />
                <button type="button" onClick={() => removeManualLink(i)} style={{ flexShrink: 0, fontSize: '0.75rem', color: 'var(--text-faint)', padding: '0.25rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button type="button" onClick={addManualLink} className="btn btn-secondary" style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}>+ Add Link</button>
          </div>
        </div>
      </div>

      {/* ── Sitemap Pages ───────────────────────────────────────────────────── */}
      <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Sitemap Pages
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Star pages to prioritize for internal linking. Minus-circle to exclude from AI context entirely.
            {pages.length > 0 && (
              <span> — {pages.length} pages · {priorityCount} starred · {excludedCount} excluded · {servicePageCount} service pages</span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {blogCandidates.length > 0 && (
            <button
              onClick={bulkExcludeBlogs}
              disabled={bulkBusy}
              className="btn btn-secondary"
              style={{ fontSize: '0.8125rem' }}
              title="Exclude all detected blog/news/article URLs from AI linking context"
            >
              {bulkBusy ? 'Excluding…' : `Exclude ${blogCandidates.length} blog${blogCandidates.length !== 1 ? 's' : ''}`}
            </button>
          )}
          <button onClick={fetchFromSitemap} disabled={fetching} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
            {fetching ? 'Fetching…' : '↻ Refresh from Sitemap'}
          </button>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--red)', marginBottom: 12 }}>{error}</p>
      )}

      {notes && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12 }}>{notes}</p>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <Star size={13} weight="fill" color="#6366f1" />
          Priority — preferred for internal links
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <MinusCircle size={13} weight="fill" color="#9ca3af" />
          Excluded — AI will not link to these
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <MapPin size={13} weight="fill" color="#059669" />
          Service Page — used as parent for service area sub-pages
        </div>
      </div>

      {/* Search */}
      {pages.length > 0 && (
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search pages…"
          className="input"
          style={{ marginBottom: 12, maxWidth: 400, fontSize: '0.8125rem', padding: '0.375rem 0.625rem' }}
        />
      )}

      {loading ? (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading…</p>
      ) : sorted.length === 0 ? (
        <div className="card p-6" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
            {pages.length === 0
              ? 'No pages yet. Click "Refresh from Sitemap" to load pages from this client\'s configured sitemaps.'
              : 'No pages match your search.'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Page</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 200 }}>Title</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 60 }}>Priority</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 60 }}>Exclude</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 70 }}>Svc Page</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((page, i) => (
                <tr key={page.url}
                  onMouseEnter={() => setHoveredUrl(page.url)}
                  onMouseLeave={() => setHoveredUrl(null)}
                  style={{
                    borderBottom: i < sorted.length - 1 ? '1px solid var(--border)' : 'none',
                    opacity: page.isExcluded ? 0.45 : 1,
                    background: hoveredUrl === page.url
                      ? 'var(--bg-subtle)'
                      : page.isPriority ? 'rgba(99,102,241,0.04)' : 'transparent',
                    transition: 'background 0.1s',
                  }}>
                  <td style={{ padding: '7px 10px', color: 'var(--text-primary)', maxWidth: 0 }}>
                    <a href={page.url} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--blue)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {page.url}
                    </a>
                  </td>
                  <td style={{ padding: '7px 10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                    {page.title ?? '—'}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                    <button
                      onClick={() => toggleFlag(page.url, 'is_priority', page.isPriority)}
                      disabled={saving.has(page.url)}
                      title={page.isPriority ? 'Remove priority' : 'Mark as priority'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, lineHeight: 1 }}
                    >
                      <Star
                        size={16}
                        weight={page.isPriority ? 'fill' : 'regular'}
                        color={page.isPriority ? '#6366f1' : '#d1d5db'}
                      />
                    </button>
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                    <button
                      onClick={() => toggleFlag(page.url, 'is_excluded', page.isExcluded)}
                      disabled={saving.has(page.url)}
                      title={page.isExcluded ? 'Remove exclusion' : 'Exclude from AI'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, lineHeight: 1 }}
                    >
                      <MinusCircle
                        size={16}
                        weight={page.isExcluded ? 'fill' : 'regular'}
                        color={page.isExcluded ? '#9ca3af' : '#d1d5db'}
                      />
                    </button>
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                    <button
                      onClick={() => toggleFlag(page.url, 'is_service_page', page.isServicePage)}
                      disabled={saving.has(page.url)}
                      title={page.isServicePage ? 'Remove service page flag' : 'Mark as service category page'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, lineHeight: 1 }}
                    >
                      <MapPin
                        size={16}
                        weight={page.isServicePage ? 'fill' : 'regular'}
                        color={page.isServicePage ? '#059669' : '#d1d5db'}
                      />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  )
}
