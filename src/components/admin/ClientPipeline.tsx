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
import { cadenceLabel } from '@/lib/content/cadence'

interface Props {
  clientId:        string
  clientName:      string
  sites:           SiteOption[]
  aiConfigured:    boolean
  isActive?:       boolean
  contentSettings?: Record<string, unknown> | null
  /** Switch the Content tab to Settings, where the schedule a running plan follows is edited. */
  onOpenSettings?: () => void
}

function today(): string { return new Date().toISOString().slice(0, 10) }

/** What starting or regenerating the plan would do: the dates, the posts, and which dates were cleared. */
type PlanPreview = { dates: string[]; posts: number; cleared: string[] }

/** "Mon, Oct 5" */
function fmtShort(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function ClientPipeline({ clientId, clientName, sites, aiConfigured, isActive = true, contentSettings, onOpenSettings }: Props) {
  const clientSites = sites.filter(s => s.clientId === clientId)
  const firstConnectionId = clientSites[0]?.connectionId ?? null

  const cs = contentSettings ?? {}
  const connectionId     = (cs.connection_id as string | null) ?? firstConnectionId
  const autoGenerate       = cs.auto_generate === true
  const cadence            = cadenceLabel(cs)
  const publishes          = `Publishes ${cadence.charAt(0).toLowerCase()}${cadence.slice(1)}`

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
  // The dates starting the plan would fill, asked of the server (dry run) when the modal opens.
  const [plan,              setPlan]              = useState<PlanPreview | null>(null)
  const [planMode,          setPlanMode]          = useState<'start' | 'regenerate'>('start')
  // For a client with nothing live: whether it had a plan whose dates were cleared, so the card
  // offers to regenerate it rather than start one. Null until checked.
  const [idlePreview,       setIdlePreview]       = useState<PlanPreview | null>(null)
  const [idleChecked,       setIdleChecked]       = useState(false)
  const [planError,         setPlanError]         = useState<string | null>(null)
  const [generating,        setGenerating]        = useState(false)
  // A plan picking topics in the background, read from the server so it survives a refresh.
  const [planRunning,       setPlanRunning]       = useState<{ started_at: string; dates: string[] } | null>(null)
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

  const checkPlanRunning = useCallback(() => {
    fetch(`/api/admin/content/calendar/generate?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : { running: null })
      .then((d: { running?: { started_at: string; dates: string[] } | null }) => setPlanRunning(d.running ?? null))
      .catch(() => { /* keep what is shown; the next check corrects it */ })
  }, [clientId])
  useEffect(() => { checkPlanRunning() }, [checkPlanRunning])

  // While a plan runs, reload every 15s so topics appear as each batch lands, and once more when
  // it finishes. Not while the toast's own poll (started by this tab) is doing the same.
  const planWasRunning = useRef(false)
  useEffect(() => {
    if (!planRunning) {
      if (planWasRunning.current) { planWasRunning.current = false; loadPipeline() }
      return
    }
    planWasRunning.current = true
    const t = setInterval(() => { checkPlanRunning(); if (!pollRef.current) loadPipeline() }, 15_000)
    return () => clearInterval(t)
  }, [planRunning, checkPlanRunning, loadPipeline])

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
    })
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`) })
      .catch(e => {
        console.error('[generatePost]', e)
        // Revert the optimistic 'generating' so the card doesn't hang forever.
        setTopics(prev => prev.map(t => t.id === topicId ? { ...t, status: 'approved' } : t))
        showToast('Generation failed to start — please try again', 'error')
      })
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
    // This hard-deletes a post AND its topic on the server and cannot be undone, so it asks
    // first — every softer action on this page already confirms, and the monthly review card
    // confirms before the same call.
    if (!window.confirm(
      'Delete this permanently? The scheduled item and its draft are both removed, and the '
      + 'date is left empty so nothing regenerates into it. This cannot be undone.',
    )) return

    setPurgeLoading(p => ({ ...p, [id]: true }))
    const url = kind === 'topic' ? `/api/admin/content/topics/${id}` : `/api/admin/content/posts/${id}`
    try {
      const res = await fetch(url, { method: 'DELETE' })
      if (res.ok) {
        // BOTH halves leave the screen, whichever one was clicked.
        //
        // The server deletes the pair; this only ever dropped the half that was clicked, so
        // the counterpart stayed rendered as a greyed-out "for review" row pointing at rows
        // that no longer exist — the ghost that made deleting look like it had failed. The
        // topic branch also depended on topicIdToPost, which is empty for exactly the
        // regenerated rows whose keyword no longer matches.
        const linked = model.topicIdToPost.get(id)
        const pairedTopicId = kind === 'post'
          ? topics.find(t => t.post?.id === id || model.topicIdToPost.get(t.id)?.id === id)?.id
          : id

        setPosts(p => p.filter(post => post.id !== id && post.id !== linked?.id))
        setTopics(t => t.filter(x => x.id !== id && x.id !== pairedTopicId))
        showToast('Deleted')
      } else {
        // Carry the server's sentence. A published post returns 409 explaining it must be
        // discarded first; "Delete failed" hid that and invited a retry that always fails.
        const body = await res.json().catch(() => ({})) as { error?: string }
        showToast(body.error ?? 'Delete failed', 'error')
      }
    } catch { showToast('Delete failed', 'error') }
    finally { setPurgeLoading(p => ({ ...p, [id]: false })) }
  }

  // Always asked as a regenerate: for a new client there is nothing cleared, so it is the same as
  // starting; for one whose posts were cleared it is what fills those dates again.
  const fetchPlanPreview = useCallback(async (): Promise<PlanPreview | { error: string }> => {
    const res = await fetch('/api/admin/content/calendar/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, dry_run: true, regenerate: true }),
    }).catch(() => null)
    const data = (res ? await res.json().catch(() => ({})) : {}) as { dates?: string[]; slots?: string[]; cleared?: string[]; error?: string }
    if (!res?.ok) return { error: data.error ?? 'Couldn’t work out the dates. Try again.' }
    return { dates: data.dates ?? [], posts: (data.slots ?? []).length, cleared: data.cleared ?? [] }
  }, [clientId])

  async function openPlan(mode: 'start' | 'regenerate') {
    setPlanMode(mode); setCalendarModalOpen(true); setPlan(null); setPlanError(null)
    const r = await fetchPlanPreview()
    if ('error' in r) setPlanError(r.error)
    else setPlan(r)
  }

  // The schedule in Content settings decides the dates: its start date, cadence and how far ahead.
  // Sending none of them here is deliberate — the modal used to take a start date and a week
  // count, which let a plan be started on dates the cron would never keep up.
  async function generateCalendar(e: React.FormEvent) {
    e.preventDefault()
    setGenerating(true)
    // A dropped connection or a non-JSON error page (a gateway timeout) must not leave the button
    // stuck on "Generating topics…": every way out of here clears it.
    let res: Response
    let data: { queued?: boolean; slots?: string[]; reason?: string; error?: string }
    try {
      res = await fetch('/api/admin/content/calendar/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, regenerate: true }),
      })
      data = await res.json().catch(() => ({}))
    } catch {
      showToast('Couldn’t reach the server, so no topics were picked. Try again.', 'error')
      return
    } finally {
      setGenerating(false)
    }
    if (res.ok) {
      setCalendarModalOpen(false)
      if (data.queued) {
        checkPlanRunning()
        const n = (data.slots ?? []).length
        showToast(n ? `Generating ${n} topic${n === 1 ? '' : 's'}. They appear in the calendar as each one is ready.` : 'Generating topics. They appear in the calendar as each one is ready.', 'info')
        const prevCount = topicsRef.current.length
        let polls = 0
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = setInterval(() => {
          polls++
          loadPipeline()
          if (topicsRef.current.length > prevCount || polls >= 12) {
            clearInterval(pollRef.current!); pollRef.current = null
            if (topicsRef.current.length > prevCount) showToast(`${topicsRef.current.length - prevCount} topic${topicsRef.current.length - prevCount === 1 ? '' : 's'} added to the calendar`, 'success')
          }
        }, 15_000)
      } else {
        // Not queued means nothing was generated — the route only answers this way when every
        // slot already has a topic or was deliberately emptied, and it always says which. The old
        // "N topics generated" fallback here could never show, and nothing changed to reload.
        showToast(data.reason ?? 'Nothing to generate — every date already has a topic.', 'info')
      }
    } else showToast(data.error || `Couldn’t pick topics (HTTP ${res.status}).`, 'error')
  }

  const statusCounts = useMemo(() => computeStatusCounts(topics, posts), [topics, posts])

  // ── Row model (grouped by publish date) ────────────────────────────────────
  const model = useMemo(() => {
    const topicIdToPost = new Map<string, Post>()
    const seenPostIds = new Set<string>()
    const allItems: RowItem[] = []

    // A post claimed by more than one topic belongs to the topic the post itself names, else the
    // newest claimant; the others were superseded and are not shown. A full regenerate used to
    // retire only the topic the post recorded — most posts record none — so the old topic kept
    // pointing at the rewritten post and the post rendered twice on its date.
    const ownerOf = new Map<string, Topic>()
    for (const t of topics) {
      const pid = t.post?.id
      if (!pid) continue
      const cur = ownerOf.get(pid)
      const named = posts.find(p => p.id === pid)?.topic_id
      if (!cur || named === t.id || (named !== cur.id && (t.created_at ?? '') > (cur.created_at ?? ''))) ownerOf.set(pid, t)
    }

    topics.forEach(t => {
      if (t.post?.id && ownerOf.get(t.post.id) !== t) return
      // Three links, strongest first. The keyword+date guess USED to be the only fallback,
      // and it is guaranteed to break on exactly the rows people look at most: a full
      // regenerate picks a new topic and a new target_keyword, so the topic and its post stop
      // agreeing and BOTH halves render — the duplicate rows in the calendar. Neither FK
      // cascades and both are populated unevenly (content_topics.post_id ~85%,
      // content_posts.topic_id ~29%), so all three attempts are needed.
      //
      // The guess runs twice, preferring a post with no platform ids. A regenerate that keeps
      // the old article preserves it as its own row carrying the SAME keyword and date, so two
      // rows answer the guess identically — and .find returning the preserved one would hand
      // the topic's slot to a retired article and push the working post out to render as a
      // second card on the same date. A row that is already on the site is a distinct article,
      // not this topic's working copy, so it is only accepted when nothing else fits.
      const sameSlot = (p: Post) =>
        !p.topic_id
        && p.target_keyword === t.target_keyword
        && p.target_publish_date === t.target_publish_date
        && !seenPostIds.has(p.id)

      const linkedPost = (t.post?.id ? posts.find(p => p.id === t.post!.id) : undefined)
        ?? posts.find(p => p.topic_id === t.id)
        ?? posts.find(p => sameSlot(p) && !p.wp_post_id && !p.bc_post_id)
        ?? posts.find(p => sameSlot(p))
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

  // A plan is under way once the client has any topic or post that wasn't turned down. From then
  // on the cron keeps its dates filled from Content settings, so the card says it is running
  // rather than offering to start it again — a second "plan" only re-asked for dates that were
  // already taken, from a start date that no longer meant anything.
  //
  // Rejected posts don't count, any more than rejected topics do: discarding a draft leaves the
  // post in the list with status 'rejected' (it is not archived), and counting it kept a client
  // whose every post was turned down reading "Running" instead of offering to regenerate.
  const livePosts = useMemo(() => posts.filter(p => p.status !== 'rejected'), [posts])
  const planStarted = topics.some(t => t.status !== 'rejected') || livePosts.length > 0
  const plannedThrough = useMemo(() => {
    const from = today()
    const dates = [
      ...topics.filter(t => t.status !== 'rejected').map(t => t.target_publish_date),
      ...livePosts.map(p => p.target_publish_date),
    ].map(d => (d ?? '').slice(0, 10)).filter(d => d && d >= from).sort()
    return dates.length ? dates[dates.length - 1] : null
  }, [topics, livePosts])

  // Nothing live: find out whether this client had a plan whose posts were cleared (deleted, or
  // all rejected), which the card words as regenerating rather than starting.
  useEffect(() => {
    if (!aiConfigured || dataLoading || planStarted) return
    let cancelled = false
    fetchPlanPreview().then(r => {
      if (cancelled) return
      if (!('error' in r)) setIdlePreview(r)
      setIdleChecked(true)
    })
    return () => { cancelled = true }
  }, [aiConfigured, dataLoading, planStarted, fetchPlanPreview])
  const hadPlan = topics.length > 0 || posts.length > 0 || (idlePreview?.cleared.length ?? 0) > 0

  // Shared card-props builder for a RowItem
  const cardProps = (item: RowItem) => {
    const id = item.data.id
    return {
      item,
      linkedPost: item.kind === 'topic' ? (model.topicIdToPost.get(id) ?? null) : null,
      connectionId,
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

      {/* Every sub-tab names itself in the same shape: title, then one line. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Pipeline
        </h3>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Topics on their way to being written, and posts waiting on you.
        </p>
      </div>

      {/* ── AI Content Plan + New Post controls ────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {aiConfigured && dataLoading ? (
          <div className="card" style={{ flex: 1, minWidth: 280, padding: '14px 18px', fontSize: '0.8rem', color: 'var(--text-faint)' }}>Loading the content plan…</div>
        ) : aiConfigured && planStarted ? (
          <div className="card" style={{ flex: 1, minWidth: 280, borderLeft: `3px solid ${autoGenerate ? 'var(--green)' : 'var(--amber)'}`, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>Content plan</span>
                <span className={`badge ${autoGenerate ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: '0.68rem' }}>{autoGenerate ? 'Running' : 'Paused'}</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {publishes}.{' '}
                {autoGenerate ? (
                  plannedThrough
                    ? <>Topics are picked through <strong style={{ color: 'var(--text-primary)' }}>{fmtShort(plannedThrough)}</strong>. The next ones are picked automatically as dates get closer.</>
                    : <>The next topics are picked automatically as dates get closer.</>
                ) : (
                  <>Automatic planning is off, so no new topics are being picked{plannedThrough && <>. Topics are picked through <strong style={{ color: 'var(--text-primary)' }}>{fmtShort(plannedThrough)}</strong></>}.</>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => openPlan('regenerate')} disabled={!!planRunning} style={{ whiteSpace: 'nowrap' }}>Regenerate plan</button>
              {onOpenSettings && (
                <button className="btn btn-secondary btn-sm" onClick={onOpenSettings} style={{ whiteSpace: 'nowrap' }}>Change in Content settings</button>
              )}
            </div>
          </div>
        ) : aiConfigured && !idleChecked && topics.length === 0 ? (
          <div className="card" style={{ flex: 1, minWidth: 280, padding: '14px 18px', fontSize: '0.8rem', color: 'var(--text-faint)' }}>Loading the content plan…</div>
        ) : aiConfigured ? (
          <div className="card" style={{ flex: 1, minWidth: 280, borderLeft: '3px solid var(--blue)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                {hadPlan ? 'Regenerate the content plan' : 'Start the content plan'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {hadPlan
                  ? <>{publishes}. Its planned topics were cleared. Regenerating picks new topics for the upcoming publish dates{autoGenerate ? '; after that, new topics are picked automatically' : ''}.</>
                  : <>{publishes}. Starting picks a topic for each upcoming publish date{autoGenerate ? '; after that, new topics are picked automatically' : ''}.</>}
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => openPlan(hadPlan ? 'regenerate' : 'start')} disabled={!!planRunning} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {hadPlan ? 'Regenerate plan' : 'Start plan'}
            </button>
          </div>
        ) : (
          <div style={{ flex: 1, padding: '10px 14px', fontSize: '0.8125rem', color: 'var(--text-faint)', background: 'var(--bg-subtle)', borderRadius: 6, border: '1px solid var(--border)' }}>
            AI not configured — add a provider in Agency Settings to generate content plans
          </div>
        )}
        <button className="btn btn-secondary" onClick={() => setShowNewPost(true)} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>+ New Post</button>
      </div>

      {/* ── A plan picking topics in the background ───────────────────────── */}
      {planRunning && (
        <div className="plan-running" role="status">
          <span className="plan-running-dot" aria-hidden />
          <span>
            <strong>Picking topics{planRunning.dates.length > 0 ? ` for ${planRunning.dates.length} date${planRunning.dates.length === 1 ? '' : 's'}` : ''}</strong>
            {planRunning.dates.length > 0 && <> ({planRunning.dates.slice(0, 6).map(fmtShort).join(', ')}{planRunning.dates.length > 6 ? ', …' : ''})</>}
            . Started {Math.max(0, Math.round((Date.now() - Date.parse(planRunning.started_at)) / 60_000)) || 'under a'} min ago. They appear in the calendar as each batch is ready, usually within a few minutes.
          </span>
        </div>
      )}

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

      {/* ── Priority topics ───────────────────────────────────────────────── */}
      {/* Above the calendar and open, rather than collapsed at the bottom: these take the next
          publish dates ahead of everything else, so they are what to see first. Short when empty. */}
      <SiloManager
        clientId={clientId}
        onGenerated={loadPipeline}
      />

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
          <p className="text-sm" style={{ color: 'var(--text-faint)', padding: '1rem 0' }}>No topics yet. Start the plan above to fill the first publish dates.</p>
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

      {/* ── Generate-Plan modal ────────────────────────────────────────────── */}
      {calendarModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.4)', backdropFilter: 'blur(2px)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setCalendarModalOpen(false)}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: '0.75rem', width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.18)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.125rem 1.375rem', borderBottom: '1px solid var(--border)' }}>
              <span className="font-semibold text-sm">{planMode === 'regenerate' ? 'Regenerate the content plan' : 'Start the content plan'}</span>
              <button type="button" aria-label="Close" onClick={() => setCalendarModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem' }}>✕</button>
            </div>
            <form onSubmit={generateCalendar} style={{ padding: '1.375rem' }}>
              <p style={{ margin: '0 0 0.875rem', fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {planMode === 'regenerate'
                  ? <>New topics are chosen automatically for the dates below, including dates whose posts you deleted or rejected. Topics already in the calendar stay as they are.</>
                  : <>Topics for these dates are chosen automatically, from Search Console, rankings and your ticked keywords. You can edit or reject any of them in the calendar.</>}
              </p>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 14, rowGap: 10, margin: 0, fontSize: '0.8125rem' }}>
                <dt style={{ color: 'var(--text-muted)' }}>Schedule</dt>
                <dd style={{ margin: 0, color: 'var(--text-primary)' }}>{cadence}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Topics for</dt>
                <dd style={{ margin: 0, color: planError ? 'var(--red)' : 'var(--text-primary)', lineHeight: 1.6 }}>
                  {planError
                    ? <>{planError}{' '}<button type="button" onClick={() => void openPlan(planMode)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blue)', font: 'inherit' }}>Try again</button></>
                    : !plan
                      ? <span style={{ color: 'var(--text-faint)' }}>Working out the dates…</span>
                      : plan.dates.length === 0
                        ? (planMode === 'regenerate'
                          ? 'Every upcoming date already has a topic. Delete the ones you don’t want, then regenerate.'
                          : 'Every upcoming date already has a topic.')
                        : plan.dates.map(d => plan.cleared.includes(d) ? `${fmtShort(d)} (cleared)` : fmtShort(d)).join(' · ')}
                </dd>
                <dt style={{ color: 'var(--text-muted)' }}>After that</dt>
                <dd style={{ margin: 0, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {autoGenerate
                    ? 'New topics are picked automatically as later dates get closer.'
                    : 'Automatic planning is off, so later dates won’t get topics on their own.'}
                </dd>
              </dl>
              {onOpenSettings && (
                <p style={{ margin: '1rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  The schedule and start date come from{' '}
                  <button type="button" onClick={() => { setCalendarModalOpen(false); onOpenSettings() }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blue)', font: 'inherit' }}>Content settings</button>.
                  {' '}Change them there first if they aren&apos;t right.
                </p>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem', marginTop: '1.25rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCalendarModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={generating || !plan || plan.posts === 0}>
                  {generating
                    ? 'Generating topics…'
                    : plan && plan.posts > 0
                      ? `Generate ${plan.posts} topic${plan.posts === 1 ? '' : 's'}`
                      : planMode === 'regenerate' ? 'Regenerate plan' : 'Start plan'}
                </button>
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
            // undefined (not null) lets the editor fetch the breakdown by topicId
            // for posts linked only heuristically (no topic.post FK).
            if (!t) return undefined
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
          onSaved={() => loadPipeline()}
        />
      )}
    </div>
  )
}
