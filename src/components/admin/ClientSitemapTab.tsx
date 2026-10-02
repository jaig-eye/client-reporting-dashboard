'use client'

import { useState, useEffect } from 'react'
import '@/styles/admin/pipeline.css'
import SitemapPaste from '@/components/admin/SitemapPaste'
import { Star, MinusCircle, MapPin, GearSix, Plus, X, ArrowClockwise, CheckCircle, TreeStructure } from '@phosphor-icons/react'
import Section from '@/components/ui/Section'
import Field from '@/components/ui/Field'
import { SwitchRow } from '@/components/ui/Switch'
import EmptyState from '@/components/ui/EmptyState'
import { Sk } from '@/components/ui/Skeleton'

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

/** A page's on/off flag (priority, excluded, service page): a real toggle button that says what it is
 *  and whether it is on, with the icon filled when it is. */
function Flag({ on, label, onLabel, disabled, onClick, icon }: {
  on: boolean; label: string; onLabel: string; disabled: boolean; onClick: () => void; icon: (on: boolean) => React.ReactNode
}) {
  return (
    <button type="button" className={`sm-flag${on ? ' sm-flag--on' : ''}`} aria-pressed={on} aria-label={on ? onLabel : label} title={on ? onLabel : label} disabled={disabled} onClick={onClick}>
      {icon(on)}
    </button>
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
  // url → display index, captured at load. See snapshotOrder / the render sort.
  const [displayOrder, setDisplayOrder] = useState<Map<string, number>>(new Map())
  const [bulkBusy, setBulkBusy] = useState(false)

  // Sitemap config state
  const [sitemapUrls,   setSitemapUrls]   = useState<string[]>([])
  const [manualLinks,   setManualLinks]   = useState<ManualLink[]>([])
  const [excludeProducts, setExcludeProducts] = useState(false)
  // Configuration is set once and then sits above the page list forever. Folded by default.
  const [configOpen,    setConfigOpen]    = useState(false)
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

  const sitemapCount = sitemapUrls.filter(Boolean).length

  return (
    <div className="ui-stack" style={{ gap: 20 }}>

      {/* Every sub-tab names itself in the same shape: title, then one line. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>Sitemap</h3>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          The pages the writer can link to.
        </p>
      </div>

      {/* ── Sitemaps & Internal Links ─────────────────────────────────────── */}
      <Section
        title="Sitemaps and fixed links"
        // Folded away, the state still has to be readable — otherwise the gear hides whether
        // anything is set at all.
        description={<>
          {sitemapCount} sitemap{sitemapCount === 1 ? '' : 's'}, {manualLinks.length} link{manualLinks.length === 1 ? '' : 's'} in every post
          {excludeProducts ? ', product pages skipped' : ''}.
        </>}
        actions={
          <button
            type="button"
            onClick={() => setConfigOpen(v => !v)}
            aria-expanded={configOpen}
            className="btn btn-secondary btn-sm"
          >
            <GearSix size={15} aria-hidden />
            {configOpen ? 'Hide' : 'Change'}
          </button>
        }
      >
        {configOpen && (
          <div className="ui-fields">
            {configError && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{configError}</div>}

            <Field label="Sitemaps" hint="Where the list of pages below comes from.">
              <div className="sm-list">
                {sitemapUrls.map((url, i) => (
                  <div key={i} className="sm-list-row">
                    <input className="input" type="url" value={url} onChange={e => updateSitemap(i, e.target.value)} placeholder="https://example.com/sitemap.xml" aria-label={`Sitemap ${i + 1}`} />
                    <button type="button" className="ui-x" onClick={() => removeSitemap(i)} aria-label={`Remove sitemap ${i + 1}`}><X size={14} weight="bold" aria-hidden /></button>
                  </div>
                ))}
                <button type="button" onClick={addSitemap} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}><Plus size={13} weight="bold" aria-hidden />Add a sitemap</button>
              </div>
            </Field>

            <Field label="Links in every post" hint="Added as internal links to every post written for this client.">
              <div className="sm-list">
                {manualLinks.map((link, i) => (
                  <div key={i} className="sm-list-row">
                    <input className="input" type="url" style={{ flex: 2 }} value={link.url} onChange={e => updateManualLink(i, 'url', e.target.value)} placeholder="https://example.com/services" aria-label={`Link ${i + 1} address`} />
                    <input className="input" style={{ flex: 1 }} value={link.label} onChange={e => updateManualLink(i, 'label', e.target.value)} placeholder="Link text" aria-label={`Link ${i + 1} text`} />
                    <button type="button" className="ui-x" onClick={() => removeManualLink(i)} aria-label={`Remove link ${i + 1}`}><X size={14} weight="bold" aria-hidden /></button>
                  </div>
                ))}
                <button type="button" onClick={addManualLink} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}><Plus size={13} weight="bold" aria-hidden />Add a link</button>
              </div>
            </Field>

            {/* Ecommerce escape hatch. Off by default because on a store the product
                page is usually the most valuable thing an article can link to — the
                round-robin quota in the parser is what handles catalogue scale, so
                this is only for clients whose SKUs are not useful link targets. */}
            <div>
              <SwitchRow
                title="Skip individual product pages"
                description={excludeProducts
                  ? 'Product sitemaps are ignored. Category and collection sitemaps still count; those are strong link targets.'
                  : 'Products are included. Every sitemap gets a fair share of the 500-page cache, so a big catalogue can’t crowd out service pages and articles. Turn this on only if single products aren’t worth linking to.'}
                checked={excludeProducts}
                onChange={setExcludeProducts}
              />
            </div>

            <div className="ui-saverow">
              <button type="button" onClick={saveConfig} disabled={configSaving} className="btn btn-primary">
                {configSaving ? 'Saving…' : 'Save'}
              </button>
              {configSaved && <span className="ui-saved" role="status"><CheckCircle size={16} weight="fill" aria-hidden />Saved</span>}
            </div>
          </div>
        )}
      </Section>

      {/* ── Sitemap Pages ───────────────────────────────────────────────────── */}
      <Section
        title="Pages"
        description={<>
          Star the pages posts should link to most; exclude the ones they never should.
          {pages.length > 0 && <> {pages.length} pages: {priorityCount} starred, {excludedCount} excluded, {servicePageCount} service pages.</>}
        </>}
        actions={<>
          {blogCandidates.length > 0 && (
            <button
              type="button"
              onClick={bulkExcludeBlogs}
              disabled={bulkBusy}
              className="btn btn-secondary btn-sm"
              title="Exclude every page that looks like a blog post, news item or article"
            >
              {bulkBusy ? 'Excluding…' : `Exclude ${blogCandidates.length} blog post${blogCandidates.length !== 1 ? 's' : ''}`}
            </button>
          )}
          <button type="button" onClick={fetchFromSitemap} disabled={fetching} className="btn btn-secondary btn-sm">
            <ArrowClockwise size={14} aria-hidden />{fetching ? 'Reading the sitemap…' : 'Refresh from sitemap'}
          </button>
        </>}
        flush={sorted.length > 0 && !loading}
      >
        <div className="sm-tools">
          {error && <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>{error}</div>}

          <SitemapPaste
            clientId={clientId}
            onImported={(list, n) => {
              const data = list as SitemapPage[]
              setPages(data)
              snapshotOrder(data)
              setNotes(n)
              setError('')
            }}
          />

          {notes && <p className="ui-field-hint" style={{ margin: 0 }}>{notes}</p>}

          <div className="sm-legend" aria-label="Key">
            <span><Star size={13} weight="fill" className="sm-on" aria-hidden />Starred: posts link to these first</span>
            <span><MinusCircle size={13} weight="fill" className="sm-muted" aria-hidden />Excluded: posts never link to these</span>
            <span><MapPin size={13} weight="fill" className="sm-on" aria-hidden />Service page: parent for service area pages</span>
          </div>

          {pages.length > 0 && (
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search pages"
              aria-label="Search pages"
              className="input"
              style={{ maxWidth: 360 }}
            />
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '6px 20px 16px' }} aria-busy="true" aria-label="Loading pages">
            {[0, 1, 2, 3, 4].map(i => <span key={i} style={{ display: 'flex', gap: 16, alignItems: 'center' }}><Sk w={`${48 - i * 5}%`} h={12} /><Sk w="22%" h={11} /><Sk w={16} h={16} r={4} style={{ marginLeft: 'auto' }} /><Sk w={16} h={16} r={4} /><Sk w={16} h={16} r={4} /></span>)}
          </div>
        ) : sorted.length === 0 ? (
          pages.length === 0 ? (
            <EmptyState icon={<TreeStructure size={22} weight="duotone" />} title="No pages yet">
              Refresh from sitemap reads this client’s sitemaps. If their site blocks it, paste the sitemap instead.
            </EmptyState>
          ) : (
            <p className="ui-field-hint" style={{ margin: 0, padding: '4px 0 8px' }}>No pages match “{search}”.</p>
          )
        ) : (
          <div className="ui-scroll-x">
            <table className="ui-table sm-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th className="ui-hide-sm">Title</th>
                  <th className="sm-flag-col">Star</th>
                  <th className="sm-flag-col">Exclude</th>
                  <th className="sm-flag-col">Service</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(page => (
                  <tr key={page.url} className={`${page.isExcluded ? 'sm-row--excluded' : ''}${page.isPriority ? ' sm-row--starred' : ''}`}>
                    <td className="sm-url-cell">
                      <a href={page.url} target="_blank" rel="noopener noreferrer" title={page.url}>{page.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</a>
                      <div className="sm-title-sm ui-only-sm">{page.title ?? ''}</div>
                    </td>
                    <td className="sm-title-cell ui-hide-sm" title={page.title ?? undefined}>{page.title ?? '–'}</td>
                    <td className="sm-flag-col">
                      <Flag on={page.isPriority} label="Star this page" onLabel="Starred: unstar" disabled={saving.has(page.url)}
                        onClick={() => toggleFlag(page.url, 'is_priority', page.isPriority)}
                        icon={on => <Star size={16} weight={on ? 'fill' : 'regular'} />} />
                    </td>
                    <td className="sm-flag-col">
                      <Flag on={page.isExcluded} label="Exclude this page" onLabel="Excluded: include again" disabled={saving.has(page.url)}
                        onClick={() => toggleFlag(page.url, 'is_excluded', page.isExcluded)}
                        icon={on => <MinusCircle size={16} weight={on ? 'fill' : 'regular'} />} />
                    </td>
                    <td className="sm-flag-col">
                      <Flag on={page.isServicePage} label="Mark as a service page" onLabel="Service page: unmark" disabled={saving.has(page.url)}
                        onClick={() => toggleFlag(page.url, 'is_service_page', page.isServicePage)}
                        icon={on => <MapPin size={16} weight={on ? 'fill' : 'regular'} />} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
