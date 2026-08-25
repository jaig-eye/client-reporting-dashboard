'use client'

// Standalone blog Topic-Silos manager (extracted from ClientScheduleTab so the
// feature survives that component's retirement). Self-contained: owns its silo
// state, CRUD/generation handlers, the create/edit modal, the archive-confirm
// dialog, and a local toast. Mounted as a section inside ClientPipeline.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSiloSounds } from '@/lib/useSiloSounds'

type ClusterKw = {
  id: string
  keyword: string
  title?: string | null
  status: 'planned' | 'published'
  priority: number
}

interface Silo {
  id:               string
  name:             string
  hub_page_url:     string | null
  hub_page_title:   string | null
  central_entity:   string | null
  description:      string | null
  section:          string
  status:           string
  content_type:     string
  target_keyword:   string | null
  cluster_keywords: ClusterKw[]
  target_exists:    boolean
  priority:         number
  pending_links:    Array<{ post_id?: string; url?: string; title: string; added_at: string }>
  clusterCount:     number
  keywordTotal:     number
  keywordUnused:    number
  inject_internal_links: boolean
  publishedCount:   number
}

type QueueKeyword = {
  id:         string
  keyword:    string
  used_at:    string | null
  sort_order: number
  post:  { id: string; title: string | null; status: string; published_url: string | null } | null
  topic: { id: string; topic: string; status: string } | null
}

type Draft = {
  name: string; hub_page_url: string; hub_page_title: string
  target_keyword: string; target_exists: boolean; cluster_keywords: ClusterKw[]; priority: number; section: string
  /** One keyword per line — the hub-less queue. Only sent on create. */
  keywordQueue: string
  injectInternalLinks: boolean
}

const EMPTY_DRAFT: Draft = { name: '', hub_page_url: '', hub_page_title: '', target_keyword: '', target_exists: true, cluster_keywords: [], priority: 100, section: 'core', keywordQueue: '', injectInternalLinks: true }

export default function SiloManager({ clientId, onGenerated, platform = 'wordpress' }: { clientId: string; onGenerated?: () => void; platform?: 'wordpress' | 'bigcommerce' }) {
  const [silos,           setSilos]           = useState<Silo[]>([])
  const [silosLoading,    setSilosLoading]    = useState(false)
  const [expandedSiloId,  setExpandedSiloId]  = useState<string | null>(null)
  const [modalOpen,       setModalOpen]       = useState(false)
  const [modalMode,       setModalMode]       = useState<'create' | 'edit'>('create')
  const [editingSiloId,   setEditingSiloId]   = useState<string | null>(null)
  const [saving,          setSaving]          = useState(false)
  const [draft,           setDraft]           = useState<Draft>(EMPTY_DRAFT)
  const [generating,      setGenerating]      = useState<Record<string, boolean>>({})
  const [archiveConfirm,  setArchiveConfirm]  = useState<string | null>(null)
  const [toast,           setToast]           = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)
  // Keyword queues are loaded lazily per silo when its card is expanded.
  const [queues,          setQueues]          = useState<Record<string, QueueKeyword[]>>({})
  const [queueLoading,    setQueueLoading]    = useState<Record<string, boolean>>({})
  const { playSiloCreated, playClusterAdded, playTopicGenerated } = useSiloSounds(true)

  function showToast(msg: string, type: 'success' | 'error' | 'info' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3800)
  }

  const loadSilos = useCallback(() => {
    setSilosLoading(true)
    fetch(`/api/admin/content/silos?client_id=${clientId}`)
      .then(r => r.json())
      .then((d: { silos?: Silo[] }) => { setSilos(d.silos ?? []); setSilosLoading(false) })
      .catch(() => setSilosLoading(false))
  }, [clientId])
  useEffect(() => { loadSilos() }, [loadSilos])

  const loadQueue = useCallback((siloId: string) => {
    setQueueLoading(p => ({ ...p, [siloId]: true }))
    fetch(`/api/admin/content/silos/${siloId}/keywords`)
      .then(r => r.json())
      .then((d: { keywords?: QueueKeyword[] }) => setQueues(p => ({ ...p, [siloId]: d.keywords ?? [] })))
      .catch(() => {})
      .finally(() => setQueueLoading(p => ({ ...p, [siloId]: false })))
  }, [])

  function openCreate() { setDraft({ ...EMPTY_DRAFT }); setModalMode('create'); setEditingSiloId(null); setModalOpen(true) }
  function openEdit(s: Silo) {
    setDraft({
      name: s.name, hub_page_url: s.hub_page_url ?? '', hub_page_title: s.hub_page_title ?? '',
      target_keyword: s.target_keyword ?? '', target_exists: s.target_exists,
      cluster_keywords: Array.isArray(s.cluster_keywords) ? s.cluster_keywords : [],
      priority: s.priority ?? 100, section: s.section ?? 'core',
      // The queue is only seeded at creation; editing it happens on the silo's
      // own keyword list, so this stays blank in edit mode.
      keywordQueue: '',
      injectInternalLinks: s.inject_internal_links !== false,
    })
    setModalMode('edit'); setEditingSiloId(s.id); setModalOpen(true)
  }

  async function saveSilo() {
    if (!draft.name.trim()) return
    setSaving(true)
    const payload: Record<string, unknown> = {
      client_id: clientId, name: draft.name.trim(), content_type: 'blog',
      hub_page_url: draft.hub_page_url.trim() || null, hub_page_title: draft.hub_page_title.trim() || null,
      target_keyword: draft.target_keyword.trim() || null, target_exists: draft.target_exists,
      cluster_keywords: draft.cluster_keywords, priority: draft.priority, section: draft.section,
      inject_internal_links: draft.injectInternalLinks,
    }
    // Seed the keyword queue on create only — one keyword per line.
    if (modalMode === 'create') {
      payload.keywords = draft.keywordQueue.split('\n').map(k => k.trim()).filter(Boolean)
    }
    const res = modalMode === 'create'
      ? await fetch('/api/admin/content/silos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`/api/admin/content/silos?id=${editingSiloId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    setSaving(false)
    if (res.ok) {
      setModalOpen(false); loadSilos()
      if (modalMode === 'create') playSiloCreated()
      showToast(modalMode === 'create' ? 'Silo created' : 'Silo saved')
    } else showToast((await res.json().catch(() => ({}))).error ?? 'Failed to save', 'error')
  }

  async function requestArchive(siloId: string) {
    const checkRes = await fetch(`/api/admin/content/topics?client_id=${clientId}&silo_id=${siloId}`)
    if (checkRes.ok) {
      const data = await checkRes.json() as Array<{ status: string }>
      const active = Array.isArray(data) ? data.filter(t => ['pending', 'approved', 'generating', 'generated', 'scheduled'].includes(t.status)) : []
      if (active.length > 0) { setArchiveConfirm(siloId); return }
    }
    doArchive(siloId)
  }
  async function doArchive(siloId: string) {
    setArchiveConfirm(null)
    await fetch(`/api/admin/content/silos?id=${siloId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) })
    setSilos(p => p.filter(s => s.id !== siloId)); showToast('Silo archived')
  }

  function addKw() {
    setDraft(d => ({ ...d, cluster_keywords: [...d.cluster_keywords, { id: crypto.randomUUID(), keyword: '', status: 'planned', priority: d.cluster_keywords.length + 1 }] }))
    playClusterAdded()
  }
  function removeKw(id: string) { setDraft(d => ({ ...d, cluster_keywords: d.cluster_keywords.filter(k => k.id !== id) })) }
  function updateKw(id: string, field: keyof ClusterKw, value: string) { setDraft(d => ({ ...d, cluster_keywords: d.cluster_keywords.map(k => k.id === id ? { ...k, [field]: value } : k) })) }
  function moveKw(id: string, dir: 'up' | 'down') {
    setDraft(d => {
      const arr = [...d.cluster_keywords]; const idx = arr.findIndex(k => k.id === id)
      if (dir === 'up' && idx > 0) [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
      if (dir === 'down' && idx < arr.length - 1) [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
      return { ...d, cluster_keywords: arr.map((k, i) => ({ ...k, priority: i + 1 })) }
    })
  }

  async function generateFromSilo(siloId: string, silo: Silo) {
    // A keyword-queue silo has no cluster_keywords — its keywords live in
    // content_silo_keywords. Blocking on cluster_keywords alone would make every
    // hub-less silo ungeneratable.
    const hasQueue   = (silo.keywordUnused ?? 0) > 0
    const hasCluster = (silo.cluster_keywords?.length ?? 0) > 0
    if (!hasQueue && !hasCluster) {
      showToast(
        (silo.keywordTotal ?? 0) > 0
          ? 'Every keyword in this set has been used — add more to keep generating'
          : 'Add keywords first to guide generation',
        'error',
      )
      return
    }
    setGenerating(p => ({ ...p, [siloId]: true }))
    const res = await fetch('/api/admin/content/calendar/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, silo_id: siloId, weeks_ahead: 4 }),
    })
    setGenerating(p => ({ ...p, [siloId]: false }))
    if (res.ok) {
      playTopicGenerated()
      showToast('Topics are generating — they\'ll appear in the pipeline shortly', 'info')
      // Refresh the queue too — generation consumes keywords.
      setTimeout(() => { loadSilos(); loadQueue(siloId); onGenerated?.() }, 3000)
    } else showToast((await res.json().catch(() => ({}))).error ?? 'Generation failed', 'error')
  }

  async function markHubUpdated(siloId: string) {
    await fetch(`/api/admin/content/silos?id=${siloId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pending_links: [] }) })
    setSilos(p => p.map(s => s.id === siloId ? { ...s, pending_links: [] } : s)); showToast('Hub marked as updated')
  }

  const badgeRef = useRef<Record<string, HTMLSpanElement | null>>({})
  useEffect(() => {
    silos.forEach(s => {
      const el = badgeRef.current[s.id]
      if (el && s.pending_links?.length > 0) { el.classList.remove('silo-badge-pop'); void el.offsetWidth; el.classList.add('silo-badge-pop') }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silos.map(s => s.pending_links?.length).join(',')])

  const PRIORITY_TIERS = [{ label: 'High', value: 25 }, { label: 'Medium', value: 100 }, { label: 'Low', value: 175 }]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <p style={{ fontWeight: 600, fontSize: '0.875rem', margin: 0 }}>Topic Silos</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2, marginBottom: 0 }}>Organise blog content into topical clusters with a hub page and internal linking.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreate} style={{ flexShrink: 0 }}>+ New Silo</button>
      </div>

      {silosLoading ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', margin: 0 }}>Loading silos…</p>
      ) : silos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 6, opacity: 0.4 }}>◎</div>
          <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>No silos yet</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 10 }}>Silos organize content into pillar-cluster groups for topical authority</p>
          <button className="btn btn-secondary btn-sm" onClick={openCreate}>+ Create First Silo</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {silos.map((s, idx) => {
            const isExpanded = expandedSiloId === s.id
            const kwList = Array.isArray(s.cluster_keywords) ? s.cluster_keywords : []
            const published = kwList.filter(k => k.status === 'published').length
            const planned = kwList.filter(k => k.status === 'planned').length
            const total = kwList.length
            const pct = total > 0 ? published / total : 0
            const pendCount = s.pending_links?.length ?? 0
            const isGenerating = generating[s.id]
            return (
              <div key={s.id} className="silo-card-enter card" style={{ '--silo-i': idx } as React.CSSProperties}>
                <div onClick={() => { const next = isExpanded ? null : s.id; setExpandedSiloId(next); if (next) loadQueue(next) }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', userSelect: 'none' }}>
                  <span className="badge badge-blue" style={{ fontSize: '0.65rem', flexShrink: 0 }}>Blog</span>
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  {pendCount > 0 && (
                    <span ref={el => { badgeRef.current[s.id] = el }} className="badge badge-amber" style={{ fontSize: '0.65rem', flexShrink: 0 }}>{pendCount} link{pendCount !== 1 ? 's' : ''} ↑</span>
                  )}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', flexShrink: 0 }}>{published}/{total} kw</span>
                  <span style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{isExpanded ? '▲' : '▼'}</span>
                </div>
                {total > 0 && (
                  <div style={{ height: 3, background: 'var(--bg-subtle)', overflow: 'hidden', marginTop: -1 }}>
                    <div style={{ display: 'flex', height: '100%' }}>
                      <div style={{ width: `${pct * 100}%`, background: 'var(--green)', transition: 'width 0.3s' }} />
                      <div style={{ width: `${(planned / total) * 100}%`, background: 'var(--amber)', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
                <div className={`silo-body-grid${isExpanded ? ' expanded' : ''}`}>
                  <div>
                    <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        {s.hub_page_url && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Hub:
                            <a href={s.hub_page_url} target="_blank" rel="noreferrer" style={{ marginLeft: 4, color: 'var(--blue)' }}>{s.hub_page_url.length > 40 ? '…' + s.hub_page_url.slice(-32) : s.hub_page_url} ↗</a>
                          </span>
                        )}
                        <span style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: 3, background: s.target_exists ? 'var(--green-subtle)' : 'var(--amber-subtle)', color: s.target_exists ? 'var(--green)' : 'var(--amber)' }}>
                          {s.target_exists ? '✓ hub exists' : '⚠ hub not created'}
                        </span>
                      </div>
                      {s.target_keyword && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>Target keyword: <em>&ldquo;{s.target_keyword}&rdquo;</em></p>}
                      {kwList.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Cluster Keywords ({total})</p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 120, overflowY: 'auto' }}>
                            {kwList.map(k => (
                              <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
                                <span style={{ color: k.status === 'published' ? 'var(--green)' : 'var(--text-faint)' }}>{k.status === 'published' ? '✓' : '○'}</span>
                                <span style={{ flex: 1, color: 'var(--text-primary)' }}>&ldquo;{k.keyword}&rdquo;</span>
                                <span style={{ color: 'var(--text-faint)', fontSize: '0.65rem' }}>[{k.status}]</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Keyword queue + what each term produced. */}
                      {(s.keywordTotal ?? 0) > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                            Keyword queue — {s.keywordUnused} of {s.keywordTotal} left
                            {s.inject_internal_links === false && (
                              <span style={{ marginLeft: 6, fontWeight: 500, color: 'var(--text-faint)' }}>· linking off</span>
                            )}
                          </p>
                          {queueLoading[s.id] && <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>Loading…</p>}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 160, overflowY: 'auto' }}>
                            {(queues[s.id] ?? []).map(k => (
                              <div key={k.id} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: '0.75rem' }}>
                                <span style={{ color: k.used_at ? 'var(--green)' : 'var(--text-faint)', flexShrink: 0 }}>
                                  {k.used_at ? '✓' : '○'}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ color: 'var(--text-primary)' }}>&ldquo;{k.keyword}&rdquo;</span>
                                  {k.post ? (
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: 1 }}>
                                      →{' '}
                                      {k.post.published_url
                                        ? <a href={k.post.published_url} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{k.post.title ?? 'Untitled'} ↗</a>
                                        : <span>{k.post.title ?? 'Untitled'}</span>}
                                      {' '}<span>({k.post.status})</span>
                                    </div>
                                  ) : k.topic ? (
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: 1 }}>
                                      → topic: {k.topic.topic} ({k.topic.status})
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {pendCount > 0 && (
                        <div style={{ padding: '8px 10px', background: 'var(--amber-subtle)', border: '1px solid var(--amber-border, #fde68a)', borderRadius: 5, marginBottom: 8 }}>
                          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--amber)', marginBottom: 4 }}>{pendCount} cluster page{pendCount !== 1 ? 's' : ''} ready — update hub page on WordPress</p>
                          <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.7rem' }} onClick={() => markHubUpdated(s.id)}>Mark hub updated</button>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.72rem' }} onClick={() => openEdit(s)}>Edit Silo</button>
                          <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.72rem', color: 'var(--red)' }} onClick={() => requestArchive(s.id)}>Archive</button>
                        </div>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: '0.75rem' }} disabled={isGenerating} onClick={() => generateFromSilo(s.id, s)}>
                          {isGenerating ? 'Generating…' : s.target_exists === false ? 'Generate Hub First →' : 'Generate Topics →'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Archive confirm */}
      {archiveConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ maxWidth: 380, width: '90%', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontWeight: 600, fontSize: '0.9375rem', margin: 0 }}>Archive silo?</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>This silo has active topics in the pipeline. Archiving keeps those topics but they&apos;ll no longer be associated with a silo.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => setArchiveConfirm(null)}>Cancel</button>
              <button className="btn btn-danger btn-sm" onClick={() => doArchive(archiveConfirm)}>Archive Anyway</button>
            </div>
          </div>
        </div>
      )}

      {/* Create / edit modal */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div className="card" style={{ maxWidth: 480, width: '100%', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>{modalMode === 'create' ? 'Create Silo' : 'Edit Silo'}</h3>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.125rem', padding: 4 }}>×</button>
            </div>
            <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Silo Name *</label>
                <input className="input" autoFocus value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. HVAC Repair" />
              </div>
              {/* Keyword queue — the hub-less path. Offered first because it is
                  the common case: a flat list of terms with no pillar page. */}
              {modalMode === 'create' && (
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
                    Keywords — one per line
                  </label>
                  <textarea
                    className="input"
                    rows={4}
                    value={draft.keywordQueue}
                    onChange={e => setDraft(d => ({ ...d, keywordQueue: e.target.value }))}
                    placeholder={'best outdoor car covers\ncar storage bubble vs garage\nhow to store a classic car\nwinter car storage checklist'}
                    style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                  />
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 4 }}>
                    {(() => {
                      const n = draft.keywordQueue.split('\n').filter(k => k.trim()).length
                      return n > 0
                        ? `Queues ${n} post${n === 1 ? '' : 's'} — one per keyword, generated in this order. No hub page needed.`
                        : 'Leave the hub fields below empty to run this as a flat keyword set with no pillar page.'
                    })()}
                  </p>
                </div>
              )}

              <details style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', listStyle: 'none' }}>
                  ▸ Hub page (optional — for a full hub-and-spoke silo)
                </summary>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Hub Page URL</label>
                    <input className="input" value={draft.hub_page_url} onChange={e => setDraft(d => ({ ...d, hub_page_url: e.target.value }))} placeholder="https://…" />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Hub Page Title</label>
                    <input className="input" value={draft.hub_page_title} onChange={e => setDraft(d => ({ ...d, hub_page_title: e.target.value }))} placeholder="e.g. HVAC Repair Services" />
                  </div>
                </div>
              </details>

              {/* Internal linking — off-switch plus an honest capability warning. */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={draft.injectInternalLinks}
                    onChange={e => setDraft(d => ({ ...d, injectInternalLinks: e.target.checked }))}
                    style={{ width: 16, height: 16 }}
                  />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Inject internal links between these articles
                  </span>
                </label>
                {platform === 'bigcommerce' && draft.injectInternalLinks && (
                  <p style={{ fontSize: '0.72rem', color: 'var(--amber)', marginTop: 6, marginLeft: 24, lineHeight: 1.5 }}>
                    ⚠ This client publishes to BigCommerce. Linking only works once a post has a
                    real public permalink — posts pushed before the permalink fix stored the store
                    admin URL instead. Run the permalink backfill, or leave this off for now.
                  </p>
                )}
                {!draft.injectInternalLinks && (
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 6, marginLeft: 24 }}>
                    Articles will be written standalone, with no cross-links between them.
                  </p>
                )}
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Target Keyword</label>
                <input className="input" value={draft.target_keyword} onChange={e => setDraft(d => ({ ...d, target_keyword: e.target.value }))} placeholder="e.g. hvac repair denver" />
              </div>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={draft.target_exists} onChange={e => setDraft(d => ({ ...d, target_exists: e.target.checked }))} style={{ width: 16, height: 16 }} />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>Hub page already exists</span>
                </label>
                {!draft.target_exists && <p style={{ fontSize: '0.75rem', color: 'var(--amber)', marginTop: 4, marginLeft: 26 }}>⚠ Hub page will be generated first before any cluster articles</p>}
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Priority</label>
                <div style={{ display: 'flex', gap: 4, padding: '3px', background: 'var(--bg-subtle)', borderRadius: 7, border: '1px solid var(--border)', width: 'fit-content' }}>
                  {PRIORITY_TIERS.map(({ label, value }) => (
                    <button key={value} type="button" onClick={() => setDraft(d => ({ ...d, priority: value }))}
                      style={{ padding: '0.28rem 0.75rem', fontSize: '0.8rem', borderRadius: 5, border: 'none', cursor: 'pointer', fontWeight: draft.priority === value ? 600 : 400, background: draft.priority === value ? 'var(--bg-surface)' : 'transparent', color: draft.priority === value ? 'var(--text-primary)' : 'var(--text-muted)', boxShadow: draft.priority === value ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Cluster Keywords ({draft.cluster_keywords.length})</label>
                  <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: '0.7rem' }} onClick={addKw}>+ Add Keyword</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                  {draft.cluster_keywords.length === 0 && <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', padding: '6px 0' }}>No keywords yet — add cluster keywords to guide AI generation</p>}
                  {draft.cluster_keywords.map((kw, idx) => (
                    <div key={kw.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <input className="input" style={{ flex: 2, fontSize: '0.8rem' }} value={kw.keyword} onChange={e => updateKw(kw.id, 'keyword', e.target.value)} placeholder="e.g. emergency hvac repair" />
                      <input className="input" style={{ flex: 1.5, fontSize: '0.8rem' }} value={kw.title ?? ''} onChange={e => updateKw(kw.id, 'title', e.target.value)} placeholder="Suggested title (optional)" />
                      <select className="input" style={{ width: 100, fontSize: '0.75rem' }} value={kw.status} onChange={e => updateKw(kw.id, 'status', e.target.value)}>
                        <option value="planned">planned</option>
                        <option value="published">published</option>
                      </select>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                        <button type="button" onClick={() => moveKw(kw.id, 'up')} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx > 0 ? 'pointer' : 'default', color: idx > 0 ? 'var(--text-muted)' : 'var(--border)', fontSize: '0.65rem', padding: '0 2px', lineHeight: 1 }}>▲</button>
                        <button type="button" onClick={() => moveKw(kw.id, 'down')} disabled={idx === draft.cluster_keywords.length - 1} style={{ background: 'none', border: 'none', cursor: idx < draft.cluster_keywords.length - 1 ? 'pointer' : 'default', color: idx < draft.cluster_keywords.length - 1 ? 'var(--text-muted)' : 'var(--border)', fontSize: '0.65rem', padding: '0 2px', lineHeight: 1 }}>▼</button>
                      </div>
                      <button type="button" onClick={() => removeKw(kw.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '0.9rem', padding: '0 2px', flexShrink: 0 }}>×</button>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 6 }}>Keywords are ordered by priority (top = highest). URLs auto-populate when pages publish.</p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveSilo} disabled={saving || !draft.name.trim()}>{saving ? 'Saving…' : modalMode === 'create' ? 'Create Silo' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div id="content-toast-container"><div className={`content-toast content-toast--${toast.type}`}>{toast.msg}</div></div>}
    </div>
  )
}
