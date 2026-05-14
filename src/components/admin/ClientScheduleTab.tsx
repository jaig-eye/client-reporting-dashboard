'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ClientScheduleSettings, SiteOption, SeoScore } from '@/lib/content/types'
import ContentPostEditor from '@/components/admin/ContentPostEditor'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Author {
  id:   number
  name: string
}

interface Topic {
  id:                    string
  topic:                 string
  target_keyword:        string | null
  status:                string
  target_publish_date:   string | null
  rationale:             string | null
  competition_level:     string | null
  search_intent:         string | null
  keyword_opportunity:   string | null
  ranking_strategy:      string | null
  audience_intent:       string | null
  why_now:               string | null
  search_volume:         number | null
  keyword_difficulty:    number | null
  seo_brief:             Record<string, unknown> | null
  cannibalization_warning?: string | null
  page_to_support?:      string | null
  competitors_researched?: { keyword: string; urls: string[]; headings: Record<string, string[]> } | null
  edit_notes?:           string | null
  cluster_group?:        string | null
  post?:                 { id: string; title: string | null; status: string; published_url: string | null } | null
}

interface Post {
  id:                  string
  title:               string | null
  seo_title:           string | null
  target_keyword:      string | null
  status:              string
  target_publish_date: string | null
  wp_post_id:          number | null
  wp_site_url:         string | null
  bc_post_id:          number | null
  bc_store_hash:       string | null
  published_url:       string | null
  seo_score:           SeoScore | null
  generated_at:        string
}

interface Props {
  clientId:     string
  clientName:   string
  sites:        SiteOption[]
  aiConfigured: boolean
  postsPerRun?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const FREQ_OPTS = [
  { value: 'daily',         label: 'Daily' },
  { value: 'weekly',        label: 'Weekly' },
  { value: 'biweekly',      label: 'Every 2 weeks' },
  { value: 'monthly',       label: 'Monthly (28-day rolling)' },
  { value: 'monthly_first', label: 'Monthly — 1st of month' },
  { value: 'monthly_mid',   label: 'Monthly — mid-month (15th)' },
  { value: 'monthly_end',   label: 'Monthly — end of month (28th)' },
]

const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks',
  monthly: 'Monthly', monthly_first: 'Monthly (1st)', monthly_mid: 'Monthly (15th)', monthly_end: 'Monthly (28th)',
}

type DisplayStatus = 'pending' | 'approved' | 'generating' | 'generated' | 'published' | 'rejected'

const DISPLAY_STATUS_CONFIG: Record<DisplayStatus, { label: string; bg: string; color: string; dot: string }> = {
  pending:    { label: 'Pending Topics',   bg: 'var(--amber-subtle)',  color: 'var(--amber)',   dot: '#f59e0b' },
  approved:   { label: 'Approved Topics',  bg: 'var(--blue-subtle)',   color: 'var(--blue)',    dot: '#2563eb' },
  generating: { label: 'Generating Posts', bg: 'var(--amber-subtle)',  color: 'var(--amber)',   dot: '#f59e0b' },
  generated:  { label: 'Generated Posts',  bg: 'var(--green-subtle)',  color: 'var(--green)',   dot: '#10b981' },
  published:  { label: 'Published Posts',  bg: 'var(--green-subtle)',  color: 'var(--green)',   dot: '#059669' },
  rejected:   { label: 'Rejected',         bg: 'var(--red-subtle)',    color: 'var(--red)',     dot: '#ef4444' },
}

function getTopicDisplayStatus(t: Topic): DisplayStatus {
  if (t.status === 'rejected')   return 'rejected'
  if (t.status === 'generating') return 'generating'
  if (t.status === 'approved')   return 'approved'
  if (t.status === 'generated')  return 'generated'
  return 'pending'
}

function getPostDisplayStatus(p: Post): DisplayStatus {
  if (p.status === 'rejected')                                        return 'rejected'
  if (p.status === 'for_review')                                      return 'generated'
  if (p.status === 'draft_saved' || p.status === 'published')         return 'published'
  return 'generated'
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function scoreColor(s: SeoScore | null): string {
  if (!s) return 'var(--text-faint)'
  if (s.overall >= 80) return 'var(--green)'
  if (s.overall >= 60) return 'var(--amber)'
  return 'var(--red)'
}

function truncatePath(url: string, max = 32): string {
  try {
    const u    = new URL(url)
    const path = u.pathname
    return path.length > max ? path.slice(0, max) + '…' : path
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
      {children}
      {hint && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — {hint}</span>}
    </label>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none"
      style={{ background: checked ? 'var(--blue)' : 'var(--bg-muted)' }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(1rem)' : 'translateX(0)' }}
      />
    </button>
  )
}

function StatusPill({ status, generating }: { status: DisplayStatus; generating?: boolean }) {
  const cfg = DISPLAY_STATUS_CONFIG[status]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: '0.65rem', fontWeight: 600, padding: '2px 7px',
      borderRadius: 999, background: cfg.bg, color: cfg.color,
      whiteSpace: 'nowrap',
    }}>
      {generating
        ? <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: cfg.dot, animation: 'pulse 1.2s ease-in-out infinite' }} />
        : <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: cfg.dot }} />
      }
      {cfg.label}
    </span>
  )
}

// ─── Unified table row item (topic or linked post) ────────────────────────────

type RowItem =
  | { kind: 'topic'; data: Topic }
  | { kind: 'post';  data: Post; linkedTopic?: Topic }

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ClientScheduleTab({ clientId, clientName, sites, aiConfigured }: Props) {
  const clientSites = sites.filter(s => s.clientId === clientId)

  // Schedule form state
  const [schedule,     setSchedule]     = useState<Partial<ClientScheduleSettings>>({})
  const [authors,      setAuthors]      = useState<Author[]>([])
  const [schedSaving,  setSchedSaving]  = useState(false)
  const [schedSaved,   setSchedSaved]   = useState(false)
  const [schedError,   setSchedError]   = useState('')
  const [schedLoading, setSchedLoading] = useState(true)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  // Pipeline data
  const [topics,      setTopics]      = useState<Topic[]>([])
  const [posts,       setPosts]       = useState<Post[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [reviewPost,  setReviewPost]  = useState<Post | null>(null)

  // Table state
  const [expandedId,     setExpandedId]     = useState<string | null>(null)
  const [editingId,      setEditingId]      = useState<string | null>(null)
  const [editTitle,      setEditTitle]      = useState('')
  const [editNotes,      setEditNotes]      = useState('')
  const [showRejected,   setShowRejected]   = useState(false)
  const [topicLoading,   setTopicLoading]   = useState<Record<string, boolean>>({})
  const [slotGenerating, setSlotGenerating] = useState<Record<string, boolean>>({})

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)

  // Calendar modal
  const [calendarModalOpen, setCalendarModalOpen] = useState(false)
  const [modalStartDate,    setModalStartDate]    = useState(today())
  const [modalWeeks,        setModalWeeks]        = useState(6)
  const [generating,        setGenerating]        = useState(false)

  // ── Load schedule settings ─────────────────────────────────────────────────
  useEffect(() => {
    setSchedLoading(true)
    fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        const loaded: Partial<ClientScheduleSettings> = {
          schedule_frequency:    (d.schedule_frequency    as string  | null) ?? null,
          schedule_day_of_week:  (d.schedule_day_of_week  as number  | null) ?? null,
          monthly_publish_day:   (d.monthly_publish_day   as number  | null) ?? null,
          posts_per_run:         (d.posts_per_run          as number)         ?? 2,
          topics_per_run:        (d.topics_per_run         as number)         ?? 5,
          weeks_ahead:           (d.weeks_ahead            as number)         ?? 6,
          schedule_start_date:   (d.schedule_start_date    as string  | null) ?? null,
          auto_generate:         (d.auto_generate          as boolean)        ?? false,
          connection_id:         (d.connection_id          as string  | null) ?? null,
          default_author_id:     (d.default_author_id      as number  | null) ?? null,
          post_structure:        (d.post_structure          as string)         ?? '',
          target_length:         (d.target_length           as number)         ?? 1500,
          publish_time:          (d.publish_time            as string  | null) ?? null,
          topic_guidelines:      (d.topic_guidelines        as string  | null) ?? null,
          auto_approve_topics:   (d.auto_approve_topics      as boolean)        ?? false,
          auto_push_posts:       (d.auto_push_posts          as boolean)        ?? false,
        }
        setSchedule(loaded)
        // Collapsed by default if already configured
        setScheduleOpen(!loaded.schedule_frequency || !loaded.schedule_start_date)
        setModalStartDate(d.schedule_start_date ? String(d.schedule_start_date) : today())
        setModalWeeks((d.weeks_ahead as number) ?? 6)
        setSchedLoading(false)
      })
      .catch(() => setSchedLoading(false))
  }, [clientId])

  // ── Auto-set connection_id ─────────────────────────────────────────────────
  useEffect(() => {
    if (!schedule.connection_id && clientSites[0]?.connectionId) {
      setSched('connection_id', clientSites[0].connectionId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSites])

  // ── Load authors ───────────────────────────────────────────────────────────
  useEffect(() => {
    const connId = clientSites[0]?.connectionId
    if (!connId) { setAuthors([]); return }
    fetch(`/api/admin/wordpress/authors?connection_id=${connId}`)
      .then(r => r.json())
      .then((d: { authors?: Author[] } | { error: string }) => {
        if ('authors' in d && Array.isArray(d.authors)) setAuthors(d.authors)
      })
      .catch(() => setAuthors([]))
  }, [clientSites])

  // ── Load topics and posts ──────────────────────────────────────────────────
  const loadPipeline = useCallback(() => {
    setDataLoading(true)
    Promise.all([
      fetch(`/api/admin/content/topics?client_id=${clientId}`).then(r => r.json()),
      fetch(`/api/admin/content/posts?client_id=${clientId}`).then(r => r.json()),
    ]).then(([topicsData, postsData]) => {
      setTopics(Array.isArray(topicsData) ? topicsData as Topic[] : [])
      setPosts(Array.isArray(postsData)   ? postsData   as Post[] : [])
      setDataLoading(false)
    }).catch(() => setDataLoading(false))
  }, [clientId])

  useEffect(() => { loadPipeline() }, [loadPipeline])

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(msg: string, type: 'success' | 'error' | 'info' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3800)
  }

  // ── Schedule helpers ───────────────────────────────────────────────────────
  function setSched<K extends keyof ClientScheduleSettings>(key: K, val: ClientScheduleSettings[K]) {
    setSchedule(p => ({ ...p, [key]: val }))
  }

  async function saveSchedule() {
    setSchedSaving(true); setSchedError(''); setSchedSaved(false)
    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, ...schedule }),
    })
    setSchedSaving(false)
    if (res.ok) { setSchedSaved(true); setTimeout(() => setSchedSaved(false), 2500) }
    else { const d = await res.json(); setSchedError(d.error || 'Failed to save') }
  }

  // ── Topic actions ──────────────────────────────────────────────────────────
  async function regenerateTopic(id: string) {
    setTopicLoading(p => ({ ...p, [id]: true }))
    const res = await fetch(`/api/admin/content/topics/${id}/regenerate`, { method: 'POST' })
    setTopicLoading(p => ({ ...p, [id]: false }))
    if (res.ok) {
      const updated = await res.json() as Topic
      setTopics(p => p.map(t => t.id === id ? { ...t, ...updated } : t))
      showToast('New idea generated')
    } else {
      showToast((await res.json()).error || 'Regeneration failed', 'error')
    }
  }

  async function topicAction(id: string, status: 'approved' | 'rejected') {
    setTopicLoading(p => ({ ...p, [id]: true }))
    const res = await fetch(`/api/admin/content/topics/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setTopicLoading(p => ({ ...p, [id]: false }))
    if (res.ok) {
      setTopics(p => p.map(t => t.id === id ? { ...t, status } : t))
      showToast(status === 'approved' ? 'Topic approved' : 'Topic rejected')
    } else {
      showToast('Action failed', 'error')
    }
  }

  function generatePost(topicId: string) {
    setTopics(prev => prev.map(t => t.id === topicId ? { ...t, status: 'generating' } : t))
    showToast('Post generation started — check back shortly', 'info')
    fetch('/api/admin/content/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: topicId, suppress_email: true }),
    }).catch(e => console.error('[generatePost]', e))
  }

  function generateForSlot(dateKey: string, group: Topic[]) {
    const approved = group.filter(t => t.status === 'approved')
    if (!approved.length) return
    setSlotGenerating(p => ({ ...p, [dateKey]: true }))
    setTopics(prev => prev.map(t => approved.find(a => a.id === t.id) ? { ...t, status: 'generating' } : t))
    showToast(`Generating ${approved.length} post${approved.length !== 1 ? 's' : ''}… check back shortly`, 'info')
    Promise.all(approved.map(t =>
      fetch('/api/admin/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: t.id, suppress_email: true }),
      }).catch(e => console.error('[generateForSlot]', e))
    )).finally(() => setSlotGenerating(p => ({ ...p, [dateKey]: false })))
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim()) { showToast('Title cannot be empty', 'error'); return }
    setTopicLoading(p => ({ ...p, [id]: true }))
    const res = await fetch(`/api/admin/content/topics/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: editTitle.trim(), edit_notes: editNotes.trim() || null }),
    })
    setTopicLoading(p => ({ ...p, [id]: false }))
    if (res.ok) {
      setTopics(p => p.map(t => t.id === id ? { ...t, topic: editTitle.trim(), edit_notes: editNotes.trim() || null } : t))
      setEditingId(null)
      showToast('Title updated')
    } else {
      showToast('Failed to update', 'error')
    }
  }

  function openEdit(t: Topic) {
    setEditTitle(t.topic)
    setEditNotes(t.edit_notes ?? '')
    setEditingId(t.id)
    setExpandedId(null)
  }

  // ── Generate calendar ──────────────────────────────────────────────────────
  async function generateCalendar(e: React.FormEvent) {
    e.preventDefault()
    setGenerating(true)
    const res = await fetch('/api/admin/content/calendar/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, start_date: modalStartDate, weeks_ahead: modalWeeks }),
    })
    const data = await res.json()
    setGenerating(false)
    if (res.ok) {
      setCalendarModalOpen(false)
      if (data.queued) {
        showToast(`Topics are generating in the background across ${data.slots?.length ?? modalWeeks} publish dates — check back shortly`, 'info')
        setTimeout(() => loadPipeline(), 5000)
      } else {
        showToast(`${data.count} topics generated across ${data.slots?.length ?? modalWeeks} publish dates`)
        loadPipeline()
      }
    } else {
      showToast(data.error || 'Generation failed', 'error')
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const postsPerRun  = schedule.posts_per_run  ?? 2
  const topicsPerRun = schedule.topics_per_run ?? 5
  const freqSummary  = schedule.schedule_frequency
    ? `${FREQ_LABEL[schedule.schedule_frequency] ?? schedule.schedule_frequency} · ${topicsPerRun} topic${topicsPerRun !== 1 ? 's' : ''}/run`
    : `${topicsPerRun} topic${topicsPerRun !== 1 ? 's' : ''}/run`
  const willCreate   = Math.min(modalWeeks * topicsPerRun, 50)
  const showDayPicker = schedule.schedule_frequency === 'weekly' || schedule.schedule_frequency === 'biweekly'
  const isConfigured  = !!(schedule.schedule_frequency && schedule.schedule_start_date)

  if (schedLoading) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
  }

  // ── Build unified row list ─────────────────────────────────────────────────
  // Group by publish date for the table. Each topic appears as a row.
  // Posts that are linked to a topic replace the topic row (they share the date).
  // Orphan posts (no linked topic) are shown under their publish date.

  // Build map of topic_id → post (via content_topics.post_id lookup)
  // We'll use the post's focus_topic field or the topic's post_id.
  // For simplicity: show ALL topics, and for each topic that has status 'generated',
  // also show its linked post (for_review/draft_saved/published).
  const topicIdToPost = new Map<string, Post>()
  // Match posts to topics via target_keyword + date heuristic (no direct FK in API response)
  // The cleanest way: show topics for active statuses, posts for terminal statuses.

  const allItems: RowItem[] = []
  const seenPostIds = new Set<string>()

  // Topics (all non-generated statuses + generated topics waiting for review)
  topics.forEach(t => {
    // Prefer matching via the FK join (topic.post.id) set by the generate route.
    // Fall back to keyword+date heuristic for legacy/orphan posts.
    const linkedPost = t.post?.id
      ? posts.find(p => p.id === t.post!.id)
      : posts.find(p =>
          p.target_keyword === t.target_keyword &&
          p.target_publish_date === t.target_publish_date &&
          !seenPostIds.has(p.id)
        )
    if (linkedPost) {
      seenPostIds.add(linkedPost.id)
      topicIdToPost.set(t.id, linkedPost)
    }
    allItems.push({ kind: 'topic', data: t })
  })

  // Orphan posts (not matched to any topic)
  posts.forEach(p => {
    if (!seenPostIds.has(p.id) && (p.status === 'draft_saved' || p.status === 'published' || p.status === 'for_review')) {
      allItems.push({ kind: 'post', data: p })
    }
  })

  // Group by publish date
  const groups = new Map<string, RowItem[]>()
  for (const item of allItems) {
    const date = item.kind === 'topic' ? (item.data.target_publish_date ?? 'unscheduled') : (item.data.target_publish_date ?? 'unscheduled')
    const arr = groups.get(date) ?? []
    arr.push(item)
    groups.set(date, arr)
  }

  // Published section (terminal posts)
  const publishedItems = allItems.filter(item =>
    item.kind === 'topic' ? false : (item.data.status === 'draft_saved' || item.data.status === 'published')
  )

  // Sort date keys: chronological, unscheduled last
  const dateKeys = Array.from(groups.keys())
    .filter(k => k !== 'unscheduled')
    .sort((a, b) => a.localeCompare(b))
  if (groups.has('unscheduled')) dateKeys.push('unscheduled')

  // Rejected count
  const rejectedCount = topics.filter(t => t.status === 'rejected').length
    + posts.filter(p => p.status === 'rejected').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION A — SCHEDULE CONFIGURATION (collapsible)
      ═══════════════════════════════════════════════════════════════════ */}
      <div>
        {/* Collapsed header — always visible */}
        <div
          className="card p-4 cursor-pointer select-none"
          onClick={() => setScheduleOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span style={{ fontSize: '0.9rem' }}>⚙</span>
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Schedule Configuration</span>
          <span style={{ flex: 1 }} />
          {schedule.auto_generate && (
            <span className="badge badge-green" style={{ fontSize: '0.62rem' }}>Auto</span>
          )}
          {isConfigured
            ? <span style={{ color: 'var(--green)', fontSize: '0.8rem', fontWeight: 600 }}>✓</span>
            : <span style={{ color: 'var(--amber)', fontSize: '0.75rem' }}>⚠ Not configured</span>
          }
          <span style={{ color: 'var(--text-faint)', fontSize: '0.72rem', marginLeft: 4 }}>
            {scheduleOpen ? '▲' : '▼'}
          </span>
        </div>

        {/* Expanded form */}
        {scheduleOpen && (
          <div className="card p-6 mt-1" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <p className="section-desc" style={{ marginTop: 0 }}>Controls how often content is generated and published for this client.</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                <Toggle checked={schedule.auto_generate ?? false} onChange={v => setSched('auto_generate', v)} />
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{schedule.auto_generate ? 'Auto-generate On' : 'Auto-generate Off'}</span>
              </label>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Start Date</Label>
                <input className="input" type="date" style={{ width: '100%' }} value={schedule.schedule_start_date ?? ''} onChange={e => setSched('schedule_start_date', e.target.value || null)} />
              </div>
              <div>
                <Label>Frequency</Label>
                <select className="input" value={schedule.schedule_frequency ?? ''} onChange={e => setSched('schedule_frequency', e.target.value || null)}>
                  <option value="">Use global default</option>
                  {FREQ_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {showDayPicker && (
                <div>
                  <Label>Day of Week</Label>
                  <select className="input" value={schedule.schedule_day_of_week ?? 1} onChange={e => setSched('schedule_day_of_week', Number(e.target.value))}>
                    {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}
              <div>
                <Label hint="topic ideas per cycle">Topics per Run</Label>
                <input className="input" type="number" min={1} max={20} value={schedule.topics_per_run ?? 5} onChange={e => setSched('topics_per_run', Number(e.target.value))} />
              </div>
              <div>
                <Label hint="posts that must be approved per cycle">Posts per Run</Label>
                <input className="input" type="number" min={1} max={10} value={schedule.posts_per_run ?? 2} onChange={e => setSched('posts_per_run', Number(e.target.value))} />
              </div>
              <div>
                <Label hint="how far ahead to plan topics">Weeks Ahead</Label>
                <input className="input" type="number" min={1} max={24} value={schedule.weeks_ahead ?? 6} onChange={e => setSched('weeks_ahead', Number(e.target.value))} />
              </div>
              <div>
                <Label>Target Word Count</Label>
                <input className="input" type="number" min={300} max={5000} step={100} value={schedule.target_length ?? 1500} onChange={e => setSched('target_length', Number(e.target.value))} />
              </div>
              <div>
                <Label hint="time posts are scheduled in WordPress">Publish Time</Label>
                <input className="input" type="time" value={schedule.publish_time ?? '09:00'} onChange={e => setSched('publish_time', e.target.value || null)} />
              </div>
              <div>
                <Label>Default Author</Label>
                <select className="input" value={schedule.default_author_id ?? ''} onChange={e => setSched('default_author_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Default —</option>
                  {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <Label hint="appended to the AI system prompt for this client">Custom Post Structure</Label>
              <textarea
                className="input"
                rows={4}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
                value={schedule.post_structure ?? ''}
                onChange={e => setSched('post_structure', e.target.value)}
                placeholder={`e.g.\nAlways link to at least 2 priority pages.\nInclude E-E-A-T signals: cite years of experience, named staff expertise.\nNever link to excluded pages.`}
              />
            </div>

            <div style={{ marginTop: '1rem' }}>
              <Label hint="keywords, topics, or angles the AI should never generate">Topic Guidelines & Restrictions</Label>
              <textarea
                className="input"
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
                value={schedule.topic_guidelines ?? ''}
                onChange={e => setSched('topic_guidelines', e.target.value || null)}
                placeholder="e.g. Avoid bad credit financing, payday loans, or any topics with negative brand associations. Do not generate topics targeting keywords below $5 CPC."
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)', lineHeight: 1.5 }}>
                Injected into the topic generation AI prompt. Use this to steer away from brand-sensitive keywords or topics outside the client&apos;s target market.
              </p>
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label className="flex items-center gap-2 cursor-pointer">
                <Toggle checked={schedule.auto_approve_topics ?? false} onChange={v => setSched('auto_approve_topics', v)} />
                <div>
                  <span className="text-sm" style={{ color: 'var(--text-secondary)', display: 'block', lineHeight: 1.3 }}>Auto-approve topics</span>
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Topics still pending 2 days before their review deadline are automatically approved.</span>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Toggle checked={schedule.auto_push_posts ?? false} onChange={v => setSched('auto_push_posts', v)} />
                <div>
                  <span className="text-sm" style={{ color: 'var(--text-secondary)', display: 'block', lineHeight: 1.3 }}>Auto-push posts to site</span>
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Generated posts not yet pushed will upload to WordPress 2 days before the publish date.</span>
                </div>
              </label>
            </div>

            <div className="flex items-center gap-3" style={{ marginTop: '1rem' }}>
              <button className="btn btn-primary" onClick={saveSchedule} disabled={schedSaving}>
                {schedSaving ? 'Saving…' : 'Save Schedule'}
              </button>
              {schedSaved  && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
              {schedError  && <span className="text-xs" style={{ color: 'var(--red)' }}>{schedError}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION B — CONTENT CALENDAR (unified table)
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="card p-6">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h4 className="section-title" style={{ margin: 0 }}>Content Calendar</h4>
          {aiConfigured ? (
            <button
              className="btn btn-primary"
              style={{ fontSize: '0.8125rem', padding: '0.375rem 0.875rem' }}
              onClick={() => setCalendarModalOpen(true)}
            >
              Generate Topics →
            </button>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>AI not configured</span>
          )}
        </div>

        {dataLoading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : allItems.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-faint)', padding: '1rem 0' }}>
            No topics yet — click &quot;Generate Topics&quot; to create your first content calendar.
          </p>
        ) : (
          <div>
            <table className="data-table" style={{ width: '100%', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 130 }} />
                <col />
                <col style={{ width: 110 }} />
                <col style={{ width: 130 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontWeight: 600, fontSize: '0.72rem' }}>Status</th>
                  <th style={{ textAlign: 'left', fontWeight: 600, fontSize: '0.72rem' }}>Title</th>
                  <th style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.72rem' }}>Publish Date</th>
                  <th style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.72rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dateKeys.map(dateKey => {
                  const group = (groups.get(dateKey) ?? []).filter(item => {
                    if (!showRejected) {
                      if (item.kind === 'topic' && item.data.status === 'rejected') return false
                      if (item.kind === 'post'  && item.data.status === 'rejected')  return false
                    }
                    // Hide terminal published/draft_saved posts from date groups (shown in Published section)
                    if (item.kind === 'post' && (item.data.status === 'draft_saved' || item.data.status === 'published')) return false
                    return true
                  })

                  if (group.length === 0) return null

                  // Slot approval progress (topics in this date group)
                  const topicsInGroup = group.filter(r => r.kind === 'topic').map(r => r.data as Topic)
                  const approvedInGroup    = topicsInGroup.filter(t => ['approved', 'generating', 'generated'].includes(t.status)).length
                  const generatableInGroup = topicsInGroup.filter(t => t.status === 'approved').length
                  // Slot ready = quota met AND there are approved-but-not-yet-generated topics to trigger
                  const slotReady = approvedInGroup >= postsPerRun && generatableInGroup > 0

                  return [
                    // Date section header row
                    <tr key={`hdr-${dateKey}`} style={{ background: 'var(--bg-subtle)' }}>
                      <td colSpan={4} style={{ padding: '5px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                            {dateKey === 'unscheduled' ? 'Unscheduled' : fmtDate(dateKey)}
                          </span>
                          {/* Approval dots */}
                          <div style={{ display: 'flex', gap: 3 }}>
                            {Array.from({ length: postsPerRun }).map((_, i) => (
                              <span key={i} style={{
                                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                                background: i < approvedInGroup ? 'var(--green)' : 'var(--border)',
                              }} />
                            ))}
                          </div>
                          <span style={{ fontSize: '0.68rem', color: slotReady ? 'var(--green)' : 'var(--text-faint)' }}>
                            {approvedInGroup}/{postsPerRun}{slotReady ? ' ✓' : ''}
                          </span>
                          {slotReady && (
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.65rem', padding: '1px 7px', color: 'var(--blue)', marginLeft: 4 }}
                              onClick={() => generateForSlot(dateKey, topicsInGroup)}
                              disabled={slotGenerating[dateKey]}
                            >
                              {slotGenerating[dateKey] ? '…' : '▶ Generate Slot'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>,

                    // Topic/post rows
                    ...group.map(item => {
                      const id = item.data.id
                      const isExpanded = expandedId === id
                      const isEditing  = editingId  === id

                      if (item.kind === 'topic') {
                        const t = item.data
                        const displayStatus = getTopicDisplayStatus(t)
                        const linkedPost    = topicIdToPost.get(t.id)
                        const hasDetail     = !!(t.keyword_opportunity || t.ranking_strategy || t.audience_intent || t.why_now || t.competition_level || t.page_to_support || t.competitors_researched)
                        const hasReview     = linkedPost && (linkedPost.status === 'for_review' || linkedPost.status === 'generated')

                        return [
                          <tr
                            key={`topic-${t.id}`}
                            style={{ cursor: hasDetail ? 'pointer' : 'default', background: isExpanded ? 'var(--bg-subtle)' : undefined }}
                            onClick={() => { if (hasDetail && !isEditing) setExpandedId(isExpanded ? null : id) }}
                          >
                            <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}>
                              <StatusPill status={displayStatus} generating={t.status === 'generating'} />
                            </td>
                            <td style={{ padding: '8px 8px', verticalAlign: 'middle' }}>
                              <div style={{ fontWeight: 500, fontSize: '0.8125rem', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {t.topic}
                                {hasDetail && <span style={{ fontSize: '0.6rem', marginLeft: 4, opacity: 0.5 }}>↗</span>}
                              </div>
                              {t.target_keyword && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>
                                  {t.target_keyword}
                                  {t.cluster_group && (
                                    <span style={{ marginLeft: 5, fontSize: '0.62rem', color: 'var(--text-faint)', background: 'var(--bg-muted)', padding: '0 4px', borderRadius: 3 }}>
                                      {t.cluster_group}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', verticalAlign: 'middle', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {fmtDate(t.target_publish_date)}
                            </td>
                            <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                                {/* Review post */}
                                {hasReview && (
                                  <button
                                    className="btn btn-primary"
                                    style={{ fontSize: '0.65rem', padding: '2px 7px' }}
                                    onClick={() => setReviewPost(linkedPost!)}
                                  >→ Review</button>
                                )}
                                {/* Generate post */}
                                {t.status === 'approved' && !hasReview && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ fontSize: '0.65rem', padding: '2px 7px', color: 'var(--blue)' }}
                                    onClick={() => generatePost(t.id)}
                                    title="Generate post now"
                                  >▶</button>
                                )}
                                {/* Approve */}
                                {!['approved', 'generating', 'generated'].includes(t.status) && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ fontSize: '0.72rem', padding: '2px 7px', color: 'var(--green)' }}
                                    onClick={() => topicAction(t.id, 'approved')}
                                    disabled={topicLoading[t.id]}
                                    title="Approve topic"
                                  >✓</button>
                                )}
                                {/* Edit title — not shown for generated posts (post already written, topic edit won't change it) */}
                                {!['generating', 'generated', 'rejected'].includes(t.status) && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ fontSize: '0.72rem', padding: '2px 7px', color: 'var(--text-muted)' }}
                                    onClick={() => isEditing ? setEditingId(null) : openEdit(t)}
                                    title="Edit title"
                                  >✏</button>
                                )}
                                {/* Regenerate */}
                                {!['generating', 'generated'].includes(t.status) && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ fontSize: '0.72rem', padding: '2px 7px', color: 'var(--text-muted)' }}
                                    onClick={() => regenerateTopic(t.id)}
                                    disabled={topicLoading[t.id]}
                                    title="Generate different topic idea"
                                  >↻</button>
                                )}
                                {/* Reject */}
                                {!['generating', 'generated'].includes(t.status) && t.status !== 'rejected' && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ fontSize: '0.72rem', padding: '2px 7px', color: 'var(--red)' }}
                                    onClick={() => topicAction(t.id, 'rejected')}
                                    disabled={topicLoading[t.id]}
                                    title="Reject topic"
                                  >✕</button>
                                )}
                              </div>
                            </td>
                          </tr>,

                          // Expanded detail row
                          isExpanded && (
                            <tr key={`expand-${t.id}`}>
                              <td colSpan={4} style={{ padding: '0 0 12px 0', background: 'var(--bg-subtle)' }}>
                                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {([
                                    { key: 'keyword_opportunity' as const, label: 'Keyword Opportunity', color: '#2563eb', bg: '#eff6ff' },
                                    { key: 'ranking_strategy'    as const, label: 'Ranking Strategy',    color: '#7c3aed', bg: '#f5f3ff' },
                                    { key: 'audience_intent'     as const, label: 'Audience Intent',     color: '#059669', bg: '#f0fdf4' },
                                    { key: 'why_now'             as const, label: 'Why Now',             color: '#d97706', bg: '#fffbeb' },
                                    { key: 'competition_level'   as const, label: 'Competition',         color: '#dc2626', bg: '#fef2f2' },
                                  ] as const).filter(s => t[s.key]).map(({ key, label, color, bg }) => (
                                    <div key={key} style={{ borderLeft: `3px solid ${color}`, background: bg, borderRadius: '0 4px 4px 0', padding: '4px 8px' }}>
                                      <p style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color, marginBottom: 2 }}>{label}</p>
                                      <p style={{ fontSize: '0.78rem', color: '#374151', lineHeight: 1.4 }}>{t[key]}</p>
                                    </div>
                                  ))}
                                  {t.page_to_support && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                      <span style={{ fontWeight: 600 }}>Supporting: </span>
                                      <a href={t.page_to_support} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>{t.page_to_support}</a>
                                    </div>
                                  )}
                                  {t.competitors_researched && t.competitors_researched.urls.length > 0 && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                      <span style={{ fontWeight: 600 }}>Competitors researched: </span>
                                      {t.competitors_researched.urls.map((u, i) => (
                                        <span key={i}>
                                          <a href={u} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>
                                            {new URL(u).hostname.replace('www.', '')}
                                          </a>
                                          {i < t.competitors_researched!.urls.length - 1 ? ', ' : ''}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {typeof t.seo_brief?.cannibalization_warning === 'string' && t.seo_brief.cannibalization_warning && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--amber)', background: 'var(--amber-subtle)', padding: '4px 8px', borderRadius: 4 }}>
                                      ⚠ {t.seo_brief.cannibalization_warning}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ),

                          // Inline edit row
                          isEditing && (
                            <tr key={`edit-${t.id}`}>
                              <td colSpan={4} style={{ padding: '4px 0 12px 0', background: 'var(--bg-subtle)' }}>
                                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <input
                                    className="input"
                                    value={editTitle}
                                    onChange={e => setEditTitle(e.target.value)}
                                    placeholder="Topic title"
                                    style={{ fontSize: '0.875rem' }}
                                    autoFocus
                                  />
                                  <textarea
                                    className="input"
                                    rows={2}
                                    value={editNotes}
                                    onChange={e => setEditNotes(e.target.value)}
                                    placeholder="Direction notes (optional) — tell the AI what angle to take if regenerating"
                                    style={{ fontSize: '0.8125rem', resize: 'vertical' }}
                                  />
                                  {t.status === 'generated' && (
                                    <p style={{ fontSize: '0.72rem', color: 'var(--amber)' }}>
                                      ⚠ This topic has a generated post — editing the title will not regenerate the post automatically.
                                    </p>
                                  )}
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                      className="btn btn-primary"
                                      style={{ fontSize: '0.75rem' }}
                                      onClick={() => saveEdit(t.id)}
                                      disabled={topicLoading[t.id]}
                                    >
                                      Save
                                    </button>
                                    <button
                                      className="btn btn-secondary"
                                      style={{ fontSize: '0.75rem' }}
                                      onClick={() => setEditingId(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ),
                        ].filter(Boolean)
                      }

                      // Post row (for_review only in date groups)
                      const p = item.data as Post
                      const displayStatus = getPostDisplayStatus(p)
                      const siteUrl = p.status === 'published'
                        ? p.published_url
                        : p.wp_post_id && p.wp_site_url
                          ? `${p.wp_site_url.replace(/\/$/, '')}/?p=${p.wp_post_id}`
                          : p.bc_post_id && p.bc_store_hash
                            ? `https://store-${p.bc_store_hash}.mybigcommerce.com/manage/site/content`
                            : null

                      return (
                        <tr key={`post-${p.id}`}>
                          <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}>
                            <StatusPill status={displayStatus} />
                          </td>
                          <td style={{ padding: '8px', verticalAlign: 'middle' }}>
                            <div style={{ fontWeight: 500, fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.title ?? '(generating…)'}
                            </div>
                            {p.target_keyword && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>{p.target_keyword}</div>
                            )}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', verticalAlign: 'middle', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {fmtDate(p.target_publish_date)}
                          </td>
                          <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              {p.seo_score && (
                                <span style={{ fontSize: '0.65rem', fontWeight: 600, color: scoreColor(p.seo_score), padding: '2px 0' }}>
                                  SEO:{p.seo_score.overall}
                                </span>
                              )}
                              {p.status === 'for_review' && (
                                <button
                                  className="btn btn-primary"
                                  style={{ fontSize: '0.65rem', padding: '2px 7px' }}
                                  onClick={() => setReviewPost(p)}
                                >→ Review</button>
                              )}
                              {siteUrl && p.status !== 'for_review' && (
                                <a href={siteUrl} target="_blank" rel="noreferrer"
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.65rem', padding: '2px 7px' }}>
                                  ↗ View
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    }).flat(),
                  ]
                }).filter(Boolean)}

                {/* Published section */}
                {publishedItems.length > 0 && [
                  <tr key="hdr-published" style={{ background: 'var(--bg-subtle)' }}>
                    <td colSpan={4} style={{ padding: '5px 8px' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-primary)' }}>Published</span>
                    </td>
                  </tr>,
                  ...publishedItems.map(item => {
                    const p = item.data as Post
                    const siteUrl = p.published_url
                      ?? (p.wp_post_id && p.wp_site_url ? `${p.wp_site_url.replace(/\/$/, '')}/?p=${p.wp_post_id}` : null)
                    return (
                      <tr key={`pub-${p.id}`}>
                        <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}>
                          <StatusPill status="published" />
                        </td>
                        <td style={{ padding: '8px', verticalAlign: 'middle' }}>
                          <div style={{ fontWeight: 500, fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.title ?? '(untitled)'}
                          </div>
                          {p.target_keyword && <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>{p.target_keyword}</div>}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right', verticalAlign: 'middle', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {fmtDate(p.target_publish_date)}
                        </td>
                        <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', verticalAlign: 'middle' }}>
                          {siteUrl && (
                            <a href={siteUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: '0.65rem', padding: '2px 7px' }}>
                              ↗ Live
                            </a>
                          )}
                        </td>
                      </tr>
                    )
                  }),
                ]}
              </tbody>
            </table>

            {/* Rejected toggle */}
            {rejectedCount > 0 && (
              <button
                style={{ marginTop: 10, fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                onClick={() => setShowRejected(r => !r)}
              >
                {showRejected ? 'Hide' : 'Show'} Rejected ({rejectedCount})
              </button>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION C — MANUAL POST EDITOR (collapsed)
      ═══════════════════════════════════════════════════════════════════ */}
      <details className="card" style={{ overflow: 'hidden' }}>
        <summary className="p-5 cursor-pointer font-semibold text-sm" style={{ color: 'var(--text-primary)', listStyle: 'none' }}>
          ▸ Manual Post Editor
        </summary>
        <div className="p-5 pt-0" style={{ borderTop: '1px solid var(--border)' }}>
          {aiConfigured ? (
            <ManualPostStub clientId={clientId} clientName={clientName} sites={clientSites} />
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Configure an AI provider in Agency Settings to use the manual editor.</p>
          )}
        </div>
      </details>

      {/* ═══════════════════════════════════════════════════════════════════
          GENERATE CALENDAR MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      {calendarModalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.4)', backdropFilter: 'blur(2px)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setCalendarModalOpen(false)}
        >
          <div
            style={{ background: 'var(--bg-surface)', borderRadius: '0.75rem', width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.18)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.125rem 1.375rem', borderBottom: '1px solid var(--border)' }}>
              <span className="font-semibold text-sm">Generate SEO Content Calendar</span>
              <button type="button" onClick={() => setCalendarModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '1rem' }}>✕</button>
            </div>
            <form onSubmit={generateCalendar} style={{ padding: '1.375rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div>
                  <Label>Start Date</Label>
                  <input className="input" type="date" style={{ width: '100%' }} value={modalStartDate} onChange={e => setModalStartDate(e.target.value)} required />
                </div>
                <div>
                  <Label>Weeks Ahead</Label>
                  <input className="input" type="number" min={1} max={24} style={{ width: '100%' }} value={modalWeeks} onChange={e => setModalWeeks(Number(e.target.value))} required />
                </div>
                <div style={{ borderRadius: '0.375rem', padding: '0.625rem 0.875rem', background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--blue)', marginBottom: '0.25rem' }}>
                    <strong>Using:</strong> {freqSummary}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--blue)' }}>
                    <strong>Will create:</strong> {willCreate} topic{willCreate !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem', marginTop: '1.25rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCalendarModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={generating}>
                  {generating ? 'Generating…' : 'Generate →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TOAST
      ═══════════════════════════════════════════════════════════════════ */}
      {toast && (
        <div id="content-toast-container">
          <div className={`content-toast content-toast--${toast.type}`}>{toast.msg}</div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          POST REVIEW EDITOR
      ═══════════════════════════════════════════════════════════════════ */}
      {reviewPost && (
        <ContentPostEditor
          postId={reviewPost.id}
          defaultConnectionId={schedule.connection_id ?? null}
          sites={clientSites}
          onClose={() => setReviewPost(null)}
          onUpdate={() => { setReviewPost(null); loadPipeline() }}
        />
      )}
    </div>
  )
}

// ─── Manual Post Stub ─────────────────────────────────────────────────────────

function ManualPostStub({ clientId, clientName, sites }: { clientId: string; clientName: string; sites: SiteOption[] }) {
  const [show, setShow] = useState(false)
  if (!show) {
    return (
      <div style={{ padding: '1rem 0' }}>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>Write or generate a one-off post for {clientName} without going through the topic → approval flow.</p>
        <button className="btn btn-secondary" onClick={() => setShow(true)}>Open Editor</button>
      </div>
    )
  }
  // Lazy import to keep initial bundle light
  const ContentEditorWrapper = require('@/app/admin/(app)/content/ContentEditor').default
  return <ContentEditorWrapper sites={sites} aiConfigured={true} preselectedClientId={clientId} />
}
