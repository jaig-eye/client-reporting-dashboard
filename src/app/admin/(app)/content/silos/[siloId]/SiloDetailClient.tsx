'use client'

import { useState, useCallback, useMemo } from 'react'
import type { SiloKeyword, SiloPage, SiloInternalLink, KeywordType, InternalLinkStatus } from '@/lib/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  silo:              Record<string, unknown>
  initialKeywords:   Record<string, unknown>[]
  initialPages:      Record<string, unknown>[]
  initialLinks:      Record<string, unknown>[]
  activeTab:         string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KEYWORD_TYPE_COLORS: Record<KeywordType, { bg: string; color: string; label: string }> = {
  top_level:           { bg: 'var(--green-subtle)',  color: 'var(--green)',  label: 'Top Level' },
  secondary_top_level: { bg: 'var(--blue-subtle)',   color: 'var(--blue)',   label: 'Secondary' },
  supporting:          { bg: 'var(--border)',        color: 'var(--text-muted)', label: 'Supporting' },
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  planned:    { bg: 'var(--border)',       color: 'var(--text-muted)' },
  generated:  { bg: 'var(--amber-subtle)', color: 'var(--amber)' },
  for_review: { bg: 'var(--amber-subtle)', color: 'var(--amber)' },
  published:  { bg: 'var(--green-subtle)', color: 'var(--green)' },
}

const LINK_STATUS_COLORS: Record<InternalLinkStatus, { bg: string; color: string }> = {
  recommended: { bg: 'var(--blue-subtle)',  color: 'var(--blue)' },
  inserted:    { bg: 'var(--green-subtle)', color: 'var(--green)' },
  failed:      { bg: 'var(--red-subtle)',   color: 'var(--red)' },
  ignored:     { bg: 'var(--border)',       color: 'var(--text-faint)' },
}

// ─── Tab nav ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'keywords',  label: 'Keyword Map' },
  { id: 'pages',     label: 'Content Plan' },
  { id: 'map',       label: 'Silo Map' },
  { id: 'links',     label: 'Internal Links' },
  { id: 'optimize',  label: 'Optimization' },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function SiloDetailClient({ silo, initialKeywords, initialPages, initialLinks, activeTab: initialTab }: Props) {
  const [activeTab, setActiveTab]   = useState(initialTab)
  const [keywords,  setKeywords]    = useState<SiloKeyword[]>(initialKeywords as unknown as SiloKeyword[])
  const [pages,     setPages]       = useState<SiloPage[]>(initialPages as unknown as SiloPage[])
  const [links,     setLinks]       = useState<SiloInternalLink[]>(initialLinks as unknown as SiloInternalLink[])
  const [building,  setBuilding]    = useState(false)
  const [buildMsg,  setBuildMsg]    = useState<string | null>(null)
  const [recommending, setRecommending] = useState(false)

  const siloId   = String(silo.id)
  const siloName = String(silo.name)

  // ── Build plan ────────────────────────────────────────────────────────────
  const handleBuildPlan = useCallback(async () => {
    if (!confirm('This will generate a full keyword map and content plan using AI. Existing keywords and planned pages will be kept. Continue?')) return
    setBuilding(true)
    setBuildMsg(null)
    try {
      const res = await fetch(`/api/admin/content/silos/${siloId}/build-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json() as { ok?: boolean; keywordsCreated?: number; pagesCreated?: number; linksCreated?: number; error?: string }
      if (!res.ok) { setBuildMsg(`Error: ${data.error ?? 'Unknown error'}`); return }
      setBuildMsg(`Created ${data.keywordsCreated} keywords, ${data.pagesCreated} pages, ${data.linksCreated} link recommendations.`)
      // Refresh keywords and pages
      const [kwRes, pgRes, lkRes] = await Promise.all([
        fetch(`/api/admin/content/silos/${siloId}/keywords`).then(r => r.json()),
        fetch(`/api/admin/content/silos/${siloId}/pages`).then(r => r.json()),
        fetch(`/api/admin/content/silos/${siloId}/internal-links`).then(r => r.json()),
      ])
      if (kwRes.keywords) setKeywords(kwRes.keywords as SiloKeyword[])
      if (pgRes.pages)    setPages(pgRes.pages as SiloPage[])
      if (lkRes.links)    setLinks(lkRes.links as SiloInternalLink[])
    } catch (e) {
      setBuildMsg(`Error: ${String(e)}`)
    } finally {
      setBuilding(false)
    }
  }, [siloId])

  // ── Recommend links ───────────────────────────────────────────────────────
  const handleRecommendLinks = useCallback(async () => {
    setRecommending(true)
    try {
      const res  = await fetch(`/api/admin/content/silos/${siloId}/internal-links/recommend`, { method: 'POST' })
      const data = await res.json() as { created?: number; error?: string }
      const lkRes = await fetch(`/api/admin/content/silos/${siloId}/internal-links`).then(r => r.json()) as { links?: SiloInternalLink[] }
      if (lkRes.links) setLinks(lkRes.links)
      alert(res.ok ? `Created ${data.created ?? 0} new link recommendations.` : `Error: ${data.error}`)
    } catch (e) {
      alert(`Error: ${String(e)}`)
    } finally {
      setRecommending(false)
    }
  }, [siloId])

  // ── Update keyword type ───────────────────────────────────────────────────
  const handleKeywordTypeChange = useCallback(async (keywordId: string, newType: KeywordType) => {
    await fetch(`/api/admin/content/silos/${siloId}/keywords/${keywordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword_type: newType }),
    })
    setKeywords(prev => prev.map(k => k.id === keywordId ? { ...k, keyword_type: newType } : k))
  }, [siloId])

  // ── Toggle keyword selected ───────────────────────────────────────────────
  const handleKeywordSelect = useCallback(async (keywordId: string, selected: boolean) => {
    await fetch(`/api/admin/content/silos/${siloId}/keywords/${keywordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected }),
    })
    setKeywords(prev => prev.map(k => k.id === keywordId ? { ...k, selected } : k))
  }, [siloId])

  // ── Delete keyword ─────────────────────────────────────────────────────────
  const handleDeleteKeyword = useCallback(async (keywordId: string) => {
    await fetch(`/api/admin/content/silos/${siloId}/keywords/${keywordId}`, { method: 'DELETE' })
    setKeywords(prev => prev.filter(k => k.id !== keywordId))
  }, [siloId])

  // ── Update link status ─────────────────────────────────────────────────────
  const handleLinkStatus = useCallback(async (linkId: string, status: InternalLinkStatus) => {
    await fetch(`/api/admin/content/silos/${siloId}/internal-links/${linkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setLinks(prev => prev.map(l => l.id === linkId ? { ...l, status } : l))
  }, [siloId])

  // ── Keyword counts ─────────────────────────────────────────────────────────
  const kwCounts = useMemo(() => ({
    top_level:           keywords.filter(k => k.keyword_type === 'top_level').length,
    secondary_top_level: keywords.filter(k => k.keyword_type === 'secondary_top_level').length,
    supporting:          keywords.filter(k => k.keyword_type === 'supporting').length,
  }), [keywords])

  const pageCounts = useMemo(() => ({
    planned:   pages.filter(p => p.status === 'planned').length,
    generated: pages.filter(p => p.status === 'generated' || p.status === 'for_review').length,
    published: pages.filter(p => p.status === 'published').length,
  }), [pages])

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <a href="/admin/content?tab=silos" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textDecoration: 'none' }}>← Silos</a>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 className="page-title" style={{ marginBottom: 4 }}>{siloName}</h1>
            {silo.hub_page_url ? (
              <a href={String(silo.hub_page_url)} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--blue)' }}>
                {String(silo.hub_page_url)}
              </a>
            ) : null}
          </div>
          <button
            onClick={handleBuildPlan}
            disabled={building}
            className="btn btn-primary btn-sm"
            style={{ flexShrink: 0 }}
          >
            {building ? 'Building plan…' : '⚡ Build Silo Plan'}
          </button>
        </div>
        {buildMsg && (
          <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 4, background: buildMsg.startsWith('Error') ? 'var(--red-subtle)' : 'var(--green-subtle)', color: buildMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)', fontSize: '0.8rem' }}>
            {buildMsg}
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Top-level KW', value: kwCounts.top_level },
          { label: 'Secondary KWs', value: kwCounts.secondary_top_level },
          { label: 'Supporting KWs', value: kwCounts.supporting },
          { label: 'Planned pages', value: pageCounts.planned },
          { label: 'In progress', value: pageCounts.generated },
          { label: 'Published', value: pageCounts.published },
        ].map(stat => (
          <div key={stat.label} className="card" style={{ padding: '8px 14px', minWidth: 90, textAlign: 'center' }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{stat.value}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--blue)' : 'var(--text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab.id ? 'var(--blue)' : 'transparent'}`,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Keywords tab ── */}
      {activeTab === 'keywords' && (
        <KeywordsTab
          keywords={keywords}
          onTypeChange={handleKeywordTypeChange}
          onSelect={handleKeywordSelect}
          onDelete={handleDeleteKeyword}
          siloId={siloId}
          onAdded={kw => setKeywords(prev => [...prev, kw])}
        />
      )}

      {/* ── Content Plan tab ── */}
      {activeTab === 'pages' && (
        <PagesTab pages={pages} />
      )}

      {/* ── Silo Map tab ── */}
      {activeTab === 'map' && (
        <SiloMapTab pages={pages} links={links} siloName={siloName} hubUrl={silo.hub_page_url ? String(silo.hub_page_url) : null} />
      )}

      {/* ── Internal Links tab ── */}
      {activeTab === 'links' && (
        <LinksTab
          links={links}
          onStatusChange={handleLinkStatus}
          onRecommend={handleRecommendLinks}
          recommending={recommending}
        />
      )}

      {/* ── Optimization tab ── */}
      {activeTab === 'optimize' && (
        <OptimizationTab siloId={siloId} silo={silo} />
      )}
    </div>
  )
}

// ─── Keywords Tab ─────────────────────────────────────────────────────────────

function KeywordsTab({
  keywords,
  onTypeChange,
  onSelect,
  onDelete,
  siloId,
  onAdded,
}: {
  keywords:     SiloKeyword[]
  onTypeChange: (id: string, type: KeywordType) => void
  onSelect:     (id: string, selected: boolean) => void
  onDelete:     (id: string) => void
  siloId:       string
  onAdded:      (kw: SiloKeyword) => void
}) {
  const [newKw, setNewKw] = useState('')
  const [adding, setAdding] = useState(false)

  const grouped = useMemo(() => ({
    top_level:           keywords.filter(k => k.keyword_type === 'top_level'),
    secondary_top_level: keywords.filter(k => k.keyword_type === 'secondary_top_level'),
    supporting:          keywords.filter(k => k.keyword_type === 'supporting'),
  }), [keywords])

  const handleAdd = async () => {
    if (!newKw.trim()) return
    setAdding(true)
    try {
      const res = await fetch(`/api/admin/content/silos/${siloId}/keywords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: newKw.trim(), keyword_type: 'supporting', client_id: '__auto__' }),
      })
      const data = await res.json() as { keyword?: SiloKeyword }
      if (data.keyword) { onAdded(data.keyword); setNewKw('') }
    } finally {
      setAdding(false)
    }
  }

  const sections: Array<{ type: KeywordType; label: string }> = [
    { type: 'top_level', label: 'Top-Level Keyword (Hub)' },
    { type: 'secondary_top_level', label: 'Secondary Top-Level Keywords' },
    { type: 'supporting', label: 'Supporting Keywords' },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <input
          value={newKw}
          onChange={e => setNewKw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Add keyword…"
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.875rem', flex: 1, maxWidth: 300 }}
        />
        <button onClick={handleAdd} disabled={adding || !newKw.trim()} className="btn btn-secondary btn-sm">
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>

      {sections.map(({ type, label }) => {
        const group = grouped[type]
        const meta  = KEYWORD_TYPE_COLORS[type]
        return (
          <div key={type} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{label}</span>
              <span style={{ fontSize: '0.7rem', padding: '1px 7px', borderRadius: 10, background: meta.bg, color: meta.color }}>{group.length}</span>
            </div>
            {group.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>None yet — build a silo plan or add manually above.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: '0.72rem' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500 }}>Selected</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500 }}>Keyword</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500 }}>Type</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500 }}>Intent</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>Searches</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>Score</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500 }}>Ranking URL</th>
                      <th style={{ padding: '6px 8px', fontWeight: 500 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map(kw => (
                      <tr key={kw.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <input
                            type="checkbox"
                            checked={kw.selected}
                            onChange={e => onSelect(kw.id, e.target.checked)}
                          />
                        </td>
                        <td style={{ padding: '6px 8px', fontWeight: 500 }}>{kw.keyword}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <select
                            value={kw.keyword_type}
                            onChange={e => onTypeChange(kw.id, e.target.value as KeywordType)}
                            style={{ fontSize: '0.75rem', padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 3 }}
                          >
                            <option value="top_level">Top Level</option>
                            <option value="secondary_top_level">Secondary</option>
                            <option value="supporting">Supporting</option>
                          </select>
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{kw.intent ?? '—'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>
                          {kw.monthly_searches_low != null ? `${kw.monthly_searches_low}–${kw.monthly_searches_high ?? '?'}` : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          {kw.keyword_score != null ? (
                            <span style={{ fontWeight: 600, color: kw.keyword_score >= 50 ? 'var(--green)' : kw.keyword_score >= 30 ? 'var(--amber)' : 'var(--text-muted)' }}>
                              {kw.keyword_score}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {kw.current_ranking_url ? (
                            <a href={kw.current_ranking_url} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: '0.75rem' }}>
                              {kw.current_ranking_url}
                            </a>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <button
                            onClick={() => { if (confirm(`Delete "${kw.keyword}"?`)) onDelete(kw.id) }}
                            style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '0.75rem' }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Pages Tab ────────────────────────────────────────────────────────────────

function PagesTab({ pages }: { pages: SiloPage[] }) {
  const sorted = useMemo(() => [...pages].sort((a, b) => (a.sort_order - b.sort_order) || a.title.localeCompare(b.title)), [pages])

  if (sorted.length === 0) {
    return (
      <div style={{ color: 'var(--text-faint)', fontSize: '0.875rem' }}>
        No planned pages yet. Use the ⚡ Build Silo Plan button to generate a full content plan.
      </div>
    )
  }

  const hubPage = sorted.find(p => p.page_type === 'hub')
  const others  = sorted.filter(p => p.page_type !== 'hub')

  return (
    <div>
      {hubPage && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Hub Page</div>
          <PageRow page={hubPage} />
        </div>
      )}
      <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        Supporting Pages ({others.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {others.map(p => <PageRow key={p.id} page={p} />)}
      </div>
    </div>
  )
}

function PageRow({ page }: { page: SiloPage }) {
  const sc = STATUS_COLORS[page.status] ?? { bg: 'var(--border)', color: 'var(--text-muted)' }
  const post = (page as unknown as Record<string, unknown>).content_post as Record<string, unknown> | null

  return (
    <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 2 }}>{page.title}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          {page.page_type.replace(/_/g, ' ')} · {page.slug ?? 'no slug'}
        </div>
        {post && (
          <div style={{ fontSize: '0.72rem', color: 'var(--blue)', marginTop: 2 }}>
            Linked post: {String(post.title ?? '(untitled)')}
          </div>
        )}
      </div>
      <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 10, background: sc.bg, color: sc.color, flexShrink: 0 }}>
        {page.status.replace(/_/g, ' ')}
      </span>
      {page.target_url && (
        <a href={page.target_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: 'var(--blue)', flexShrink: 0 }}>↗</a>
      )}
    </div>
  )
}

// ─── Silo Map Tab ─────────────────────────────────────────────────────────────

function SiloMapTab({ pages, links, siloName, hubUrl }: { pages: SiloPage[]; links: SiloInternalLink[]; siloName: string; hubUrl: string | null }) {
  const hub       = pages.find(p => p.page_type === 'hub')
  const supports  = pages.filter(p => p.page_type !== 'hub')

  const statusColor = (s: string) => {
    if (s === 'published')  return 'var(--green)'
    if (s === 'for_review' || s === 'generated') return 'var(--amber)'
    return 'var(--border)'
  }

  return (
    <div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
        Visual map of hub and supporting pages. Arrows represent recommended internal links. Colors indicate status.
      </p>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, fontSize: '0.72rem', color: 'var(--text-faint)' }}>
        {[['var(--green)', 'Published'], ['var(--amber)', 'In Progress'], ['var(--border)', 'Planned']].map(([c, l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
            {l}
          </div>
        ))}
      </div>

      {/* Hub node */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{
          padding: '12px 20px',
          borderRadius: 8,
          border: `2px solid ${hub ? statusColor(hub.status) : 'var(--blue)'}`,
          background: 'var(--bg-surface)',
          textAlign: 'center',
          minWidth: 200,
          maxWidth: 280,
        }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Hub Page</div>
          <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{hub?.title ?? siloName}</div>
          {hubUrl && (
            <a href={hubUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: 'var(--blue)', display: 'block', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hubUrl}
            </a>
          )}
        </div>

        {supports.length > 0 && (
          <>
            {/* Arrow line down */}
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            {/* Supporting pages grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, width: '100%' }}>
              {supports.map(p => (
                <div key={p.id} style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: `1.5px solid ${statusColor(p.status)}`,
                  background: 'var(--bg-surface)',
                  fontSize: '0.8rem',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 2, fontSize: '0.8125rem' }}>{p.title}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>{p.page_type.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: '0.65rem', marginTop: 4, color: statusColor(p.status), textTransform: 'capitalize' }}>{p.status.replace(/_/g, ' ')}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {supports.length === 0 && pages.length === 0 && (
          <p style={{ color: 'var(--text-faint)', fontSize: '0.875rem' }}>
            No pages planned yet. Build a silo plan to generate a visual map.
          </p>
        )}
      </div>

      {/* Link summary */}
      {links.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 8 }}>Link Recommendations ({links.filter(l => l.status === 'recommended').length})</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {links.filter(l => l.link_type === 'hub_to_supporting').length} hub→supporting ·&nbsp;
            {links.filter(l => l.link_type === 'supporting_to_hub').length} supporting→hub ·&nbsp;
            {links.filter(l => l.link_type === 'supporting_to_supporting').length} cross-links
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Internal Links Tab ───────────────────────────────────────────────────────

function LinksTab({
  links,
  onStatusChange,
  onRecommend,
  recommending,
}: {
  links:          SiloInternalLink[]
  onStatusChange: (id: string, status: InternalLinkStatus) => void
  onRecommend:    () => void
  recommending:   boolean
}) {
  const byStatus = useMemo(() => ({
    recommended: links.filter(l => l.status === 'recommended'),
    inserted:    links.filter(l => l.status === 'inserted'),
    failed:      links.filter(l => l.status === 'failed'),
    ignored:     links.filter(l => l.status === 'ignored'),
  }), [links])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {byStatus.recommended.length} recommended · {byStatus.inserted.length} inserted · {byStatus.ignored.length} ignored
        </div>
        <button onClick={onRecommend} disabled={recommending} className="btn btn-secondary btn-sm">
          {recommending ? 'Scanning…' : '+ Recommend links'}
        </button>
      </div>

      {links.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', fontSize: '0.875rem' }}>
          No link recommendations yet. Click &quot;Recommend links&quot; to scan published silo pages.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {links.map(link => {
            const sc = LINK_STATUS_COLORS[link.status] ?? LINK_STATUS_COLORS.recommended
            return (
              <div key={link.id} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 500, marginBottom: 2 }}>
                    <span style={{ color: 'var(--text-faint)' }}>{link.link_type.replace(/_/g, ' ')}</span>
                  </div>
                  <div style={{ fontSize: '0.8rem' }}>
                    {link.source_url ? <a href={link.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{link.source_url}</a> : <span style={{ color: 'var(--text-faint)' }}>(source not live)</span>}
                    {' → '}
                    {link.target_url ? <a href={link.target_url} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{link.target_url}</a> : <span style={{ color: 'var(--text-faint)' }}>(target not live)</span>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    Anchor: &quot;{link.anchor_text}&quot;
                    {link.reason && <span style={{ marginLeft: 8 }}>— {link.reason}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: sc.bg, color: sc.color }}>
                    {link.status}
                  </span>
                  {link.status === 'recommended' && (
                    <>
                      <button onClick={() => onStatusChange(link.id, 'inserted')} className="btn btn-sm" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>Mark inserted</button>
                      <button onClick={() => onStatusChange(link.id, 'ignored')}  style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '0.75rem' }}>Ignore</button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Optimization Tab ─────────────────────────────────────────────────────────

function OptimizationTab({ siloId, silo }: { siloId: string; silo: Record<string, unknown> }) {
  const [keyword, setKeyword]       = useState(String(silo.name ?? ''))
  const [targetUrl, setTargetUrl]   = useState(String(silo.hub_page_url ?? ''))
  const [competitors, setCompetitors] = useState('')
  const [building, setBuilding]     = useState(false)
  const [briefId, setBriefId]       = useState<string | null>(null)
  const [brief, setBrief]           = useState<Record<string, unknown> | null>(null)
  const [auditId, setAuditId]       = useState<string | null>(null)
  const [audit, setAudit]           = useState<Record<string, unknown> | null>(null)
  const [auditing, setAuditing]     = useState(false)
  const [msg, setMsg]               = useState<string | null>(null)

  const handleBuildBrief = async () => {
    if (!keyword.trim()) { setMsg('Enter a primary keyword.'); return }
    setBuilding(true); setMsg(null)
    try {
      const competitorUrls = competitors.split('\n').map(s => s.trim()).filter(s => s.startsWith('http'))
      const res = await fetch('/api/admin/content/optimization/build-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:       '__auto__',
          silo_id:         siloId,
          primary_keyword: keyword.trim(),
          target_url:      targetUrl || null,
          competitor_urls: competitorUrls,
        }),
      })
      const data = await res.json() as { brief_id?: string; error?: string }
      if (!res.ok) { setMsg(`Error: ${data.error}`); return }
      setBriefId(data.brief_id ?? null)
      // Fetch the brief
      const briefRes = await fetch(`/api/admin/content/optimization/briefs/${data.brief_id}`).then(r => r.json()) as { brief?: Record<string, unknown> }
      if (briefRes.brief) setBrief(briefRes.brief)
      setMsg('Brief generated successfully.')
    } catch (e) {
      setMsg(`Error: ${String(e)}`)
    } finally {
      setBuilding(false)
    }
  }

  const handleAudit = async () => {
    if (!briefId) { setMsg('Build a brief first.'); return }
    if (!targetUrl.trim()) { setMsg('Enter a target URL to audit.'); return }
    setAuditing(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/content/optimization/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief_id:   briefId,
          client_id:  '__auto__',
          silo_id:    siloId,
          target_url: targetUrl,
        }),
      })
      const data = await res.json() as { audit_id?: string; error?: string }
      if (!res.ok) { setMsg(`Error: ${data.error}`); return }
      setAuditId(data.audit_id ?? null)
      const auditRes = await fetch(`/api/admin/content/optimization/audits/${data.audit_id}`).then(r => r.json()) as { audit?: Record<string, unknown> }
      if (auditRes.audit) setAudit(auditRes.audit)
      setMsg('Audit complete.')
    } catch (e) {
      setMsg(`Error: ${String(e)}`)
    } finally {
      setAuditing(false)
    }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 20 }}>
        Build an optimization brief for the hub page or any supporting page, then score existing content against it.
      </p>

      {/* Brief builder form */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: 14 }}>1. Build Optimization Brief</h3>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Primary keyword</label>
            <input value={keyword} onChange={e => setKeyword(e.target.value)} style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.875rem', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Target page URL (optional)</label>
            <input value={targetUrl} onChange={e => setTargetUrl(e.target.value)} style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.875rem', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Competitor URLs (one per line, optional)</label>
            <textarea
              value={competitors}
              onChange={e => setCompetitors(e.target.value)}
              rows={3}
              placeholder="https://competitor.com/page"
              style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.8rem', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
          <button onClick={handleBuildBrief} disabled={building} className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
            {building ? 'Analyzing…' : '⚡ Build Brief'}
          </button>
        </div>
      </div>

      {/* Audit trigger */}
      {briefId && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: 10 }}>2. Audit Page Content</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            We&apos;ll fetch the target URL and score it against the brief.
          </p>
          <button onClick={handleAudit} disabled={auditing || !targetUrl} className="btn btn-secondary">
            {auditing ? 'Auditing…' : 'Score page against brief'}
          </button>
        </div>
      )}

      {msg && (
        <div style={{ padding: '8px 12px', borderRadius: 4, marginBottom: 16, background: msg.startsWith('Error') ? 'var(--red-subtle)' : 'var(--green-subtle)', color: msg.startsWith('Error') ? 'var(--red)' : 'var(--green)', fontSize: '0.8rem' }}>
          {msg}
        </div>
      )}

      {/* Audit results */}
      {audit && <AuditResults audit={audit} />}

      {/* Brief preview */}
      {brief && !audit && <BriefPreview brief={brief} />}
    </div>
  )
}

function AuditResults({ audit }: { audit: Record<string, unknown> }) {
  const score = Number(audit.score_total ?? 0)
  const scoreColor = score >= 75 ? 'var(--green)' : score >= 50 ? 'var(--amber)' : 'var(--red)'

  const dimensions = [
    { label: 'Exact keyword',  key: 'exact_keyword_score' },
    { label: 'Variations',     key: 'variation_score' },
    { label: 'LSI terms',      key: 'lsi_score' },
    { label: 'Entities',       key: 'entity_score' },
    { label: 'Word count',     key: 'word_count_score' },
    { label: 'Page structure', key: 'page_structure_score' },
    { label: 'Schema',         key: 'schema_score' },
    { label: 'EEAT signals',   key: 'eeat_score' },
    { label: 'Internal links', key: 'internal_link_score' },
  ]

  const findings = (audit.findings ?? []) as Array<{ category: string; severity: string; message: string; recommendation?: string }>
  const termUsage = (audit.term_usage ?? []) as Array<{ term: string; current_count: number; target_min: number; target_max: number; status: string; importance: string }>

  return (
    <div>
      {/* Score dial */}
      <div className="card" style={{ padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, color: scoreColor }}>{score}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Authority Score</div>
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {dimensions.map(d => {
            const v = audit[d.key] as number | null
            if (v == null) return null
            const c = v >= 75 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)'
            return (
              <div key={d.key} style={{ textAlign: 'center', padding: '6px 4px', borderRadius: 4, background: 'var(--bg-subtle)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: c }}>{v}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}>{d.label}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Findings */}
      {findings.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: 10 }}>Issues Found</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {findings.map((f, i) => (
              <div key={i} style={{ fontSize: '0.8rem', padding: '6px 10px', borderRadius: 4, borderLeft: `3px solid ${f.severity === 'critical' ? 'var(--red)' : f.severity === 'high' ? 'var(--amber)' : 'var(--border)'}`, background: 'var(--bg-subtle)' }}>
                <div style={{ fontWeight: 500 }}>{f.message}</div>
                {f.recommendation && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{f.recommendation}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Term usage table */}
      {termUsage.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: 10 }}>Term Coverage</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: '0.72rem' }}>
                  {['Term', 'Importance', 'Target', 'Current', 'Status'].map(h => (
                    <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {termUsage.map((t, i) => {
                  const sc = { missing: 'var(--red)', low: 'var(--amber)', good: 'var(--green)', high: 'var(--amber)', overused: 'var(--red)' }[t.status] ?? 'var(--text-muted)'
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '5px 8px', fontWeight: 500 }}>{t.term}</td>
                      <td style={{ padding: '5px 8px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{t.importance}</td>
                      <td style={{ padding: '5px 8px', color: 'var(--text-muted)' }}>{t.target_min}–{t.target_max}</td>
                      <td style={{ padding: '5px 8px', fontWeight: 600 }}>{t.current_count}</td>
                      <td style={{ padding: '5px 8px', color: sc, textTransform: 'capitalize' }}>{t.status}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function BriefPreview({ brief }: { brief: Record<string, unknown> }) {
  const headings  = (brief.recommended_headings  ?? []) as Array<{ level: string; text: string; required: boolean }>
  const questions = (brief.related_questions ?? []) as string[]
  const schemas   = (brief.schema_recommendations ?? []) as Array<{ schema_type: string; priority: string; reason: string }>

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: 16 }}>Brief Preview</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 6, color: 'var(--text-muted)' }}>Word Count Target</div>
          <div style={{ fontSize: '0.875rem' }}>
            {String(brief.recommended_word_count_min ?? '—')} – {String(brief.recommended_word_count_target ?? '—')} – {String(brief.recommended_word_count_max ?? '—')}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 6, color: 'var(--text-muted)' }}>Recommended Schema</div>
          <div style={{ fontSize: '0.8rem' }}>{schemas.map(s => s.schema_type).join(', ') || '—'}</div>
        </div>
        {headings.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 6, color: 'var(--text-muted)' }}>Recommended Headings</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {headings.map((h, i) => (
                <div key={i} style={{ fontSize: '0.8rem', paddingLeft: h.level === 'h3' ? 16 : 0, color: h.required ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  <span style={{ fontWeight: 500, color: 'var(--text-faint)', marginRight: 6 }}>{h.level.toUpperCase()}</span>
                  {h.text}
                  {h.required && <span style={{ fontSize: '0.65rem', color: 'var(--blue)', marginLeft: 4 }}>required</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {questions.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 6, color: 'var(--text-muted)' }}>Related Questions</div>
            <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {questions.slice(0, 6).map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
