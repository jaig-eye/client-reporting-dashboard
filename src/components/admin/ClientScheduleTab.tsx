'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ClientScheduleSettings, SiteOption, SeoScore } from '@/lib/content/types'
import ContentPostEditor from '@/components/admin/ContentPostEditor'
import ContentStatusBar, { computeStatusCounts } from '@/components/admin/ContentStatusBar'
import { Check, X, PencilSimple, ArrowClockwise, Play, ArrowRight } from '@phosphor-icons/react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SaSettings {
  connection_id?:      string | null
  slug_structure?:     string
  wp_publish_mode?:    string
  target_length?:      number
  location_notes?:     string
  pages_per_run?:      number
  schedule_frequency?: string | null
  schedule_day_of_week?: number | null
  default_author_id?:  number | null
  auto_generate?:      boolean
  auto_approve_pages?: boolean
  auto_push_pages?:    boolean
  service_pages?:      { url: string; name: string; wp_page_id?: number }[]
  service_areas?:      { city: string; state: string; priority?: string; skip?: boolean }[]
  primary_service?:    string
}

interface SaTopic {
  id:                  string
  city:                string | null
  state_abbr:          string | null
  service_name:        string | null
  status:              string
  created_at:          string
  target_publish_date: string | null
  generation_error?:   string | null
  post?:               { id: string; status: string; published_url: string | null } | null
}

interface SaDiscoverySuggestion {
  city:                  string
  state:                 string
  service_name:          string
  rationale:             string
  estimated_opportunity: 'high' | 'medium' | 'low'
}

interface SaPost {
  id:                  string
  title:               string | null
  status:              string
  published_url:       string | null
  target_publish_date: string | null
  city:                string | null
  state_abbr:          string | null
  service_name:        string | null
}

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
  generation_error?:     string | null
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
  isActive?:    boolean
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
  generated:  { label: 'Ready for Review',  bg: 'var(--green-subtle)',  color: 'var(--green)',   dot: '#10b981' },
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

export default function ClientScheduleTab({ clientId, clientName, sites, aiConfigured, isActive = true }: Props) {
  const clientSites = sites.filter(s => s.clientId === clientId)

  // Schedule form state
  const [schedule,     setSchedule]     = useState<Partial<ClientScheduleSettings>>({})
  const [authors,      setAuthors]      = useState<Author[]>([])
  const [schedSaving,  setSchedSaving]  = useState(false)
  const [schedSaved,   setSchedSaved]   = useState(false)
  const [schedError,   setSchedError]   = useState('')
  const [schedLoading, setSchedLoading] = useState(true)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  // Image generation — separate state (new columns not in ClientScheduleSettings type)
  const [imageGen,    setImageGen]    = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')

  // Pill: Blog Posts vs Service Pages
  const [activePill, setActivePill] = useState<'blog' | 'service'>('blog')

  // Pipeline data
  const [topics,      setTopics]      = useState<Topic[]>([])
  const [posts,       setPosts]       = useState<Post[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [reviewPost,    setReviewPost]    = useState<Post | null>(null)
  const [reviewSaPost,  setReviewSaPost]  = useState<{ id: string } | null>(null)

  // ── Service Area state ─────────────────────────────────────────────────────
  const [saSettings,     setSaSettings]     = useState<SaSettings>({})
  const [saSettingsOpen, setSaSettingsOpen] = useState(false)
  const [saLoading,      setSaLoading]      = useState(true)
  const [saSaving,       setSaSaving]       = useState(false)
  const [saSaved,        setSaSaved]        = useState(false)
  const [saError,        setSaError]        = useState('')
  const [saTopics,       setSaTopics]       = useState<SaTopic[]>([])
  const [saTopicsLoading, setSaTopicsLoading] = useState(false)
  const [saTopicAction,  setSaTopicAction]  = useState<Record<string, boolean>>({})
  const [saPosts,        setSaPosts]        = useState<SaPost[]>([])
  const [saPostsLoading, setSaPostsLoading] = useState(false)
  const [saDiscovering,  setSaDiscovering]  = useState(false)
  const [saSuggestions,  setSaSuggestions]  = useState<SaDiscoverySuggestion[]>([])
  const [saAddCity,      setSaAddCity]      = useState('')
  const [saAddState,     setSaAddState]     = useState('')
  const [saAddService,   setSaAddService]   = useState('')
  const [saAddOpen,      setSaAddOpen]      = useState(false)

  // Polling ref — cleared on unmount to avoid state updates on dead component
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const topicsRef  = useRef<Topic[]>([])
  useEffect(() => { topicsRef.current = topics }, [topics])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // Close position:fixed modals when this tab becomes hidden (keep-alive pattern).
  // position:fixed children escape display:none containment in CSS, so we must
  // explicitly close them to prevent invisible overlays from absorbing pointer events.
  useEffect(() => {
    if (!isActive) {
      setCalendarModalOpen(false)
      setSaCalendarModalOpen(false)
      setReviewPost(null)
      setReviewSaPost(null)
    }
  }, [isActive])

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

  // SA calendar modal
  const [saCalendarModalOpen, setSaCalendarModalOpen] = useState(false)
  const [saModalStartDate,    setSaModalStartDate]    = useState(today())
  const [saModalWeeks,        setSaModalWeeks]        = useState(8)
  const [saGenerating,        setSaGenerating]        = useState(false)

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
          wp_publish_mode:       ((d.wp_publish_mode as string | null) === 'draft_only' ? 'draft_only' : 'scheduled_draft') as 'scheduled_draft' | 'draft_only',
          topic_guidelines:      (d.topic_guidelines        as string  | null) ?? null,
          auto_approve_topics:   (d.auto_approve_topics      as boolean)        ?? false,
          auto_push_posts:       (d.auto_push_posts          as boolean)        ?? false,
        }
        setSchedule(loaded)
        // Always collapsed by default
        setScheduleOpen(false)
        setImageGen(!!(d.content_image_generation as boolean | null))
        setImagePrompt(String(d.content_image_prompt ?? ''))
        setModalStartDate(d.schedule_start_date ? String(d.schedule_start_date) : today())
        setModalWeeks((d.weeks_ahead as number) ?? 6)
        setSchedLoading(false)
      })
      .catch(() => setSchedLoading(false))
  }, [clientId])

  // ── Load SA settings + topics ──────────────────────────────────────────────
  const [saSettingsError, setSaSettingsError] = useState('')
  const [saTopicsError,   setSaTopicsError]   = useState('')

  useEffect(() => {
    setSaLoading(true); setSaSettingsError('')
    fetch(`/api/admin/content/service-area-settings?client_id=${clientId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((d: SaSettings) => { setSaSettings(d); setSaLoading(false) })
      .catch(e => { setSaSettingsError(String(e)); setSaLoading(false) })
  }, [clientId])

  const loadSaTopics = useCallback(() => {
    setSaTopicsLoading(true); setSaTopicsError('')
    fetch(`/api/admin/content/topics?client_id=${clientId}&content_type=service_area`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((d: SaTopic[]) => { setSaTopics(Array.isArray(d) ? d : []); setSaTopicsLoading(false) })
      .catch(e => { setSaTopicsError(String(e)); setSaTopicsLoading(false) })
  }, [clientId])

  async function retrySaGenerate(topicId: string) {
    // Reset error and set back to approved so retry works
    await fetch(`/api/admin/content/topics/${topicId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', generation_error: null }),
    })
    setSaTopics(p => p.map(t => t.id === topicId ? { ...t, status: 'approved', generation_error: null } : t))
    generateSaPost(topicId)
  }

  const loadSaPosts = useCallback(() => {
    setSaPostsLoading(true)
    fetch(`/api/admin/content/posts?client_id=${clientId}&content_type=service_area`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((d: SaPost[]) => { setSaPosts(Array.isArray(d) ? d : []); setSaPostsLoading(false) })
      .catch(() => setSaPostsLoading(false))
  }, [clientId])

  useEffect(() => { loadSaTopics(); loadSaPosts() }, [loadSaTopics, loadSaPosts])

  const firstConnectionId = clientSites[0]?.connectionId ?? null

  // ── Auto-set connection_id ─────────────────────────────────────────────────
  useEffect(() => {
    if (!schedule.connection_id && firstConnectionId) {
      setSched('connection_id', firstConnectionId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstConnectionId])

  // ── Load authors ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!firstConnectionId) { setAuthors([]); return }
    fetch(`/api/admin/wordpress/authors?connection_id=${firstConnectionId}`)
      .then(r => r.json())
      .then((d: { authors?: Author[] } | { error: string }) => {
        if ('authors' in d && Array.isArray(d.authors)) setAuthors(d.authors)
      })
      .catch(() => setAuthors([]))
  }, [firstConnectionId])

  // ── Load topics and posts ──────────────────────────────────────────────────
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
      body: JSON.stringify({ client_id: clientId, ...schedule, content_image_generation: imageGen, content_image_prompt: imagePrompt || null }),
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

  async function retryGenerate(topicId: string) {
    setTopicLoading(p => ({ ...p, [topicId]: true }))
    await fetch(`/api/admin/content/topics/${topicId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    setTopics(prev => prev.map(t => t.id === topicId ? { ...t, status: 'approved', generation_error: null } : t))
    setTopicLoading(p => ({ ...p, [topicId]: false }))
    generatePost(topicId)
  }

  const statusCounts = useMemo(() => computeStatusCounts(topics, posts), [topics, posts])

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

  // ── Service Area helpers ───────────────────────────────────────────────────
  function setSa<K extends keyof SaSettings>(key: K, val: SaSettings[K]) {
    setSaSettings(p => ({ ...p, [key]: val }))
  }

  async function saveSaSettings() {
    setSaSaving(true); setSaError(''); setSaSaved(false)
    const res = await fetch(`/api/admin/content/service-area-settings?client_id=${clientId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(saSettings),
    })
    setSaSaving(false)
    if (res.ok) { setSaSaved(true); setTimeout(() => setSaSaved(false), 2500) }
    else { const d = await res.json(); setSaError(d.error || 'Failed to save') }
  }

  async function saTopicAction_fn(id: string, status: 'approved' | 'rejected') {
    setSaTopicAction(p => ({ ...p, [id]: true }))
    const res = await fetch(`/api/admin/content/topics/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setSaTopicAction(p => ({ ...p, [id]: false }))
    if (res.ok) {
      setSaTopics(p => p.map(t => t.id === id ? { ...t, status } : t))
    } else {
      showToast('Action failed', 'error')
    }
  }

  async function generateSaPost(topicId: string) {
    setSaTopics(p => p.map(t => t.id === topicId ? { ...t, status: 'generating' } : t))
    showToast('Service area page generation started…', 'info')
    fetch('/api/admin/content/service-area/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: topicId }),
    }).catch(e => console.error('[generateSaPost]', e))
  }

  async function discoverSaAreas() {
    setSaDiscovering(true); setSaSuggestions([])
    const res = await fetch('/api/admin/content/service-area/discover', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    })
    const d = await res.json() as { suggestions?: SaDiscoverySuggestion[] }
    setSaDiscovering(false)
    if (res.ok) {
      setSaSuggestions(d.suggestions ?? [])
      if (!d.suggestions?.length) showToast('No new service areas found', 'info')
    } else {
      showToast('Discovery failed', 'error')
    }
  }

  async function addSaTopic() {
    if (!saAddCity.trim() || !saAddState.trim()) return
    const sn = saAddService.trim() || saSettings.primary_service || 'Service'
    const res = await fetch('/api/admin/content/topics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, content_type: 'service_area', city: saAddCity.trim(), state_abbr: saAddState.trim().toUpperCase().slice(0, 2), service_name: sn }),
    })
    if (res.ok) {
      setSaAddCity(''); setSaAddState(''); setSaAddService(''); setSaAddOpen(false)
      loadSaTopics()
      showToast('Service area added to queue')
    } else {
      showToast('Failed to add', 'error')
    }
  }

  async function addSuggestionToQueue(s: SaDiscoverySuggestion) {
    const res = await fetch('/api/admin/content/topics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, content_type: 'service_area', city: s.city, state_abbr: s.state, service_name: s.service_name }),
    })
    if (res.ok) {
      setSaSuggestions(p => p.filter(x => !(x.city === s.city && x.state === s.state)))
      loadSaTopics()
      showToast(`${s.city}, ${s.state} added to queue`)
    } else {
      showToast('Failed to add', 'error')
    }
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
        showToast(`Topics are generating — they'll appear here automatically`, 'info')
        // Poll every 15 s for up to 3 minutes. Stop early once new topics appear.
        const prevCount = topicsRef.current.length
        let polls = 0
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = setInterval(() => {
          polls++
          loadPipeline()
          const done = topicsRef.current.length > prevCount || polls >= 12
          if (done) {
            clearInterval(pollRef.current!)
            pollRef.current = null
            if (topicsRef.current.length > prevCount)
              showToast(`${topicsRef.current.length - prevCount} topics generated`, 'success')
          }
        }, 15_000)
      } else {
        showToast(`${data.count} topics generated across ${data.slots?.length ?? modalWeeks} publish dates`)
        loadPipeline()
      }
    } else {
      showToast(data.error || 'Generation failed', 'error')
    }
  }

  // ── SA calendar generation ─────────────────────────────────────────────────
  async function generateSaCalendar(e: React.FormEvent) {
    e.preventDefault()
    setSaGenerating(true)
    const res = await fetch('/api/admin/content/service-area/calendar/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, start_date: saModalStartDate, weeks_ahead: saModalWeeks }),
    })
    const data = await res.json()
    setSaGenerating(false)
    if (res.ok) {
      setSaCalendarModalOpen(false)
      showToast(`${data.count} service area page${data.count !== 1 ? 's' : ''} scheduled across ${data.slots?.length ?? saModalWeeks} dates`)
      loadSaTopics()
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

  // Published section (terminal posts) — only show posts published within last 28 days
  const cutoff28 = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const publishedItems = allItems.filter(item => {
    if (item.kind === 'topic') return false
    const p = item.data as Post
    if (p.status !== 'draft_saved' && p.status !== 'published') return false
    return !p.target_publish_date || p.target_publish_date >= cutoff28
  })

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

      {/* ── Pill switcher: Blog Posts / Service Pages ───────────────────── */}
      <div style={{ display: 'flex', gap: 4, padding: '3px', background: 'var(--bg-subtle)', borderRadius: 8, alignSelf: 'flex-start', border: '1px solid var(--border)' }}>
        {(['blog', 'service'] as const).map(pill => (
          <button
            key={pill}
            onClick={() => setActivePill(pill)}
            style={{
              padding: '0.3125rem 0.875rem',
              fontSize: '0.8125rem',
              fontWeight: activePill === pill ? 600 : 400,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: activePill === pill ? 'var(--bg-surface, #fff)' : 'transparent',
              color: activePill === pill ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: activePill === pill ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {pill === 'blog' ? 'Blog Posts' : 'Service Pages'}
            {pill === 'blog' && !!schedule.auto_generate && (
              <span className="badge badge-green" style={{ fontSize: '0.55rem', marginLeft: 5, verticalAlign: 'middle' }}>Auto</span>
            )}
            {pill === 'service' && (!!saSettings.auto_generate) && (
              <span className="badge badge-green" style={{ fontSize: '0.55rem', marginLeft: 5, verticalAlign: 'middle' }}>Auto</span>
            )}
          </button>
        ))}
      </div>

      {activePill === 'blog' && <>

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
          <div className="card p-5 mt-1" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
            <div className="grid grid-cols-3 gap-3" style={{ marginBottom: '0.75rem' }}>
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
                <Label>Topics per Run</Label>
                <input className="input" type="number" min={1} max={20} value={schedule.topics_per_run ?? 5} onChange={e => setSched('topics_per_run', Number(e.target.value))} />
              </div>
              <div>
                <Label>Posts per Run</Label>
                <input className="input" type="number" min={1} max={10} value={schedule.posts_per_run ?? 2} onChange={e => setSched('posts_per_run', Number(e.target.value))} />
              </div>
              <div>
                <Label>Weeks Ahead</Label>
                <input className="input" type="number" min={1} max={24} value={schedule.weeks_ahead ?? 6} onChange={e => setSched('weeks_ahead', Number(e.target.value))} />
              </div>
              <div>
                <Label>Target Word Count</Label>
                <input className="input" type="number" min={300} max={5000} step={100} value={schedule.target_length ?? 1500} onChange={e => setSched('target_length', Number(e.target.value))} />
              </div>
              <div>
                <Label>Publish Time</Label>
                <input className="input" type="time" value={schedule.publish_time ?? '09:00'} onChange={e => setSched('publish_time', e.target.value || null)} />
              </div>
              <div>
                <Label>Default Author</Label>
                <select className="input" value={schedule.default_author_id ?? ''} onChange={e => setSched('default_author_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Default —</option>
                  {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <Label>WordPress Publish Mode</Label>
                <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.375rem' }}>
                  {(['scheduled_draft', 'draft_only'] as const).map(mode => (
                    <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8125rem' }}>
                      <input type="radio" name="wp_publish_mode" value={mode} checked={(schedule.wp_publish_mode ?? 'scheduled_draft') === mode} onChange={() => setSched('wp_publish_mode', mode)} />
                      {mode === 'scheduled_draft' ? 'Scheduled Draft' : 'Draft Only'}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <Label>Custom Post Structure</Label>
              <textarea
                className="input"
                rows={3}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
                value={schedule.post_structure ?? ''}
                onChange={e => setSched('post_structure', e.target.value)}
                placeholder={`e.g.\nAlways link to at least 2 priority pages.\nInclude E-E-A-T signals: cite years of experience, named staff expertise.`}
              />
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <Label>Topic Guidelines & Restrictions</Label>
              <textarea
                className="input"
                rows={2}
                style={{ width: '100%', resize: 'vertical' }}
                value={schedule.topic_guidelines ?? ''}
                onChange={e => setSched('topic_guidelines', e.target.value || null)}
                placeholder="e.g. Avoid bad credit financing, payday loans, or any topics with negative brand associations."
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '0.75rem' }}>
              {/* Auto Generate consolidates auto_generate, auto_approve_topics, and auto_push_posts */}
              <label className="flex items-center gap-3 cursor-pointer">
                <Toggle
                  checked={schedule.auto_generate ?? false}
                  onChange={v => { setSched('auto_generate', v); setSched('auto_approve_topics', v); setSched('auto_push_posts', v) }}
                />
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Auto Generate — generates, approves, and publishes automatically</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <Toggle checked={imageGen} onChange={setImageGen} />
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Generate featured image with AI</span>
              </label>
              {imageGen && (
                <input
                  className="input"
                  value={imagePrompt}
                  onChange={e => setImagePrompt(e.target.value)}
                  placeholder="e.g. Outdoor lifestyle photo, warm tones, no text overlays"
                  style={{ fontSize: '0.8125rem', marginLeft: '2.25rem' }}
                />
              )}
            </div>

            <div className="flex items-center gap-3">
              <button className="btn btn-primary" onClick={saveSchedule} disabled={schedSaving}>
                {schedSaving ? 'Saving…' : 'Save Schedule'}
              </button>
              {schedSaved  && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
              {schedError  && <span className="text-xs" style={{ color: 'var(--red)' }}>{schedError}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── AI Content Plan card ─────────────────────────────────────────── */}
      {aiConfigured ? (
        <div className="card" style={{ borderLeft: '3px solid var(--accent, #2563eb)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-subtle, #eff6ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #2563eb)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>AI Content Plan</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Generate {schedule.topics_per_run ?? 5} {FREQ_LABEL[schedule.schedule_frequency ?? 'weekly'] ?? 'weekly'} topics for your next {schedule.weeks_ahead ?? 1} publish slot{(schedule.weeks_ahead ?? 1) > 1 ? 's' : ''}
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setCalendarModalOpen(true)} style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
            Generate Plan
          </button>
        </div>
      ) : (
        <div style={{ padding: '10px 14px', marginBottom: 12, fontSize: '0.8125rem', color: 'var(--text-faint)', background: 'var(--bg-subtle)', borderRadius: 6, border: '1px solid var(--border)' }}>
          AI not configured — add a provider in Settings to generate content plans
        </div>
      )}

      {/* ── Publish to sites row ─────────────────────────────────────────── */}
      {clientSites.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Publish to:</span>
          {clientSites.map(site => (
            <span key={site.connectionId} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              border: '1px solid var(--border)', borderRadius: 4,
              padding: '3px 8px', fontSize: '0.75rem', color: 'var(--text-secondary)',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
              {site.siteName}
            </span>
          ))}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION B — CONTENT CALENDAR (unified table)
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="card p-6">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h4 className="section-title" style={{ margin: 0 }}>Content Calendar</h4>
        </div>

        {/* Status bar */}
        {!dataLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
            <ContentStatusBar counts={statusCounts} />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', flexShrink: 0, marginLeft: 12 }}>
              {topics.length + posts.length} items
            </span>
          </div>
        )}

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
                              {slotGenerating[dateKey]
                              ? '…'
                              : <><Play size={10} weight="fill" style={{ marginRight: 3 }} />Generate Slot</>}
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
                        const linkedPost    = topicIdToPost.get(t.id)
                        const displayStatus = (linkedPost?.status === 'draft_saved' || linkedPost?.status === 'published')
                          ? 'published' as const
                          : getTopicDisplayStatus(t)
                        const hasDetail     = !!(t.keyword_opportunity || t.ranking_strategy || t.audience_intent || t.why_now || t.competition_level || t.page_to_support || t.competitors_researched)
                        const hasReview     = linkedPost && (linkedPost.status === 'for_review' || linkedPost.status === 'generated' || linkedPost.status === 'draft_saved')
                        const hasError      = !!t.generation_error && !['rejected', 'generated'].includes(t.status)

                        return [
                          <tr
                            key={`topic-${t.id}`}
                            style={{
                              cursor: hasDetail ? 'pointer' : 'default',
                              background: isExpanded ? 'var(--bg-subtle)' : undefined,
                              borderLeft: hasError ? '2px solid #f59e0b' : undefined,
                            }}
                            onClick={() => { if (hasDetail && !isEditing) setExpandedId(isExpanded ? null : id) }}
                          >
                            <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <StatusPill status={displayStatus} generating={t.status === 'generating'} />
                                {hasError && (
                                  <span title={t.generation_error ?? ''} style={{ fontSize: '0.7rem', color: '#f59e0b', cursor: 'help', lineHeight: 1 }}>⚠</span>
                                )}
                              </div>
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
                                    style={{ fontSize: '0.65rem', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                    onClick={() => setReviewPost(linkedPost!)}
                                  ><ArrowRight size={11} weight="bold" /> {linkedPost?.status === 'draft_saved' ? 'Edit' : 'Review'}</button>
                                )}
                                {linkedPost?.status === 'draft_saved' && linkedPost.published_url && (
                                  <a href={linkedPost.published_url} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: '0.65rem', padding: '2px 7px' }}>↗</a>
                                )}
                                {/* Retry after generation error */}
                                {hasError && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: '2px 6px', fontSize: '0.65rem', color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                    onClick={() => retryGenerate(t.id)}
                                    disabled={topicLoading[t.id]}
                                    title="Retry generation"
                                  ><ArrowClockwise size={11} weight="bold" /> Retry</button>
                                )}
                                {/* Generate post */}
                                {t.status === 'approved' && !hasReview && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: '2px 6px', color: 'var(--blue)', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => generatePost(t.id)}
                                    title="Generate post now"
                                  ><Play size={12} weight="fill" /></button>
                                )}
                                {/* Approve */}
                                {!['approved', 'generating', 'generated'].includes(t.status) && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: '2px 6px', color: 'var(--green)', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => topicAction(t.id, 'approved')}
                                    disabled={topicLoading[t.id]}
                                    title="Approve topic"
                                  ><Check size={12} weight="bold" /></button>
                                )}
                                {/* Edit title — not shown for generated posts (post already written, topic edit won't change it) */}
                                {!['generating', 'generated', 'rejected'].includes(t.status) && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: '2px 6px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => isEditing ? setEditingId(null) : openEdit(t)}
                                    title="Edit title"
                                  ><PencilSimple size={12} /></button>
                                )}
                                {/* Regenerate */}
                                {!['generating', 'generated'].includes(t.status) && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: '2px 6px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => regenerateTopic(t.id)}
                                    disabled={topicLoading[t.id]}
                                    title="Generate different topic idea"
                                  ><ArrowClockwise size={12} /></button>
                                )}
                                {/* Reject */}
                                {!['generating', 'generated'].includes(t.status) && t.status !== 'rejected' && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: '2px 6px', color: 'var(--red)', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => topicAction(t.id, 'rejected')}
                                    disabled={topicLoading[t.id]}
                                    title="Reject topic"
                                  ><X size={12} weight="bold" /></button>
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
                            ? `https://store-${p.bc_store_hash}.mybigcommerce.com/manage/content/blog`
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
                              {(p.status === 'for_review' || p.status === 'draft_saved') && (
                                <button
                                  className="btn btn-primary"
                                  style={{ fontSize: '0.65rem', padding: '2px 7px' }}
                                  onClick={() => setReviewPost(p)}
                                >{p.status === 'draft_saved' ? '→ Edit' : '→ Review'}</button>
                              )}
                              {siteUrl && p.status !== 'for_review' && (
                                <a href={siteUrl} target="_blank" rel="noreferrer"
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.65rem', padding: '2px 7px' }}>
                                  {p.status === 'draft_saved' && p.wp_post_id ? '↗ Edit Draft' : p.bc_post_id ? '↗ BC Admin' : '↗ View'}
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
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: '0.65rem', padding: '2px 7px' }}
                              onClick={() => setReviewPost(p)}
                            >→ Edit</button>
                            {siteUrl && (
                              <a href={siteUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: '0.65rem', padding: '2px 7px' }}>
                                ↗ Live
                              </a>
                            )}
                          </div>
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

      </> /* end activePill === 'blog' */}

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION D — SERVICE AREA PAGES (pill: service)
      ═══════════════════════════════════════════════════════════════════ */}
      {activePill === 'service' && saLoading && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading service area settings…</p>
      )}
      {activePill === 'service' && !saLoading && saSettingsError && (
        <p className="text-sm" style={{ color: 'var(--red)' }}>Failed to load service area settings: {saSettingsError}</p>
      )}
      {activePill === 'service' && !saLoading && !saSettingsError && (
        <div>
          <div
            className="card p-4 cursor-pointer select-none"
            onClick={() => setSaSettingsOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ fontSize: '0.9rem' }}>⚙</span>
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Schedule Configuration</span>
            <span style={{ flex: 1 }} />
            {!!saSettings.auto_generate && (
              <span className="badge badge-green" style={{ fontSize: '0.62rem' }}>Auto</span>
            )}
            {(() => {
              const saIsConfigured = !!(saSettings.connection_id && saSettings.slug_structure)
              return saIsConfigured
                ? <span style={{ color: 'var(--green)', fontSize: '0.8rem', fontWeight: 600 }}>✓</span>
                : <span style={{ color: 'var(--amber)', fontSize: '0.75rem' }}>⚠ Not configured</span>
            })()}
            <span style={{ color: 'var(--text-faint)', fontSize: '0.72rem', marginLeft: 4 }}>
              {saSettingsOpen ? '▲' : '▼'}
            </span>
          </div>

          {saSettingsOpen && (
            <div className="card p-5 mt-1" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <div className="grid grid-cols-3 gap-3" style={{ marginBottom: '0.75rem' }}>
                <div>
                  <Label>Connection</Label>
                  <select className="input" value={saSettings.connection_id ?? ''} onChange={e => setSa('connection_id', e.target.value || null)}>
                    <option value="">None</option>
                    {clientSites.map(s => (
                      <option key={s.connectionId} value={s.connectionId}>{s.siteName || s.siteUrl}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Slug Structure</Label>
                  <select className="input" value={saSettings.slug_structure ?? 'service_slash_city_state'} onChange={e => setSa('slug_structure', e.target.value)}>
                    <option value="service_slash_city_state">/tree-service/palm-bay-fl/</option>
                    <option value="service_dash_city_state">/tree-service-palm-bay-fl/</option>
                    <option value="service_slash_city">/tree-service/palm-bay/</option>
                  </select>
                </div>
                <div>
                  <Label>WP Publish Mode</Label>
                  <select className="input" value={saSettings.wp_publish_mode ?? 'draft_only'} onChange={e => setSa('wp_publish_mode', e.target.value)}>
                    <option value="draft_only">Draft Only</option>
                    <option value="scheduled_draft">Scheduled Draft</option>
                  </select>
                </div>
                <div>
                  <Label>Default Author</Label>
                  <select className="input" value={saSettings.default_author_id ?? ''} onChange={e => setSa('default_author_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— Default —</option>
                    {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Target Length</Label>
                  <input className="input" type="number" min={600} max={3000} step={100} value={saSettings.target_length ?? 1200} onChange={e => setSa('target_length', Number(e.target.value))} />
                </div>
                <div>
                  <Label>Pages per Run</Label>
                  <input className="input" type="number" min={1} max={10} value={saSettings.pages_per_run ?? 1} onChange={e => setSa('pages_per_run', Number(e.target.value))} />
                </div>
                <div>
                  <Label>Frequency</Label>
                  <select className="input" value={saSettings.schedule_frequency ?? 'monthly'} onChange={e => setSa('schedule_frequency', e.target.value || null)}>
                    {FREQ_OPTS.slice(0, 4).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {(saSettings.schedule_frequency === 'weekly' || saSettings.schedule_frequency === 'biweekly') && (
                  <div>
                    <Label>Day of Week</Label>
                    <select className="input" value={saSettings.schedule_day_of_week ?? 1} onChange={e => setSa('schedule_day_of_week', Number(e.target.value))}>
                      {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <Label>Primary Service</Label>
                  <input
                    className="input"
                    value={saSettings.primary_service ?? ''}
                    onChange={e => setSa('primary_service', e.target.value || undefined)}
                    placeholder="e.g. Tree Service"
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <Label>Location Notes</Label>
                  <textarea
                    className="input"
                    rows={2}
                    style={{ resize: 'vertical', width: '100%', fontSize: '0.8125rem' }}
                    value={saSettings.location_notes ?? ''}
                    onChange={e => setSa('location_notes', e.target.value || undefined)}
                    placeholder="e.g. Mention hurricane season for Florida clients. Use 'yard' not 'garden'."
                  />
                </div>
                {/* Service Areas list — used by Generate Plan to cycle through locations */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                      Service Areas <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — used by Generate Plan (optional — AI will infer from GSC if empty)</span>
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.72rem', padding: '1px 8px' }}
                      onClick={() => setSa('service_areas', [...(saSettings.service_areas ?? []), { city: '', state: '' }])}
                    >
                      + Add Location
                    </button>
                  </div>
                  {(saSettings.service_areas ?? []).length === 0 ? (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', margin: 0 }}>
                      No locations added — Generate Plan will use GSC data and brand DNA to find your service area automatically.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(saSettings.service_areas ?? []).map((area, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            className="input"
                            style={{ flex: 1, fontSize: '0.8125rem' }}
                            value={area.city}
                            onChange={e => {
                              const updated = [...(saSettings.service_areas ?? [])]
                              updated[i] = { ...updated[i], city: e.target.value }
                              setSa('service_areas', updated)
                            }}
                            placeholder="City"
                          />
                          <input
                            className="input"
                            style={{ width: 56, fontSize: '0.8125rem' }}
                            value={area.state}
                            maxLength={2}
                            onChange={e => {
                              const updated = [...(saSettings.service_areas ?? [])]
                              updated[i] = { ...updated[i], state: e.target.value.toUpperCase().slice(0, 2) }
                              setSa('service_areas', updated)
                            }}
                            placeholder="FL"
                          />
                          <button
                            type="button"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '0.875rem', padding: '0 4px', lineHeight: 1 }}
                            onClick={() => setSa('service_areas', (saSettings.service_areas ?? []).filter((_, j) => j !== i))}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8125rem' }}>
                  <Toggle
                    checked={saSettings.auto_generate ?? false}
                    onChange={v => { setSa('auto_generate', v); setSa('auto_approve_pages', v); setSa('auto_push_pages', v) }}
                  />
                  <span style={{ color: 'var(--text-muted)' }}>Auto Generate — generates, approves, and publishes pages automatically</span>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button className="btn btn-primary" onClick={saveSaSettings} disabled={saSaving} style={{ fontSize: '0.8125rem' }}>
                  {saSaving ? 'Saving…' : 'Save Configuration'}
                </button>
                {saSaved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
                {saError && <span className="text-xs" style={{ color: 'var(--red)' }}>{saError}</span>}
              </div>
            </div>
          )}

        {/* ── Service Area Plan card (mirrors AI Content Plan) ───────────── */}
        <div className="card" style={{ borderLeft: '3px solid var(--accent, #2563eb)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, marginTop: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-subtle, #eff6ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #2563eb)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3m-4.22-7.78-2.12 2.12M6.34 17.66l-2.12 2.12m0-13.56 2.12 2.12m11.32 11.32-2.12-2.12"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Service Area Plan</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Generate a schedule of service area pages for the weeks ahead
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setSaAddOpen(o => !o)} style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
              + Add Manually
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setSaCalendarModalOpen(true)} style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
              Generate Plan
            </button>
          </div>
        </div>

        {/* ── Add manually form ──────────────────────────────────────────── */}
        {saAddOpen && (
          <div style={{ display: 'flex', gap: 6, marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><Label>City</Label><input className="input" style={{ width: 140 }} value={saAddCity} onChange={e => setSaAddCity(e.target.value)} placeholder="Palm Bay" /></div>
            <div><Label>State</Label><input className="input" style={{ width: 60 }} value={saAddState} onChange={e => setSaAddState(e.target.value.toUpperCase().slice(0, 2))} placeholder="FL" maxLength={2} /></div>
            <div><Label>Service</Label><input className="input" style={{ width: 160 }} value={saAddService} onChange={e => setSaAddService(e.target.value)} placeholder={saSettings.primary_service ?? 'Tree Service'} /></div>
            <button className="btn btn-primary" style={{ fontSize: '0.8125rem' }} onClick={addSaTopic} disabled={!saAddCity.trim() || !saAddState.trim()}>Add</button>
            <button className="btn btn-secondary" style={{ fontSize: '0.8125rem' }} onClick={() => setSaAddOpen(false)}>Cancel</button>
          </div>
        )}

        {/* ── AI Suggestions ─────────────────────────────────────────────── */}
        {saSuggestions.length > 0 && (
          <div style={{ marginBottom: '0.75rem', padding: '0.75rem', borderRadius: 8, background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--blue)', marginBottom: '0.5rem' }}>AI Suggestions — click to add to queue</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {saSuggestions.map((s, i) => (
                <button key={i} className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '2px 8px' }} title={s.rationale} onClick={() => addSuggestionToQueue(s)}>
                  {s.city}, {s.state}{s.estimated_opportunity === 'high' ? ' ⭐' : ''}
                </button>
              ))}
            </div>
            <button onClick={() => setSaSuggestions([])} style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
          </div>
        )}

        {/* ── Publish to row ─────────────────────────────────────────────── */}
        {saSettings.connection_id && clientSites.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Publish to:</span>
            {clientSites.filter(s => s.connectionId === saSettings.connection_id).map(site => (
              <span key={site.connectionId} style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                {site.siteName}
              </span>
            ))}
          </div>
        )}

        {/* ── Service Area Content Calendar ──────────────────────────────── */}
        {(() => {
          // Build combined SA items (topics + orphan posts) grouped by date — mirrors blog calendar
          const SA_STATUS_CFG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
            pending:    { label: 'Pending',     bg: 'var(--amber-subtle)',  color: 'var(--amber)',  dot: '#f59e0b' },
            approved:   { label: 'Approved',    bg: 'var(--blue-subtle)',   color: 'var(--blue)',   dot: '#2563eb' },
            generating: { label: 'Generating',  bg: 'var(--amber-subtle)',  color: 'var(--amber)',  dot: '#f97316' },
            generated:  { label: 'For Review',  bg: 'var(--green-subtle)',  color: 'var(--green)',  dot: '#059669' },
            for_review: { label: 'For Review',  bg: 'var(--green-subtle)',  color: 'var(--green)',  dot: '#059669' },
            draft_saved:{ label: 'Published',   bg: 'var(--green-subtle)',  color: 'var(--green)',  dot: '#059669' },
            published:  { label: 'Published',   bg: 'var(--green-subtle)',  color: 'var(--green)',  dot: '#059669' },
            rejected:   { label: 'Rejected',    bg: 'var(--red-subtle)',    color: 'var(--red)',    dot: '#ef4444' },
          }

          // Map post IDs to their topics for linking
          const saPostIdToTopic = new Map<string, SaTopic>()
          const seenSaPostIds   = new Set<string>()
          for (const t of saTopics) {
            if (t.post?.id) { saPostIdToTopic.set(t.post.id, t); seenSaPostIds.add(t.post.id) }
          }

          type SARowItem = { kind: 'topic'; data: SaTopic } | { kind: 'post'; data: SaPost }
          const saAllItems: SARowItem[] = [
            ...saTopics.filter(t => t.status !== 'rejected').map(t => ({ kind: 'topic' as const, data: t })),
            ...saPosts.filter(p => !seenSaPostIds.has(p.id) && (p.status === 'for_review' || p.status === 'draft_saved' || p.status === 'published')).map(p => ({ kind: 'post' as const, data: p })),
          ]
          const saGroups = new Map<string, SARowItem[]>()
          for (const item of saAllItems) {
            const dateKey = item.kind === 'topic'
              ? (item.data.target_publish_date ?? 'unscheduled')
              : (item.data.target_publish_date ?? 'unscheduled')
            const arr = saGroups.get(dateKey) ?? []
            arr.push(item)
            saGroups.set(dateKey, arr)
          }
          const saDateKeys = Array.from(saGroups.keys()).filter(k => k !== 'unscheduled').sort()
          if (saGroups.has('unscheduled')) saDateKeys.push('unscheduled')

          const pagesPerSlot = saSettings.pages_per_run ?? 1
          const saRejectedCount = saTopics.filter(t => t.status === 'rejected').length
          const [showSaRejected, setShowSaRejected_] = [false, () => {}] // rejected toggle placeholder

          const statusItems = [
            { label: 'Pending',    dot: '#f59e0b', count: saTopics.filter(t => t.status === 'pending').length    },
            { label: 'Approved',   dot: '#2563eb', count: saTopics.filter(t => t.status === 'approved').length   },
            { label: 'Generating', dot: '#f97316', count: saTopics.filter(t => t.status === 'generating').length },
            { label: 'For Review', dot: '#059669', count: saTopics.filter(t => ['generated','for_review'].includes(t.status)).length },
            { label: 'Published',  dot: '#059669', count: saPosts.filter(p => p.status === 'published' || p.status === 'draft_saved').length },
          ].filter(s => s.count > 0)

          return (
            <div className="card p-6">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h4 className="section-title" style={{ margin: 0 }}>Service Area Pages</h4>
              </div>

              {!saTopicsLoading && !saPostsLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.75rem' }}>
                    {statusItems.map(s => (
                      <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
                        {s.count} {s.label}
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', flexShrink: 0, marginLeft: 12 }}>{saAllItems.length} items</span>
                </div>
              )}

              {saTopicsLoading || saPostsLoading ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : saTopicsError ? (
                <p className="text-sm" style={{ color: 'var(--red)' }}>Failed to load: {saTopicsError}</p>
              ) : saAllItems.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-faint)', padding: '1rem 0' }}>
                  No service area pages yet — click &quot;Generate Plan&quot; to create a schedule of pages for the weeks ahead.
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
                        <th style={{ textAlign: 'left', fontWeight: 600, fontSize: '0.72rem' }}>Page</th>
                        <th style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.72rem' }}>Publish Date</th>
                        <th style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.72rem' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saDateKeys.map(dateKey => {
                        const group = saGroups.get(dateKey) ?? []
                        if (group.length === 0) return null

                        const topicsInGroup    = group.filter(r => r.kind === 'topic').map(r => r.data as SaTopic)
                        const approvedInGroup  = topicsInGroup.filter(t => ['approved','generating','generated','for_review'].includes(t.status)).length
                        const generatableCount = topicsInGroup.filter(t => t.status === 'approved' && !t.post?.id).length
                        const slotReady        = approvedInGroup >= pagesPerSlot && generatableCount > 0

                        return [
                          <tr key={`sa-hdr-${dateKey}`} style={{ background: 'var(--bg-subtle)' }}>
                            <td colSpan={4} style={{ padding: '5px 8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                                  {dateKey === 'unscheduled' ? 'Unscheduled' : fmtDate(dateKey)}
                                </span>
                                <div style={{ display: 'flex', gap: 3 }}>
                                  {Array.from({ length: pagesPerSlot }).map((_, i) => (
                                    <span key={i} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: i < approvedInGroup ? 'var(--green)' : 'var(--border)' }} />
                                  ))}
                                </div>
                                <span style={{ fontSize: '0.68rem', color: slotReady ? 'var(--green)' : 'var(--text-faint)' }}>
                                  {approvedInGroup}/{pagesPerSlot}{slotReady ? ' ✓' : ''}
                                </span>
                                {slotReady && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ fontSize: '0.65rem', padding: '1px 7px', color: 'var(--blue)', marginLeft: 4 }}
                                    onClick={() => topicsInGroup.filter(t => t.status === 'approved' && !t.post?.id).forEach(t => generateSaPost(t.id))}
                                  >
                                    <Play size={10} weight="fill" style={{ marginRight: 3 }} />Generate Slot
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>,
                          ...group.map(item => {
                            if (item.kind === 'topic') {
                              const t = item.data as SaTopic
                              const cfg = SA_STATUS_CFG[t.status] ?? { label: t.status, bg: 'var(--bg-muted)', color: 'var(--text-muted)', dot: '#9ca3af' }
                              const pageLabel = [t.service_name ?? saSettings.primary_service, t.city, t.state_abbr].filter(Boolean).join(' — ')
                              const hasPost   = !!(t.post && (t.post.status === 'for_review' || t.post.status === 'draft_saved'))
                              const hasError  = !!t.generation_error && t.status === 'approved'

                              return (
                                <tr key={`sa-t-${t.id}`} style={{ borderLeft: hasError ? '2px solid #f59e0b' : undefined }}>
                                  <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                      <StatusPill status={t.status === 'generated' ? 'generated' : t.status as DisplayStatus} generating={t.status === 'generating'} />
                                      {hasError && (
                                        <span title={t.generation_error ?? ''} style={{ fontSize: '0.7rem', color: '#f59e0b', cursor: 'help', lineHeight: 1 }}>⚠</span>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ padding: '8px', verticalAlign: 'middle', fontWeight: 500, fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {pageLabel || '—'}
                                  </td>
                                  <td style={{ padding: '8px', textAlign: 'right', verticalAlign: 'middle', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {fmtDate(t.target_publish_date ?? null)}
                                  </td>
                                  <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                      {hasPost && (
                                        <button className="btn btn-primary" style={{ fontSize: '0.65rem', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }} onClick={() => setReviewSaPost({ id: t.post!.id })}>
                                          <ArrowRight size={11} weight="bold" /> Review
                                        </button>
                                      )}
                                      {hasError && (
                                        <button
                                          className="btn btn-secondary"
                                          style={{ padding: '2px 6px', color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.65rem' }}
                                          onClick={() => retrySaGenerate(t.id)}
                                          title={`Retry — last error: ${t.generation_error}`}
                                        >
                                          <ArrowClockwise size={11} weight="bold" /> Retry
                                        </button>
                                      )}
                                      {t.status === 'approved' && !hasPost && !hasError && (
                                        <button className="btn btn-secondary" style={{ padding: '2px 6px', color: 'var(--blue)', display: 'inline-flex', alignItems: 'center' }} onClick={() => generateSaPost(t.id)}>
                                          <Play size={12} weight="fill" />
                                        </button>
                                      )}
                                      {!['approved','generating','generated','for_review'].includes(t.status) && (
                                        <button className="btn btn-secondary" style={{ padding: '2px 6px', color: 'var(--green)', display: 'inline-flex', alignItems: 'center' }} disabled={saTopicAction[t.id]} onClick={() => saTopicAction_fn(t.id, 'approved')}>
                                          <Check size={12} weight="bold" />
                                        </button>
                                      )}
                                      {t.status !== 'generating' && (
                                        <button className="btn btn-secondary" style={{ padding: '2px 6px', color: 'var(--red)', display: 'inline-flex', alignItems: 'center' }} disabled={saTopicAction[t.id]} onClick={() => saTopicAction_fn(t.id, 'rejected')}>
                                          <X size={12} weight="bold" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            }

                            // Post row
                            const p = item.data as SaPost
                            const postCfg = SA_STATUS_CFG[p.status] ?? SA_STATUS_CFG['published']
                            const pageLabel = p.title ?? [p.service_name, p.city, p.state_abbr].filter(Boolean).join(' — ') ?? '—'

                            return (
                              <tr key={`sa-p-${p.id}`}>
                                <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}>
                                  <StatusPill status={p.status === 'draft_saved' || p.status === 'published' ? 'published' : 'generated'} />
                                </td>
                                <td style={{ padding: '8px', verticalAlign: 'middle', fontWeight: 500, fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {pageLabel}
                                </td>
                                <td style={{ padding: '8px', textAlign: 'right', verticalAlign: 'middle', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                  {fmtDate(p.target_publish_date)}
                                </td>
                                <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', verticalAlign: 'middle' }}>
                                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                    {(p.status === 'for_review' || p.status === 'generated') && (
                                      <button className="btn btn-primary" style={{ fontSize: '0.65rem', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }} onClick={() => setReviewSaPost({ id: p.id })}>
                                        <ArrowRight size={11} weight="bold" /> Review
                                      </button>
                                    )}
                                    {p.published_url && (
                                      <a href={p.published_url} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: '0.65rem', padding: '2px 7px' }}>↗ View</a>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          }),
                        ]
                      })}

                      {/* Published section (orphan posts) */}
                      {saPosts.filter(p => seenSaPostIds.has(p.id) && (p.status === 'published' || p.status === 'draft_saved')).map(p => {
                        const pageLabel = p.title ?? [p.service_name, p.city, p.state_abbr].filter(Boolean).join(' — ') ?? '—'
                        return (
                          <tr key={`sa-pub-${p.id}`}>
                            <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}>
                              <StatusPill status="published" />
                            </td>
                            <td style={{ padding: '8px', verticalAlign: 'middle', fontWeight: 500, fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pageLabel}</td>
                            <td style={{ padding: '8px', textAlign: 'right', verticalAlign: 'middle', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(p.target_publish_date)}</td>
                            <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', verticalAlign: 'middle' }}>
                              {p.published_url && <a href={p.published_url} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: '0.65rem', padding: '2px 7px' }}>↗ Live</a>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {saRejectedCount > 0 && (
                    <button style={{ marginTop: 10, fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
                      Show Rejected ({saRejectedCount})
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })()}
        </div>
      )}

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

      {/* ── SA Generate Plan Modal ──────────────────────────────────────── */}
      {saCalendarModalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.4)', backdropFilter: 'blur(2px)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setSaCalendarModalOpen(false)}
        >
          <div
            style={{ background: 'var(--bg-surface)', borderRadius: '0.75rem', width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.18)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.125rem 1.375rem', borderBottom: '1px solid var(--border)' }}>
              <span className="font-semibold text-sm">Generate Service Area Page Schedule</span>
              <button type="button" onClick={() => setSaCalendarModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '1rem' }}>✕</button>
            </div>
            <form onSubmit={generateSaCalendar} style={{ padding: '1.375rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div>
                  <Label>Start Date</Label>
                  <input className="input" type="date" style={{ width: '100%' }} value={saModalStartDate} onChange={e => setSaModalStartDate(e.target.value)} required />
                </div>
                <div>
                  <Label>Weeks Ahead</Label>
                  <input className="input" type="number" min={1} max={52} style={{ width: '100%' }} value={saModalWeeks} onChange={e => setSaModalWeeks(Number(e.target.value))} required />
                </div>
                <div style={{ borderRadius: '0.375rem', padding: '0.625rem 0.875rem', background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--blue)', marginBottom: '0.25rem' }}>
                    <strong>Schedule:</strong> {FREQ_LABEL[saSettings.schedule_frequency ?? 'monthly'] ?? 'Monthly'} · {saSettings.pages_per_run ?? 1} page{(saSettings.pages_per_run ?? 1) !== 1 ? 's' : ''}/run
                  </p>
                  <p className="text-xs" style={{ color: 'var(--blue)' }}>
                    Cycles through your configured service areas, assigning one location per publish slot.
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem', marginTop: '1.25rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setSaCalendarModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saGenerating}>
                  {saGenerating ? 'Generating…' : 'Generate →'}
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

      {/* SA post review — uses SA connection ID and reloads SA data */}
      {reviewSaPost && (
        <ContentPostEditor
          postId={reviewSaPost.id}
          defaultConnectionId={saSettings.connection_id ?? null}
          sites={clientSites}
          onClose={() => setReviewSaPost(null)}
          onUpdate={() => { setReviewSaPost(null); loadSaPosts(); loadSaTopics() }}
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
