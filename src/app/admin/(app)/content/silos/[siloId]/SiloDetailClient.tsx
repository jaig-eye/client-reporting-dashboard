'use client'

// The authority planner for one keyword set (silo): its keyword map, the content plan, a map of
// the main page and its supporting pages, suggested internal links, and an optimization brief.
// Five pill tabs that follow ?tab=, so a link can open any of them.

import { useState, useCallback, useMemo } from 'react'
import { ArrowSquareOut, Lightning, Plus, X } from '@phosphor-icons/react'
import type { SiloKeyword, SiloPage, SiloInternalLink, KeywordType, InternalLinkStatus } from '@/lib/types'
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import Field from '@/components/ui/Field'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import EmptyState from '@/components/ui/EmptyState'
import { PillTabs } from '@/components/ui/PillTabs'
import { ConfirmDialog } from '@/components/ui/Dialog'

/** "supporting_article" → "Supporting article": sentence case, not capitalize's Title Case. */
const sentence = (v: string) => v.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  silo:              Record<string, unknown>
  initialKeywords:   Record<string, unknown>[]
  initialPages:      Record<string, unknown>[]
  initialLinks:      Record<string, unknown>[]
  activeTab:         string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KEYWORD_TYPE_LABEL: Record<KeywordType, string> = {
  top_level:           'Top level',
  secondary_top_level: 'Secondary',
  supporting:          'Supporting',
}

// Amber is waiting for someone, green is on the site.
const PAGE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  planned:    { label: 'Planned',    tone: 'neutral' },
  generated:  { label: 'Written',    tone: 'warning' },
  for_review: { label: 'For review', tone: 'warning' },
  published:  { label: 'Published',  tone: 'success' },
}
const pageStatus = (s: string) => PAGE_STATUS[s] ?? { label: s.replace(/_/g, ' '), tone: 'neutral' as StatusTone }

const LINK_STATUS: Record<InternalLinkStatus, { label: string; tone: StatusTone }> = {
  recommended: { label: 'Suggested', tone: 'info'    },
  inserted:    { label: 'Added',     tone: 'success' },
  failed:      { label: 'Failed',    tone: 'danger'  },
  ignored:     { label: 'Ignored',   tone: 'neutral' },
}

const LINK_TYPE_LABEL: Record<string, string> = {
  hub_to_supporting:        'Main page to supporting page',
  supporting_to_hub:        'Supporting page to main page',
  supporting_to_supporting: 'Between supporting pages',
  supporting_to_related:    'To a related page',
  manual:                   'Added by hand',
}

// ─── Tab nav ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'keywords',  label: 'Keyword map' },
  { id: 'pages',     label: 'Content plan' },
  { id: 'map',       label: 'Silo map' },
  { id: 'links',     label: 'Internal links' },
  { id: 'optimize',  label: 'Optimization' },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function SiloDetailClient({ silo, initialKeywords, initialPages, initialLinks, activeTab: initialTab }: Props) {
  const [activeTab, setActiveTab]   = useState(TABS.some(t => t.id === initialTab) ? initialTab : 'keywords')
  const [keywords,  setKeywords]    = useState<SiloKeyword[]>(initialKeywords as unknown as SiloKeyword[])
  const [pages,     setPages]       = useState<SiloPage[]>(initialPages as unknown as SiloPage[])
  const [links,     setLinks]       = useState<SiloInternalLink[]>(initialLinks as unknown as SiloInternalLink[])
  const [building,  setBuilding]    = useState(false)
  const [confirmBuild, setConfirmBuild] = useState(false)
  const [buildMsg,  setBuildMsg]    = useState<{ ok: boolean; text: string } | null>(null)
  const [recommending, setRecommending] = useState(false)
  const [recMsg,    setRecMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  const siloId   = String(silo.id)
  const siloName = String(silo.name)
  const hubUrl   = silo.hub_page_url ? String(silo.hub_page_url) : null

  function selectTab(id: string) {
    setActiveTab(id)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', id)
    window.history.replaceState(window.history.state, '', url)
  }

  // ── Build plan ────────────────────────────────────────────────────────────
  const handleBuildPlan = useCallback(async () => {
    setConfirmBuild(false)
    setBuilding(true)
    setBuildMsg(null)
    try {
      const res = await fetch(`/api/admin/content/silos/${siloId}/build-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json() as { ok?: boolean; keywordsCreated?: number; pagesCreated?: number; linksCreated?: number; error?: string }
      if (!res.ok) { setBuildMsg({ ok: false, text: `The plan wasn’t built: ${data.error ?? 'no reason given'}` }); return }
      setBuildMsg({ ok: true, text: `Added ${data.keywordsCreated} keywords, ${data.pagesCreated} pages and ${data.linksCreated} link suggestions.` })
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
      setBuildMsg({ ok: false, text: `The plan wasn’t built: ${String(e)}` })
    } finally {
      setBuilding(false)
    }
  }, [siloId])

  // ── Recommend links ───────────────────────────────────────────────────────
  const handleRecommendLinks = useCallback(async () => {
    setRecommending(true)
    setRecMsg(null)
    try {
      const res  = await fetch(`/api/admin/content/silos/${siloId}/internal-links/recommend`, { method: 'POST' })
      const data = await res.json() as { created?: number; error?: string }
      const lkRes = await fetch(`/api/admin/content/silos/${siloId}/internal-links`).then(r => r.json()) as { links?: SiloInternalLink[] }
      if (lkRes.links) setLinks(lkRes.links)
      setRecMsg(res.ok
        ? { ok: true, text: `${data.created ?? 0} new link suggestion${data.created === 1 ? '' : 's'}.` }
        : { ok: false, text: `No links were suggested: ${data.error ?? 'no reason given'}` })
    } catch (e) {
      setRecMsg({ ok: false, text: `No links were suggested: ${String(e)}` })
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
      <PageHeader
        back={{ href: '/admin/content?view=silos', label: 'Priority topics' }}
        title={siloName}
        description={hubUrl
          ? <>Main page: <a href={hubUrl} target="_blank" rel="noreferrer" className="sd-url" style={{ maxWidth: 'min(420px, 70vw)' }}>{hubUrl}</a></>
          : 'No main page yet.'}
        actions={
          <button type="button" onClick={() => setConfirmBuild(true)} disabled={building} className="btn btn-primary">
            <Lightning size={15} weight="fill" aria-hidden />{building ? 'Building the plan…' : 'Build plan'}
          </button>
        }
      />
      {buildMsg && <div className={`ui-notice ui-notice--${buildMsg.ok ? 'success' : 'danger'}`} role="status">{buildMsg.text}</div>}

      <div className="sd-stats">
        {[
          { label: 'Top-level keywords', value: kwCounts.top_level },
          { label: 'Secondary keywords', value: kwCounts.secondary_top_level },
          { label: 'Supporting keywords', value: kwCounts.supporting },
          { label: 'Planned pages', value: pageCounts.planned },
          { label: 'In progress', value: pageCounts.generated },
          { label: 'Published', value: pageCounts.published },
        ].map(stat => (
          <div key={stat.label} className="sd-stat">
            <span className="sd-stat-value">{stat.value}</span>
            <span className="sd-stat-label">{stat.label}</span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <PillTabs items={TABS} activeId={activeTab} onSelect={selectTab} label="Planner sections" idPrefix="sd" />
      </div>

      <div role="tabpanel" id={`sd-panel-${activeTab}`} aria-labelledby={`sd-tab-${activeTab}`}>
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
        {activeTab === 'pages' && <PagesTab pages={pages} />}
        {activeTab === 'map' && <SiloMapTab pages={pages} links={links} siloName={siloName} hubUrl={hubUrl} />}
        {activeTab === 'links' && (
          <LinksTab links={links} onStatusChange={handleLinkStatus} onRecommend={handleRecommendLinks} recommending={recommending} message={recMsg} />
        )}
        {activeTab === 'optimize' && <OptimizationTab siloId={siloId} silo={silo} />}
      </div>

      <ConfirmDialog
        open={confirmBuild}
        onClose={() => setConfirmBuild(false)}
        title="Build a plan for this set?"
        confirmLabel="Build plan"
        onConfirm={handleBuildPlan}
      >
        <p>AI writes a full keyword map and content plan. The keywords and planned pages already here are kept.</p>
      </ConfirmDialog>
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
  const [deleting, setDeleting] = useState<SiloKeyword | null>(null)

  const grouped = useMemo(() => ({
    top_level:           keywords.filter(k => k.keyword_type === 'top_level'),
    secondary_top_level: keywords.filter(k => k.keyword_type === 'secondary_top_level'),
    supporting:          keywords.filter(k => k.keyword_type === 'supporting'),
  }), [keywords])

  const handleAdd = async (e?: React.FormEvent) => {
    e?.preventDefault()
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
    { type: 'top_level', label: 'Top-level keyword (the main page)' },
    { type: 'secondary_top_level', label: 'Secondary keywords' },
    { type: 'supporting', label: 'Supporting keywords' },
  ]

  return (
    <div>
      <form className="sd-add" onSubmit={handleAdd}>
        <input className="input" value={newKw} onChange={e => setNewKw(e.target.value)} placeholder="Add a keyword" aria-label="New keyword" />
        <button type="submit" disabled={adding || !newKw.trim()} className="btn btn-secondary">
          <Plus size={14} weight="bold" aria-hidden />{adding ? 'Adding…' : 'Add'}
        </button>
      </form>

      {sections.map(({ type, label }) => {
        const group = grouped[type]
        return (
          <div key={type} className="sd-group">
            <h2 className="sd-group-head">{label}<StatusBadge tone="neutral" dot={false}>{group.length}</StatusBadge></h2>
            {group.length === 0 ? (
              <p className="sd-empty">None yet. Build a plan, or add one above.</p>
            ) : (
              <div className="card ui-scroll-x" style={{ padding: 0 }}>
                <table className="ui-table sd-table">
                  <thead>
                    <tr>
                      <th>In queue</th>
                      <th>Keyword</th>
                      <th>Type</th>
                      <th>Intent</th>
                      <th className="ui-r">Searches a month</th>
                      <th className="ui-r">Score</th>
                      <th>Ranking page</th>
                      <th><span className="sr-only">Delete</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map(kw => (
                      <tr key={kw.id}>
                        <td>
                          <input type="checkbox" checked={kw.selected} onChange={e => onSelect(kw.id, e.target.checked)} aria-label={`Queue “${kw.keyword}”`} />
                        </td>
                        <td className="ui-strong">{kw.keyword}</td>
                        <td>
                          <select className="input" value={kw.keyword_type} onChange={e => onTypeChange(kw.id, e.target.value as KeywordType)} aria-label={`Type of “${kw.keyword}”`}>
                            {(Object.keys(KEYWORD_TYPE_LABEL) as KeywordType[]).map(t => <option key={t} value={t}>{KEYWORD_TYPE_LABEL[t]}</option>)}
                          </select>
                        </td>
                        <td style={{ textTransform: 'capitalize' }}>{kw.intent ?? '–'}</td>
                        <td className="ui-r">
                          {kw.monthly_searches_low != null ? `${kw.monthly_searches_low.toLocaleString()}–${kw.monthly_searches_high?.toLocaleString() ?? '?'}` : '–'}
                        </td>
                        <td className="ui-r">
                          {kw.keyword_score != null
                            ? <span className={kw.keyword_score >= 50 ? 'sd-score-good' : kw.keyword_score >= 30 ? 'sd-score-ok' : undefined}>{kw.keyword_score}</span>
                            : '–'}
                        </td>
                        <td>
                          {kw.current_ranking_url
                            ? <a href={kw.current_ranking_url} target="_blank" rel="noreferrer" className="sd-url" title={kw.current_ranking_url}>{kw.current_ranking_url.replace(/^https?:\/\//, '')}</a>
                            : '–'}
                        </td>
                        <td>
                          <button type="button" className="ui-x" onClick={() => setDeleting(kw)} aria-label={`Delete “${kw.keyword}”`} title="Delete">
                            <X size={14} weight="bold" aria-hidden />
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

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.keyword ?? ''}”?`}
        confirmLabel="Delete keyword"
        tone="danger"
        onConfirm={() => { if (deleting) onDelete(deleting.id); setDeleting(null) }}
      >
        <p>It comes out of this set’s keyword map.</p>
      </ConfirmDialog>
    </div>
  )
}

// ─── Pages Tab ────────────────────────────────────────────────────────────────

function PagesTab({ pages }: { pages: SiloPage[] }) {
  const sorted = useMemo(() => [...pages].sort((a, b) => (a.sort_order - b.sort_order) || a.title.localeCompare(b.title)), [pages])

  if (sorted.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={<Lightning size={22} weight="duotone" />} title="No pages planned yet">
          Build plan, at the top of the page, writes a full content plan for this set.
        </EmptyState>
      </div>
    )
  }

  const hubPage = sorted.find(p => p.page_type === 'hub')
  const others  = sorted.filter(p => p.page_type !== 'hub')

  return (
    <div className="ui-stack">
      {hubPage && (
        <Section title="Main page" flush><PageRow page={hubPage} /></Section>
      )}
      <Section title={`Supporting pages (${others.length})`} flush={others.length > 0}>
        {others.length === 0 ? <p className="sd-empty">None yet.</p> : others.map(p => <PageRow key={p.id} page={p} />)}
      </Section>
    </div>
  )
}

function PageRow({ page }: { page: SiloPage }) {
  const st = pageStatus(page.status)
  const post = (page as unknown as Record<string, unknown>).content_post as Record<string, unknown> | null

  return (
    <div className="ui-row">
      <div className="ui-row-text">
        <div className="ui-row-title">{page.title}<StatusBadge tone={st.tone}>{st.label}</StatusBadge></div>
        <p className="ui-row-sub" style={{ margin: 0, textTransform: 'none' }}>
          <span>{sentence(page.page_type)}</span> · {page.slug ? `/${page.slug}` : 'No address yet'}
        </p>
        {post && <p className="ui-row-sub" style={{ margin: 0 }}>Written as “{String(post.title ?? 'Untitled post')}”</p>}
      </div>
      {page.target_url && (
        <div className="ui-row-actions">
          <a href={page.target_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" aria-label={`Open “${page.title}” on the site`}>
            <ArrowSquareOut size={14} aria-hidden />View
          </a>
        </div>
      )}
    </div>
  )
}

// ─── Silo Map Tab ─────────────────────────────────────────────────────────────

function SiloMapTab({ pages, links, siloName, hubUrl }: { pages: SiloPage[]; links: SiloInternalLink[]; siloName: string; hubUrl: string | null }) {
  const hub       = pages.find(p => p.page_type === 'hub')
  const supports  = pages.filter(p => p.page_type !== 'hub')

  const nodeTone = (s: string) =>
    s === 'published' ? ' sd-node--published' : s === 'for_review' || s === 'generated' ? ' sd-node--progress' : ''

  if (pages.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={<Lightning size={22} weight="duotone" />} title="Nothing to map yet">
          Build a plan and its main page and supporting pages appear here.
        </EmptyState>
      </div>
    )
  }

  return (
    <div>
      <div className="sd-legend" aria-label="Key">
        <span><i style={{ '--sw': 'var(--green)' } as React.CSSProperties} />Published</span>
        <span><i style={{ '--sw': 'var(--amber)' } as React.CSSProperties} />In progress</span>
        <span><i style={{ '--sw': 'var(--border)' } as React.CSSProperties} />Planned</span>
      </div>

      <div className="sd-map">
        <div className={`sd-node sd-node--hub${hub ? nodeTone(hub.status) : ''}`}>
          <p className="sd-node-meta" style={{ margin: '0 0 3px' }}>Main page</p>
          <p className="sd-node-title">{hub?.title ?? siloName}</p>
          {hubUrl && <a href={hubUrl} target="_blank" rel="noreferrer" className="sd-url" style={{ fontSize: '0.72rem', maxWidth: '100%', marginTop: 4 }}>{hubUrl}</a>}
        </div>

        {supports.length > 0 && (
          <>
            <div className="sd-stem" aria-hidden />
            <div className="sd-node-grid">
              {supports.map(p => (
                <div key={p.id} className={`sd-node${nodeTone(p.status)}`}>
                  <p className="sd-node-title">{p.title}</p>
                  <p className="sd-node-meta">{sentence(p.page_type)} · {pageStatus(p.status).label}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {links.length > 0 && (
        <Section title={`Link suggestions (${links.filter(l => l.status === 'recommended').length} open)`} description={
          `${links.filter(l => l.link_type === 'hub_to_supporting').length} from the main page, ` +
          `${links.filter(l => l.link_type === 'supporting_to_hub').length} back to it, ` +
          `${links.filter(l => l.link_type === 'supporting_to_supporting').length} between supporting pages.`
        } />
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
  message,
}: {
  links:          SiloInternalLink[]
  onStatusChange: (id: string, status: InternalLinkStatus) => void
  onRecommend:    () => void
  recommending:   boolean
  message:        { ok: boolean; text: string } | null
}) {
  const byStatus = useMemo(() => ({
    recommended: links.filter(l => l.status === 'recommended'),
    inserted:    links.filter(l => l.status === 'inserted'),
    failed:      links.filter(l => l.status === 'failed'),
    ignored:     links.filter(l => l.status === 'ignored'),
  }), [links])

  return (
    <div>
      <div className="sd-links-head">
        <span>{byStatus.recommended.length} suggested · {byStatus.inserted.length} added · {byStatus.ignored.length} ignored</span>
        <button type="button" onClick={onRecommend} disabled={recommending} className="btn btn-secondary btn-sm">
          <Plus size={14} weight="bold" aria-hidden />{recommending ? 'Looking for links…' : 'Suggest links'}
        </button>
      </div>
      {message && <div className={`ui-notice ui-notice--${message.ok ? 'success' : 'danger'}`} role="status">{message.text}</div>}

      {links.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Plus size={22} weight="bold" />} title="No link suggestions yet">
            Suggest links looks through the set’s published pages for places they should link to each other.
          </EmptyState>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {links.map(link => {
            const st = LINK_STATUS[link.status] ?? LINK_STATUS.recommended
            return (
              <div key={link.id} className="ui-row" style={{ alignItems: 'flex-start' }}>
                <div className="ui-row-text">
                  <div className="ui-row-title" style={{ fontWeight: 500 }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{LINK_TYPE_LABEL[link.link_type] ?? link.link_type.replace(/_/g, ' ')}</span>
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </div>
                  <p className="sd-link-path" style={{ margin: '2px 0 0' }}>
                    {link.source_url ? <a href={link.source_url} target="_blank" rel="noreferrer">{link.source_url}</a> : <span className="sd-missing">Source page isn’t live yet</span>}
                    {' to '}
                    {link.target_url ? <a href={link.target_url} target="_blank" rel="noreferrer">{link.target_url}</a> : <span className="sd-missing">target page isn’t live yet</span>}
                  </p>
                  <p className="ui-row-sub" style={{ margin: 0 }}>
                    Link text: “{link.anchor_text}”{link.reason && <>. {link.reason}</>}
                  </p>
                </div>
                {link.status === 'recommended' && (
                  <div className="ui-row-actions">
                    <button type="button" onClick={() => onStatusChange(link.id, 'ignored')} className="btn btn-ghost btn-sm">Ignore</button>
                    <button type="button" onClick={() => onStatusChange(link.id, 'inserted')} className="btn btn-secondary btn-sm">Mark as added</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Optimization Tab ─────────────────────────────────────────────────────────

const toneOf = (v: number) => v >= 75 ? 'sd-tone-good' : v >= 50 ? 'sd-tone-ok' : 'sd-tone-bad'

function OptimizationTab({ siloId, silo }: { siloId: string; silo: Record<string, unknown> }) {
  const [keyword, setKeyword]       = useState(String(silo.name ?? ''))
  const [targetUrl, setTargetUrl]   = useState(String(silo.hub_page_url ?? ''))
  const [competitors, setCompetitors] = useState('')
  const [building, setBuilding]     = useState(false)
  const [briefId, setBriefId]       = useState<string | null>(null)
  const [brief, setBrief]           = useState<Record<string, unknown> | null>(null)
  const [, setAuditId]              = useState<string | null>(null)
  const [audit, setAudit]           = useState<Record<string, unknown> | null>(null)
  const [auditing, setAuditing]     = useState(false)
  const [msg, setMsg]               = useState<{ ok: boolean; text: string } | null>(null)

  const handleBuildBrief = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!keyword.trim()) { setMsg({ ok: false, text: 'Enter the keyword the page should rank for.' }); return }
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
      if (!res.ok) { setMsg({ ok: false, text: `The brief wasn’t built: ${data.error ?? 'no reason given'}` }); return }
      setBriefId(data.brief_id ?? null)
      // Fetch the brief
      const briefRes = await fetch(`/api/admin/content/optimization/briefs/${data.brief_id}`).then(r => r.json()) as { brief?: Record<string, unknown> }
      if (briefRes.brief) setBrief(briefRes.brief)
      setMsg({ ok: true, text: 'Brief built.' })
    } catch (e) {
      setMsg({ ok: false, text: `The brief wasn’t built: ${String(e)}` })
    } finally {
      setBuilding(false)
    }
  }

  const handleAudit = async () => {
    if (!briefId) { setMsg({ ok: false, text: 'Build a brief first.' }); return }
    if (!targetUrl.trim()) { setMsg({ ok: false, text: 'Enter the address of the page to score.' }); return }
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
      if (!res.ok) { setMsg({ ok: false, text: `The page wasn’t scored: ${data.error ?? 'no reason given'}` }); return }
      setAuditId(data.audit_id ?? null)
      const auditRes = await fetch(`/api/admin/content/optimization/audits/${data.audit_id}`).then(r => r.json()) as { audit?: Record<string, unknown> }
      if (auditRes.audit) setAudit(auditRes.audit)
      setMsg({ ok: true, text: 'Page scored.' })
    } catch (e) {
      setMsg({ ok: false, text: `The page wasn’t scored: ${String(e)}` })
    } finally {
      setAuditing(false)
    }
  }

  return (
    <div className="ui-stack" style={{ maxWidth: 820 }}>
      <Section title="Build a brief" description="What a page needs to rank for its keyword: length, headings, terms and schema.">
        <form onSubmit={handleBuildBrief} className="ui-fields">
          <div className="ui-grid-2">
            <Field label="Keyword" id="sd-kw">
              <input id="sd-kw" className="input" value={keyword} onChange={e => setKeyword(e.target.value)} />
            </Field>
            <Field label="Page address" id="sd-url" hint="Optional. Needed to score the page afterwards.">
              <input id="sd-url" className="input" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://" aria-describedby="sd-url-hint" />
            </Field>
          </div>
          <Field label="Competitor pages" id="sd-comp" hint="Optional. One address per line.">
            <textarea id="sd-comp" className="input" rows={3} value={competitors} onChange={e => setCompetitors(e.target.value)} placeholder="https://competitor.example/page" aria-describedby="sd-comp-hint" style={{ resize: 'vertical' }} />
          </Field>
          <div>
            <button type="submit" disabled={building} className="btn btn-primary">
              <Lightning size={15} weight="fill" aria-hidden />{building ? 'Building the brief…' : 'Build brief'}
            </button>
          </div>
        </form>
      </Section>

      {briefId && (
        <Section
          title="Score the page against it"
          description="Fetches the page address above and checks it against the brief."
          actions={<button type="button" onClick={handleAudit} disabled={auditing || !targetUrl} className="btn btn-secondary btn-sm">{auditing ? 'Scoring…' : 'Score page'}</button>}
        />
      )}

      {msg && <div className={`ui-notice ui-notice--${msg.ok ? 'success' : 'danger'}`} role="status" style={{ margin: 0 }}>{msg.text}</div>}

      {audit && <AuditResults audit={audit} />}
      {brief && !audit && <BriefPreview brief={brief} />}
    </div>
  )
}

function AuditResults({ audit }: { audit: Record<string, unknown> }) {
  const score = Number(audit.score_total ?? 0)

  const dimensions = [
    { label: 'Exact keyword',  key: 'exact_keyword_score' },
    { label: 'Variations',     key: 'variation_score' },
    { label: 'Related terms',  key: 'lsi_score' },
    { label: 'Entities',       key: 'entity_score' },
    { label: 'Word count',     key: 'word_count_score' },
    { label: 'Page structure', key: 'page_structure_score' },
    { label: 'Schema',         key: 'schema_score' },
    { label: 'E-E-A-T',        key: 'eeat_score' },
    { label: 'Internal links', key: 'internal_link_score' },
  ]

  const findings = (audit.findings ?? []) as Array<{ category: string; severity: string; message: string; recommendation?: string }>
  const termUsage = (audit.term_usage ?? []) as Array<{ term: string; current_count: number; target_min: number; target_max: number; status: string; importance: string }>
  const TERM_TONE: Record<string, string> = { missing: 'sd-tone-bad', low: 'sd-tone-ok', good: 'sd-tone-good', high: 'sd-tone-ok', overused: 'sd-tone-bad' }

  return (
    <>
      <Section title="Score">
        <div className="sd-score">
          <div className="sd-score-big">
            <div className={`sd-score-num ${toneOf(score)}`}>{score}</div>
            <div className="sd-score-label">Authority score</div>
          </div>
          <div className="sd-dims">
            {dimensions.map(d => {
              const v = audit[d.key] as number | null
              if (v == null) return null
              return (
                <div key={d.key} className="sd-dim">
                  <div className={`sd-dim-num ${toneOf(v)}`}>{v}</div>
                  <div className="sd-dim-label">{d.label}</div>
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      {findings.length > 0 && (
        <Section title="What to fix">
          {findings.map((f, i) => (
            <div key={i} className="sd-finding" style={{ '--sev': f.severity === 'critical' ? 'var(--red)' : f.severity === 'high' ? 'var(--amber)' : 'var(--border)' } as React.CSSProperties}>
              <p style={{ fontWeight: 500 }}>{f.message}</p>
              {f.recommendation && <p>{f.recommendation}</p>}
            </div>
          ))}
        </Section>
      )}

      {termUsage.length > 0 && (
        <Section title="Term coverage" flush>
          <div className="ui-scroll-x">
            <table className="ui-table">
              <thead><tr><th>Term</th><th>Importance</th><th className="ui-r">Target</th><th className="ui-r">Now</th><th>Status</th></tr></thead>
              <tbody>
                {termUsage.map((t, i) => (
                  <tr key={i}>
                    <td className="ui-strong">{t.term}</td>
                    <td style={{ textTransform: 'capitalize' }}>{t.importance}</td>
                    <td className="ui-r">{t.target_min}–{t.target_max}</td>
                    <td className="ui-r ui-strong">{t.current_count}</td>
                    <td className={TERM_TONE[t.status]} style={{ textTransform: 'capitalize', fontWeight: 600 }}>{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  )
}

function BriefPreview({ brief }: { brief: Record<string, unknown> }) {
  const headings  = (brief.recommended_headings  ?? []) as Array<{ level: string; text: string; required: boolean }>
  const questions = (brief.related_questions ?? []) as string[]
  const schemas   = (brief.schema_recommendations ?? []) as Array<{ schema_type: string; priority: string; reason: string }>

  return (
    <Section title="The brief">
      <div className="ui-fields">
        <div className="ui-grid-2">
          <div className="ui-field">
            <span className="ui-field-label">Words</span>
            <span style={{ fontSize: '0.875rem' }}>
              {String(brief.recommended_word_count_min ?? '–')} to {String(brief.recommended_word_count_max ?? '–')}, ideally {String(brief.recommended_word_count_target ?? '–')}
            </span>
          </div>
          <div className="ui-field">
            <span className="ui-field-label">Schema</span>
            <span style={{ fontSize: '0.8125rem' }}>{schemas.map(s => s.schema_type).join(', ') || 'None suggested'}</span>
          </div>
        </div>
        {headings.length > 0 && (
          <div className="ui-field">
            <span className="ui-field-label">Headings</span>
            <div className="sd-heads">
              {headings.map((h, i) => (
                <div key={i} className={h.level === 'h3' ? 'sd-h3' : undefined} style={{ color: h.required ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  <b>{h.level.toUpperCase()}</b>{h.text}
                  {h.required && <StatusBadge tone="info" dot={false}>Required</StatusBadge>}
                </div>
              ))}
            </div>
          </div>
        )}
        {questions.length > 0 && (
          <div className="ui-field">
            <span className="ui-field-label">Questions people ask</span>
            <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {questions.slice(0, 6).map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Section>
  )
}
