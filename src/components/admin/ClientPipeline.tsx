'use client'

// Per-client blog Pipeline — the card/review work area (replaces the old
// date-grouped table). Extracted from ClientScheduleTab's blog branch: same
// data, handlers, and endpoints; the render is now grouped cards (PipelineCard)
// that open the two-pane ContentPostEditor. Schedule/publishing config lives in
// the sibling Settings tab; this tab reads a few settings from `contentSettings`.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { SiteOption } from '@/lib/content/types'
import ContentPostEditor from '@/components/admin/ContentPostEditor'
import NewPostModal from '@/components/admin/NewPostModal'
import ContentStatusBar, { computeStatusCounts } from '@/components/admin/ContentStatusBar'
import SiloManager from '@/components/admin/SiloManager'
import PipelineCard, {
  type Topic, type Post, type RowItem, fmtDate,
} from '@/components/admin/PipelineCard'

interface Props {
  clientId:        string
  clientName:      string
  sites:           SiteOption[]
  aiConfigured:    boolean
  isActive?:       boolean
  contentSettings?: Record<string, unknown> | null
}

const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks',
  monthly: 'Monthly', monthly_first: 'Monthly (1st)', monthly_mid: 'Monthly (15th)', monthly_end: 'Monthly (28th)',
}

function today(): string { return new Date().toISOString().slice(0, 10) }

export default function ClientPipeline({ clientId, clientName, sites, aiConfigured, isActive = true, contentSettings }: Props) {
  const clientSites = sites.filter(s => s.clientId === clientId)
  const firstConnectionId = clientSites[0]?.connectionId ?? null

  const cs = contentSettings ?? {}
  const connectionId     = (cs.connection_id as string | null) ?? firstConnectionId
  const scheduleFrequency = (cs.schedule_frequency as string | null) ?? null
  const settingsWeeksAhead = (cs.weeks_ahead as number | null) ?? 6
  const settingsStartDate  = (cs.schedule_start_date as string | null) ?? today()

  // ── State ──────────────────────────────────────────────────────────────────
  const [topics,      setTopics]      = useState<Topic[]>([])
  const [posts,       setPosts]       = useState<Post[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [reviewPost,  setReviewPost]  = useState<Post | null>(null)

  const [expandedId,     setExpandedId]     = useState<string | null>(null)
  const [editingId,      setEditingId]      = useState<string | null>(null)
  const [editTitle,      setEditTitle]      = useState('')
  const [editNotes,      setEditNotes]      = useState('')
  const [showRejected,   setShowRejected]   = useState(false)
  const [showPublished,  setShowPublished]  = useState(false)
  const [showArchived,   setShowArchived]   = useState(false)
  const [topicLoading,   setTopicLoading]   = useState<Record<string, boolean>>({})
  const [slotGenerating, setSlotGenerating] = useState<Record<string, boolean>>({})
  const [purgeLoading,   setPurgeLoading]   = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)

  const [calendarModalOpen, setCalendarModalOpen] = useState(false)
  const [modalStartDate,    setModalStartDate]    = useState(settingsStartDate)
  const [modalWeeks,        setModalWeeks]        = useState(settingsWeeksAhead)
  const [generating,        setGenerating]        = useState(false)
  const [showNewPost,       setShowNewPost]       = useState(false)

  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const topicsRef = useRef<Topic[]>([])
  useEffect(() => { topicsRef.current = topics }, [topics])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // Close the review editor / modal when this tab is hidden (keep-alive pattern):
  // position:fixed children escape display:none, so close them explicitly.
  useEffect(() => {
    if (!isActive) { setReviewPost(null); setCalendarModalOpen(false); setShowNewPost(false) }
  }, [isActive])

  function showToast(msg: string, type: 'success' | 'error' | 'info' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3800)
  }

  // ── Load topics + posts ────────────────────────────────────────────────────
  const loadPipeline = useCallback(() => {
    setDataLoading(true)
    Promise.all([
      fetch(`/api/admin/content/topics?client_id=${clientId}`).then(r => r.json()),
      fetch(`/api/admin/content/posts?client_id=${clientId}&content_type=blog`).then(r => r.json()),
    ]).then(([topicsData, postsData]) => {
      setTopics(Array.isArray(topicsData) ? topicsData as Topic[] : [])
      setPosts(Array.isArray(postsData)   ? postsData   as Post[] : [])
      setDataLoading(false)
    }).catch(() => setDataLoading(false))
  }, [clientId])

  useEffect(() => { loadPipeline() }, [loadPipeline])

  // If the editor opened before the topic→post link loaded, refresh once.
  useEffect(() => {
    if (reviewPost && !topics.some(t => t.post?.id === reviewPost.id)) loadPipeline()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewPost])

  // ── Handlers (ported verbatim) ─────────────────────────────────────────────
  async function regenerateTopic(id: string) {
    setTopicLoading(p => ({ ...p, [id]: true }))
    const res = await fetch(`/api/admin/content/topics/${id}/regenerate`, { method: 'POST' })
    setTopicLoading(p => ({ ...p, [id]: false }))
    if (res.ok) {
      const updated = await res.json() as Topic
      setTopics(p => p.map(t => t.id === id ? { ...t, ...updated } : t))
      showToast('New idea generated')
    } else showToast((await res.json()).error || 'Regeneration failed', 'error')
  }

  async function topicAction(id: string, status: 'approved' | 'rejected') {
    setTopicLoading(p => ({ ...p, [id]: true }))
    const res = await fetch(`/api/admin/content/topics/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    setTopicLoading(p => ({ ...p, [id]: false }))
    if (res.ok) { setTopics(p => p.map(t => t.id === id ? { ...t, status } : t)); showToast(status === 'approved' ? 'Topic approved' : 'Topic rejected') }
    else showToast('Action failed', 'error')
  }

  function generatePost(topicId: string) {
    setTopics(prev => prev.map(t => t.id === topicId ? { ...t, status: 'generating' } : t))
    showToast('Post generation started — check back shortly', 'info')
    fetch('/api/admin/content/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic_id: topicId, suppress_email: true }),
    }).catch(e => console.error('[generatePost]', e))
  }

  function generateForSlot(dateKey: string, approvedIds: string[]) {
    if (!approvedIds.length) return
    setSlotGenerating(p => ({ ...p, [dateKey]: true }))
    setTopics(prev => prev.map(t => approvedIds.includes(t.id) ? { ...t, status: 'generating' } : t))
    showToast(`Generating ${approvedIds.length} post${approvedIds.length !== 1 ? 's' : ''}… check back shortly`, 'info')
    Promise.all(approvedIds.map(id =>
      fetch('/api/admin/content/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic_id: id, suppress_email: true }),
      }).then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`) })
        .catch(e => { console.error('[generateForSlot]', e); setTopics(prev => prev.map(t => t.id === id ? { ...t, status: 'approved' } : t)) })
    )).finally(() => setSlotGenerating(p => ({ ...p, [dateKey]: false })))
  }

  async function retryGenerate(topicId: string) {
    setTopicLoading(p => ({ ...p, [topicId]: true }))
    await fetch(`/api/admin/content/topics/${topicId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }),
    })
    setTopics(prev => prev.map(t => t.id === topicId ? { ...t, status: 'approved', generation_error: null } : t))
    setTopicLoading(p => ({ ...p, [topicId]: false }))
    generatePost(topicId)
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim()) { showToast('Title cannot be empty', 'error'); return }
    setTopicLoading(p => ({ ...p, [id]: true }))
    const res = await fetch(`/api/admin/content/topics/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: editTitle.trim(), edit_notes: editNotes.trim() || null }),
    })
    setTopicLoading(p => ({ ...p, [id]: false }))
    if (res.ok) { setTopics(p => p.map(t => t.id === id ? { ...t, topic: editTitle.trim(), edit_notes: editNotes.trim() || null } : t)); setEditingId(null); showToast('Title updated') }
    else showToast('Failed to update', 'error')
  }

  function openEdit(t: Topic) { setEditTitle(t.topic); setEditNotes(t.edit_notes ?? ''); setEditingId(t.id); setExpandedId(null) }

  async function cleanSlot(topicIds: string[]) {
    const res = await fetch('/api/admin/content/topics/bulk-reject', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic_ids: topicIds, client_id: clientId }),
    })
    if (res.ok) { setTopics(p => p.map(t => topicIds.includes(t.id) ? { ...t, status: 'rejected' } : t)); showToast(`Cleaned up ${topicIds.length} stale topic${topicIds.length !== 1 ? 's' : ''}`) }
    else showToast('Cleanup failed', 'error')
  }

  async function purgeItem(kind: 'topic' | 'post', id: string) {
    setPurgeLoading(p => ({ ...p, [id]: true }))
    const url = kind === 'topic' ? `/api/admin/content/topics/${id}` : `/api/admin/content/posts/${id}`
    try {
      const res = await fetch(url, { method: 'DELETE' })
      if (res.ok) {
        if (kind === 'topic') {
          const t = topics.find(x => x.id === id)
          const linked = t?.post?.id
            ? posts.find(p => p.id === t.post!.id)
            : posts.find(p => p.target_keyword === t?.target_keyword && p.target_publish_date === t?.target_publish_date)
          if (linked) setPosts(p => p.filter(post => post.id !== linked.id))
          setTopics(p => p.filter(x => x.id !== id))
        } else setPosts(p => p.filter(post => post.id !== id))
        showToast('Deleted')
      } else showToast('Delete failed', 'error')
    } catch { showToast('Delete failed', 'error') }
    finally { setPurgeLoading(p => ({ ...p, [id]: false })) }
  }

  async function generateCalendar(e: React.FormEvent) {
    e.preventDefault()
    setGenerating(true)
    const res = await fetch('/api/admin/content/calendar/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, start_date: modalStartDate, weeks_ahead: modalWeeks }),
    })
    const data = await res.json()
    setGenerating(false)
    if (res.ok) {
      setCalendarModalOpen(false)
      if (data.queued) {
        showToast(`Topics are generating — they'll appear here automatically`, 'info')
        const prevCount = topicsRef.current.length
        let polls = 0
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = setInterval(() => {
          polls++
          loadPipeline()
          if (topicsRef.current.length > prevCount || polls >= 12) {
            clearInterval(pollRef.current!); pollRef.current = null
            if (topicsRef.current.length > prevCount) showToast(`${topicsRef.current.length - prevCount} topics generated`, 'success')
          }
        }, 15_000)
      } else { showToast(data.reason ?? `${data.count ?? 0} topics generated across ${data.slots?.length ?? modalWeeks} publish dates`); loadPipeline() }
    } else showToast(data.error || 'Generation failed', 'error')
  }

  const statusCounts = useMemo(() => computeStatusCounts(topics, posts), [topics, posts])

  // ── Row model (grouped by publish date) ────────────────────────────────────
  const model = useMemo(() => {
    const topicIdToPost = new Map<string, Post>()
    const seenPostIds = new Set<string>()
    const allItems: RowItem[] = []

    topics.forEach(t => {
      const linkedPost = t.post?.id
        ? posts.find(p => p.id === t.post!.id)
        : posts.find(p => p.target_keyword === t.target_keyword && p.target_publish_date === t.target_publish_date && !seenPostIds.has(p.id))
      if (linkedPost) { seenPostIds.add(linkedPost.id); topicIdToPost.set(t.id, linkedPost) }
      allItems.push({ kind: 'topic', data: t })
    })

    const rejectedTopicPostIds = new Set<string>()
    topics.filter(t => t.status === 'rejected').forEach(t => { const p = topicIdToPost.get(t.id); if (p) rejectedTopicPostIds.add(p.id) })

    posts.forEach(p => {
      if (!seenPostIds.has(p.id) && (p.status === 'draft_saved' || p.status === 'published' || p.status === 'for_review')) allItems.push({ kind: 'post', data: p })
    })

    const groups = new Map<string, RowItem[]>()
    for (const item of allItems) {
      const date = item.data.target_publish_date ?? 'unscheduled'
      groups.set(date, [...(groups.get(date) ?? []), item])
    }

    const cutoff28 = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10)
    const publishedItems = allItems.filter(item => {
      if (item.kind !== 'post') return false
      const p = item.data
      if (p.status !== 'draft_saved' && p.status !== 'published') return false
      return !p.target_publish_date || p.target_publish_date >= cutoff28
    })

    const dateKeys = Array.from(groups.keys()).filter(k => k !== 'unscheduled').sort((a, b) => a.localeCompare(b))
    if (groups.has('unscheduled')) dateKeys.push('unscheduled')

    const rejectedCount = topics.filter(t => t.status === 'rejected').length + posts.filter(p => p.status === 'rejected').length
    const twoMonthsAgo = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)
    const archivedKeys = dateKeys.filter(k => k !== 'unscheduled' && k < twoMonthsAgo)
    const recentKeys   = dateKeys.filter(k => k === 'unscheduled' || k >= twoMonthsAgo)

    const filterGroupItems = (items: RowItem[]) => items.filter(item => {
      if (!showRejected) {
        if (item.data.status === 'rejected') return false
        if (item.kind === 'post' && rejectedTopicPostIds.has(item.data.id)) return false
      }
      if (item.kind === 'post' && (item.data.status === 'draft_saved' || item.data.status === 'published')) return false
      return true
    })

    const archivedCount = archivedKeys.reduce((s, k) => s + filterGroupItems(groups.get(k) ?? []).length, 0)
    return { topicIdToPost, allItems, groups, publishedItems, recentKeys, archivedKeys, rejectedCount, archivedCount, filterGroupItems }
  }, [topics, posts, showRejected])

  const freqSummary = scheduleFrequency ? `${FREQ_LABEL[scheduleFrequency] ?? scheduleFrequency} · 1 topic/slot` : '1 topic/slot'
  const willCreate  = Math.min(modalWeeks, 50)

  // Shared card-props builder for a RowItem
  const cardProps = (item: RowItem) => {
    const id = item.data.id
    return {
      item,
      linkedPost: item.kind === 'topic' ? (model.topicIdToPost.get(id) ?? null) : null,
      expanded: expandedId === id,
      editing: editingId === id,
      editTitle, editNotes,
      loading: !!topicLoading[id],
      purging: !!purgeLoading[id],
      onToggleExpand: () => setExpandedId(expandedId === id ? null : id),
      onReview: (p: Post) => setReviewPost(p),
      onGenerate: generatePost,
      onApprove: (tid: string) => topicAction(tid, 'approved'),
      onReject: (tid: string) => topicAction(tid, 'rejected'),
      onRegenerateTopic: regenerateTopic,
      onRetry: retryGenerate,
      onOpenEdit: openEdit,
      onEditTitleChange: setEditTitle,
      onEditNotesChange: setEditNotes,
      onSaveEdit: saveEdit,
      onCancelEdit: () => setEditingId(null),
      onPurge: purgeItem,
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── AI Content Plan + New Post controls ────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {aiConfigured ? (
          <div className="card" style={{ flex: 1, minWidth: 280, borderLeft: '3px solid var(--accent, #2563eb)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>AI Content Plan</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Generate 1 topic per {(FREQ_LABEL[scheduleFrequency ?? 'weekly'] ?? 'weekly').toLowerCase()} slot for your next {settingsWeeksAhead} publish date{settingsWeeksAhead > 1 ? 's' : ''}
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setCalendarModalOpen(true)} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>Generate Plan</button>
          </div>
        ) : (
          <div style={{ flex: 1, padding: '10px 14px', fontSize: '0.8125rem', color: 'var(--text-faint)', background: 'var(--bg-subtle)', borderRadius: 6, border: '1px solid var(--border)' }}>
            AI not configured — add a provider in Agency Settings to generate content plans
          </div>
        )}
        <button className="btn btn-secondary" onClick={() => setShowNewPost(true)} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>+ New Post</button>
      </div>

      {/* ── Publish-to sites ───────────────────────────────────────────────── */}
      {clientSites.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Publish to:</span>
          {clientSites.map(site => (
            <span key={site.connectionId} style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
              {site.siteName}
            </span>
          ))}
        </div>
      )}

      {/* ── Content Calendar (cards) ───────────────────────────────────────── */}
      <div className="card p-6">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h4 className="section-title" style={{ margin: 0 }}>Content Calendar</h4>
        </div>

        {!dataLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
            <ContentStatusBar counts={statusCounts} />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', flexShrink: 0, marginLeft: 12 }}>{topics.length + posts.length} items</span>
          </div>
        )}

        {dataLoading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : model.allItems.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-faint)', padding: '1rem 0' }}>No topics yet — click &quot;Generate Plan&quot; to create your first content calendar.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {model.recentKeys.map(dateKey => {
              const group = model.filterGroupItems(model.groups.get(dateKey) ?? [])
              if (group.length === 0) return null
              const topicsInGroup   = group.filter(r => r.kind === 'topic').map(r => r.data as Topic)
              const approvedInGroup = topicsInGroup.filter(t => ['approved', 'generating', 'generated'].includes(t.status)).length
              const generatableIds  = topicsInGroup.filter(t => t.status === 'approved').map(t => t.id)
              const rawSlot = model.groups.get(dateKey) ?? []
              const hasGenerated = rawSlot.some(r => (r.kind === 'topic' && r.data.status === 'generated') || (r.kind === 'post' && ['for_review', 'draft_saved', 'published'].includes(r.data.status)))
              const staleTopicIds = topicsInGroup.filter(t => ['pending', 'approved'].includes(t.status)).map(t => t.id)
              const showCleanup = hasGenerated && staleTopicIds.length > 0

              return (
                <div key={dateKey}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{dateKey === 'unscheduled' ? 'Unscheduled' : fmtDate(dateKey)}</span>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: approvedInGroup >= 1 ? 'var(--green)' : 'var(--border)' }} />
                    <span style={{ fontSize: '0.68rem', color: approvedInGroup >= 1 ? 'var(--green)' : 'var(--text-faint)' }}>{approvedInGroup >= 1 ? '✓' : '0/1'}</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    {generatableIds.length > 0 && (
                      <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.68rem' }} disabled={!!slotGenerating[dateKey]}
                        onClick={() => generateForSlot(dateKey, generatableIds)}>
                        {slotGenerating[dateKey] ? 'Generating…' : `Generate (${generatableIds.length})`}
                      </button>
                    )}
                    {showCleanup && (
                      <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}
                        onClick={() => cleanSlot(staleTopicIds)} title="Remove stale topics — a post has already been generated for this slot">
                        Clean up ({staleTopicIds.length})
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {group.map(item => <PipelineCard key={`${item.kind}-${item.data.id}`} {...cardProps(item)} />)}
                  </div>
                </div>
              )
            })}

            {/* Archived */}
            {model.archivedKeys.length > 0 && (
              <div>
                <button style={{ fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  onClick={() => setShowArchived(r => !r)}>
                  <span style={{ fontSize: '0.6rem' }}>{showArchived ? '▼' : '▶'}</span>
                  {showArchived ? 'Hide' : 'Show'} Archived ({model.archivedCount} items — older than 2 months)
                </button>
                {showArchived && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12, opacity: 0.85 }}>
                    {model.archivedKeys.map(dateKey => {
                      const group = model.filterGroupItems(model.groups.get(dateKey) ?? [])
                      if (group.length === 0) return null
                      return (
                        <div key={dateKey}>
                          <div style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>{fmtDate(dateKey)}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {group.map(item => <PipelineCard key={`arch-${item.kind}-${item.data.id}`} {...cardProps(item)} />)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Published */}
            {showPublished && model.publishedItems.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Published</div>
                {model.publishedItems.map(item => <PipelineCard key={`pub-${item.data.id}`} {...cardProps(item)} />)}
              </div>
            )}

            {/* Toggles */}
            <div style={{ display: 'flex', gap: 16 }}>
              {model.publishedItems.length > 0 && (
                <button style={{ fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }} onClick={() => setShowPublished(v => !v)}>
                  {showPublished ? 'Hide' : 'Show'} Published ({model.publishedItems.length})
                </button>
              )}
              {model.rejectedCount > 0 && (
                <button style={{ fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }} onClick={() => setShowRejected(r => !r)}>
                  {showRejected ? 'Hide' : 'Show'} Rejected ({model.rejectedCount})
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Topic Silos (collapsible) ──────────────────────────────────────── */}
      <details className="card" style={{ overflow: 'hidden' }}>
        <summary className="p-5 cursor-pointer font-semibold text-sm" style={{ color: 'var(--text-primary)', listStyle: 'none' }}>▸ Topic Silos</summary>
        <div className="p-5 pt-0" style={{ borderTop: '1px solid var(--border)' }}>
          <SiloManager clientId={clientId} onGenerated={loadPipeline} />
        </div>
      </details>

      {/* ── Generate-Plan modal ────────────────────────────────────────────── */}
      {calendarModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.4)', backdropFilter: 'blur(2px)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setCalendarModalOpen(false)}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: '0.75rem', width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.18)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.125rem 1.375rem', borderBottom: '1px solid var(--border)' }}>
              <span className="font-semibold text-sm">Generate SEO Content Calendar</span>
              <button type="button" onClick={() => setCalendarModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '1rem' }}>✕</button>
            </div>
            <form onSubmit={generateCalendar} style={{ padding: '1.375rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Start Date</label>
                  <input className="input" type="date" style={{ width: '100%' }} value={modalStartDate} onChange={e => setModalStartDate(e.target.value)} required />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Weeks Ahead</label>
                  <input className="input" type="number" min={1} max={24} style={{ width: '100%' }} value={modalWeeks} onChange={e => setModalWeeks(Number(e.target.value))} required />
                </div>
                <div style={{ borderRadius: '0.375rem', padding: '0.625rem 0.875rem', background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--blue)', marginBottom: '0.25rem' }}><strong>Using:</strong> {freqSummary}</p>
                  <p className="text-xs" style={{ color: 'var(--blue)' }}><strong>Will create:</strong> {willCreate} topic{willCreate !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem', marginTop: '1.25rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCalendarModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={generating}>{generating ? 'Generating…' : 'Generate →'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── New Post modal ─────────────────────────────────────────────────── */}
      {showNewPost && (
        <NewPostModal presetClientId={clientId} presetClientName={clientName} onClose={() => setShowNewPost(false)} onCreated={loadPipeline} />
      )}

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div id="content-toast-container"><div className={`content-toast content-toast--${toast.type}`}>{toast.msg}</div></div>
      )}

      {/* ── Post review editor (two-pane) ──────────────────────────────────── */}
      {reviewPost && (
        <ContentPostEditor
          postId={reviewPost.id}
          defaultConnectionId={connectionId ?? null}
          sites={clientSites}
          topicBreakdown={(() => {
            const t = topics.find(t => t.post?.id === reviewPost.id)
            if (!t) return null
            return {
              keyword_opportunity: t.keyword_opportunity,
              ranking_strategy: t.ranking_strategy,
              audience_intent: t.audience_intent,
              why_now: t.why_now,
              competition_level: t.competition_level,
              page_to_support: t.page_to_support ?? null,
              competitors_researched: t.competitors_researched?.urls ?? null,
            }
          })()}
          onClose={() => setReviewPost(null)}
          onUpdate={() => { setReviewPost(null); loadPipeline() }}
        />
      )}
    </div>
  )
}
