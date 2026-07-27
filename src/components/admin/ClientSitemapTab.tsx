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
  const [search,  setSearch]  = useState('')
  const [saving,  setSaving]  = useState<Set<string>>(new Set())

  // Sitemap config state
  const [sitemapUrls,   setSitemapUrls]   = useState<string[]>([])
  const [blogUrlPrefix, setBlogUrlPrefix] = useState('')
  const [manualLinks,   setManualLinks]   = useState<ManualLink[]>([])
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
      const d = await res.json() as Record<string, unknown>
      const urls: string[] = Array.isArray(d.sitemap_urls) && (d.sitemap_urls as string[]).length > 0
        ? d.sitemap_urls as string[]
        : (d.sitemap_url ? [String(d.sitemap_url)] : [])
      setSitemapUrls(urls)
      setBlogUrlPrefix(String(d.blog_url_prefix ?? ''))
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
          blog_url_prefix:  blogUrlPrefix.trim() || null,
          manual_link_urls: manualLinks.filter(l => l.url.trim()).map(l => JSON.stringify({ url: l.url.trim(), label: l.label.trim() })),
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

  async function loadPages() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/content/sitemap-pages?client_id=${clientId}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load')
      const data = await res.json() as SitemapPage[]
      setPages(data)
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

  const filtered = pages.filter(p =>
    !search || p.url.toLowerCase().includes(search.toLowerCase()) ||
    (p.title ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Sort: priority first, then normal, then excluded last
  const sorted = [...filtered].sort((a, b) => {
    if (a.isPriority && !b.isPriority) return -1
    if (!a.isPriority && b.isPriority) return 1
    if (a.isExcluded && !b.isExcluded) return 1
    if (!a.isExcluded && b.isExcluded) return -1
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
          <Label hint="e.g. /blog — prefix applied to blog post URLs in AI context">Blog URL Prefix</Label>
          <input
            className="input"
            type="text"
            value={blogUrlPrefix}
            onChange={e => setBlogUrlPrefix(e.target.value)}
            placeholder="/blog  (leave blank if posts live at the site root)"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            Set this if blog posts are published under a sub-path (e.g. <code>/blog</code> or <code>/articles</code>). The AI uses this to understand the site&rsquo;s URL structure when generating internal links.
          </p>
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
        <button onClick={fetchFromSitemap} disabled={fetching} className="btn btn-secondary" style={{ fontSize: '0.8125rem', flexShrink: 0 }}>
          {fetching ? 'Fetching…' : '↻ Refresh from Sitemap'}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--red)', marginBottom: 12 }}>{error}</p>
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
                <tr key={page.url} style={{
                  borderBottom: i < sorted.length - 1 ? '1px solid var(--border)' : 'none',
                  opacity: page.isExcluded ? 0.45 : 1,
                  background: page.isPriority ? 'rgba(99,102,241,0.04)' : 'transparent',
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
