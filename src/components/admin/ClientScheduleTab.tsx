'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ClientScheduleSettings, SiteOption, SeoScore } from '@/lib/content/types'
import { buildSlugFromBasePage } from '@/lib/content/buildServiceAreaSlug'
import ContentPostEditor from '@/components/admin/ContentPostEditor'
import PageGenerationWizard from '@/components/admin/PageGenerationWizard'
import ContentStatusBar, { computeStatusCounts } from '@/components/admin/ContentStatusBar'
import { Check, X, PencilSimple, ArrowClockwise, Play, ArrowRight, Trash, CalendarCheck, Article } from '@phosphor-icons/react'
import { useSiloSounds } from '@/lib/useSiloSounds'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SaSettings {
  connection_id?:       string | null
  slug_structure?:      string
  base_page_path?:      string | null
  city_slug_format?:    string | null
  wp_publish_mode?:     string
  target_length?:       number
  location_notes?:      string
  pages_per_run?:       number
  schedule_frequency?:  string | null
  schedule_day_of_week?: number | null
  default_author_id?:   number | null
  auto_generate?:       boolean
  auto_approve_pages?:  boolean
  auto_push_pages?:     boolean
  service_pages?:       { url: string; name: string; wp_page_id?: number }[]
  service_areas?:       { city: string; state: string; priority?: string; skip?: boolean }[]
  primary_service?:     string
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
  slug:                string | null
}

interface Author {
  id:   number
  name: string
}

interface WpCategory {
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
  publishedCount:   number
}

interface Props {
  clientId:     string
  clientName:   string
  sites:        SiteOption[]
  aiConfigured: boolean
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
  const [categories,   setCategories]   = useState<WpCategory[]>([])
  const [schedSaving,  setSchedSaving]  = useState(false)
  const [schedSaved,   setSchedSaved]   = useState(false)
  const [schedError,   setSchedError]   = useState('')
  const [schedLoading, setSchedLoading] = useState(true)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  // Image generation — separate state (new columns not in ClientScheduleSettings type)
  const [imageGen,    setImageGen]    = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  // BigCommerce author name — text input, not a WP user dropdown
  const [bcAuthor,    setBcAuthor]    = useState('')

  // Pill: Blog Posts / Service Pages / Service Area Pages / Regular Pages
  const [activePill, setActivePill] = useState<'blog' | 'service_page' | 'service' | 'regular_page' | 'silos'>('blog')

  // Per-type enable flags (service_page / regular_page — blog always on, service_area has its own toggle)
  const [generateServicePages,  setGenerateServicePages]  = useState(false)
  const [generateRegularPages,  setGenerateRegularPages]  = useState(false)
  const [typeToggleSaving, setTypeToggleSaving] = useState(false)

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
      setShowSpWizard(false)
      setShowRpWizard(false)
    }
  }, [isActive])

  // Table state
  const [expandedId,     setExpandedId]     = useState<string | null>(null)
  const [editingId,      setEditingId]      = useState<string | null>(null)
  const [editTitle,      setEditTitle]      = useState('')
  const [editNotes,      setEditNotes]      = useState('')
  const [showRejected,   setShowRejected]   = useState(false)
  const [showPublished,  setShowPublished]  = useState(false)
  const [showArchived,   setShowArchived]   = useState(false)
  const [showSaPublished, setShowSaPublished] = useState(false)
  const [showSaRejected,  setShowSaRejected]  = useState(false)
  const [topicLoading,   setTopicLoading]   = useState<Record<string, boolean>>({})
  const [slotGenerating, setSlotGenerating] = useState<Record<string, boolean>>({})
  const [purgeLoading,   setPurgeLoading]   = useState<Record<string, boolean>>({})

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

  // Silos
  const [silos,              setSilos]              = useState<Silo[]>([])
  const [silosLoading,       setSilosLoading]       = useState(false)
  const [expandedSiloId,     setExpandedSiloId]     = useState<string | null>(null)
  const [siloModalOpen,      setSiloModalOpen]      = useState(false)
  const [siloModalMode,      setSiloModalMode]      = useState<'create' | 'edit'>('create')
  const [editingSiloId,      setEditingSiloId]      = useState<string | null>(null)
  const [siloSaving,         setSiloSaving]         = useState(false)
  const [draftSilo,          setDraftSilo]          = useState<{
    name: string; content_type: string; hub_page_url: string; hub_page_title: string
    target_keyword: string; target_exists: boolean; cluster_keywords: ClusterKw[]; priority: number; section: string
  }>({ name: '', content_type: 'blog', hub_page_url: '', hub_page_title: '', target_keyword: '', target_exists: true, cluster_keywords: [], priority: 100, section: 'core' })
  const [siloGenerating,     setSiloGenerating]     = useState<Record<string, boolean>>({})
  const [siloArchiveConfirm, setSiloArchiveConfirm] = useState<string | null>(null)
  const { playSiloCreated, playClusterAdded, playTopicGenerated } = useSiloSounds(true)

  // SP / RP per-type config (guidelines, auto_generate)
  const [spGuidelines,     setSpGuidelines]     = useState<string | null>(null)
  const [spAutoGenerate,   setSpAutoGenerate]    = useState(false)
  const [spGuidelinesOpen, setSpGuidelinesOpen]  = useState(false)
  const [rpGuidelines,     setRpGuidelines]      = useState<string | null>(null)
  const [rpAutoGenerate,   setRpAutoGenerate]    = useState(false)
  const [rpGuidelinesOpen, setRpGuidelinesOpen]  = useState(false)
  const [guidelinesSaving, setGuidelinesSaving]  = useState(false)
  // Signals used to tell PipelineCalendar instances to reload after silo-based generation
  const [spRefreshSignal,  setSpRefreshSignal]   = useState(0)
  const [rpRefreshSignal,  setRpRefreshSignal]   = useState(0)
  const [showSpWizard,     setShowSpWizard]      = useState(false)
  const [showRpWizard,     setShowRpWizard]      = useState(false)

  // ── Load schedule settings ─────────────────────────────────────────────────
  useEffect(() => {
    setSchedLoading(true)
    fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        const autoGen = (d.auto_generate as boolean) ?? false
        const loaded: Partial<ClientScheduleSettings> = {
          schedule_frequency:    (d.schedule_frequency    as string  | null) ?? null,
          schedule_day_of_week:  (d.schedule_day_of_week  as number  | null) ?? null,
          monthly_publish_day:   (d.monthly_publish_day   as number  | null) ?? null,
          weeks_ahead:           (d.weeks_ahead            as number)         ?? 6,
          schedule_start_date:   (d.schedule_start_date    as string  | null) ?? null,
          auto_generate:         autoGen,
          connection_id:         (d.connection_id          as string  | null) ?? null,
          default_author_id:     (d.default_author_id      as number  | null) ?? null,
          default_category_ids:  Array.isArray(d.default_category_ids) ? (d.default_category_ids as number[]) : null,
          post_structure:        (d.post_structure          as string)         ?? '',
          target_length:         (d.target_length           as number)         ?? 1500,
          publish_time:          (d.publish_time            as string  | null) ?? null,
          wp_publish_mode:       ((d.wp_publish_mode as string | null) === 'draft_only' ? 'draft_only' : 'scheduled_draft') as 'scheduled_draft' | 'draft_only',
          topic_guidelines:      (d.topic_guidelines        as string  | null) ?? null,
          // If auto_generate is on, sub-fields must also be on (they may lag in DB for legacy clients)
          auto_approve_topics:   autoGen || ((d.auto_approve_topics as boolean) ?? false),
          auto_push_posts:       autoGen || ((d.auto_push_posts    as boolean) ?? false),
        }
        setSchedule(loaded)
        // Always collapsed by default
        setScheduleOpen(false)
        setImageGen(!!(d.content_image_generation as boolean | null))
        setImagePrompt(String(d.content_image_prompt ?? ''))
        setBcAuthor(String(d.bc_author ?? ''))
        setGenerateServicePages(!!(d.generate_service_pages as boolean | null))
        setGenerateRegularPages(!!(d.generate_regular_pages as boolean | null))
        setSpGuidelines((d.service_page_topic_guidelines as string | null) ?? null)
        setSpAutoGenerate(!!(d.service_page_auto_generate as boolean | null))
        setRpGuidelines((d.regular_page_topic_guidelines as string | null) ?? null)
        setRpAutoGenerate(!!(d.regular_page_auto_generate as boolean | null))
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

  // ── Silos ─────────────────────────────────────────────────────────────────
  const loadSilos = useCallback(() => {
    setSilosLoading(true)
    fetch(`/api/admin/content/silos?client_id=${clientId}`)
      .then(r => r.json())
      .then((d: { silos?: Silo[] }) => { setSilos(d.silos ?? []); setSilosLoading(false) })
      .catch(() => setSilosLoading(false))
  }, [clientId])

  useEffect(() => { loadSilos() }, [loadSilos])

  const EMPTY_DRAFT = { name: '', content_type: 'blog', hub_page_url: '', hub_page_title: '', target_keyword: '', target_exists: true, cluster_keywords: [] as ClusterKw[], priority: 100, section: 'core' }

  function openCreateSiloModal(contentType: string) {
    setDraftSilo({ ...EMPTY_DRAFT, content_type: contentType })
    setSiloModalMode('create')
    setEditingSiloId(null)
    setSiloModalOpen(true)
  }

  function openEditSiloModal(silo: Silo) {
    setDraftSilo({
      name:             silo.name,
      content_type:     silo.content_type,
      hub_page_url:     silo.hub_page_url  ?? '',
      hub_page_title:   silo.hub_page_title ?? '',
      target_keyword:   silo.target_keyword ?? '',
      target_exists:    silo.target_exists,
      cluster_keywords: Array.isArray(silo.cluster_keywords) ? silo.cluster_keywords : [],
      priority:         silo.priority ?? 100,
      section:          silo.section ?? 'core',
    })
    setSiloModalMode('edit')
    setEditingSiloId(silo.id)
    setSiloModalOpen(true)
  }

  async function handleSaveSilo() {
    if (!draftSilo.name.trim()) return
    setSiloSaving(true)
    const payload = {
      client_id:        clientId,
      name:             draftSilo.name.trim(),
      content_type:     draftSilo.content_type,
      hub_page_url:     draftSilo.hub_page_url.trim()    || null,
      hub_page_title:   draftSilo.hub_page_title.trim()  || null,
      target_keyword:   draftSilo.target_keyword.trim()  || null,
      target_exists:    draftSilo.target_exists,
      cluster_keywords: draftSilo.cluster_keywords,
      priority:         draftSilo.priority,
      section:          draftSilo.section,
    }
    const res = siloModalMode === 'create'
      ? await fetch('/api/admin/content/silos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch(`/api/admin/content/silos?id=${editingSiloId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    setSiloSaving(false)
    if (res.ok) {
      setSiloModalOpen(false)
      loadSilos()
      if (siloModalMode === 'create') playSiloCreated()
      showToast(siloModalMode === 'create' ? 'Silo created' : 'Silo saved')
    } else {
      const d = await res.json().catch(() => ({}))
      showToast(d.error ?? 'Failed to save', 'error')
    }
  }

  async function handleDeleteSilo(siloId: string) {
    // Check for active pipeline topics before archiving
    const checkRes = await fetch(`/api/admin/content/topics?client_id=${clientId}&silo_id=${siloId}`)
    if (checkRes.ok) {
      const data = await checkRes.json() as Array<{ status: string }>
      const active = Array.isArray(data) ? data.filter(t => ['pending', 'approved', 'generating', 'generated', 'scheduled'].includes(t.status)) : []
      if (active.length > 0) {
        setSiloArchiveConfirm(siloId)
        return
      }
    }
    await doArchiveSilo(siloId)
  }

  async function doArchiveSilo(siloId: string) {
    setSiloArchiveConfirm(null)
    await fetch(`/api/admin/content/silos?id=${siloId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) })
    setSilos(p => p.filter(s => s.id !== siloId))
    showToast('Silo archived')
  }

  function handleAddClusterKw() {
    const next = [...draftSilo.cluster_keywords, { id: crypto.randomUUID(), keyword: '', status: 'planned' as const, priority: draftSilo.cluster_keywords.length + 1 }]
    setDraftSilo(d => ({ ...d, cluster_keywords: next }))
    playClusterAdded()
  }

  function handleRemoveClusterKw(id: string) {
    setDraftSilo(d => ({ ...d, cluster_keywords: d.cluster_keywords.filter(k => k.id !== id) }))
  }

  function handleUpdateClusterKw(id: string, field: keyof ClusterKw, value: string) {
    setDraftSilo(d => ({ ...d, cluster_keywords: d.cluster_keywords.map(k => k.id === id ? { ...k, [field]: value } : k) }))
  }

  function handleMoveClusterKw(id: string, dir: 'up' | 'down') {
    setDraftSilo(d => {
      const arr = [...d.cluster_keywords]
      const idx = arr.findIndex(k => k.id === id)
      if (dir === 'up' && idx > 0) [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
      if (dir === 'down' && idx < arr.length - 1) [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
      return { ...d, cluster_keywords: arr.map((k, i) => ({ ...k, priority: i + 1 })) }
    })
  }

  async function handleGenerateFromSilo(siloId: string, silo: Silo) {
    if (!silo.cluster_keywords?.length) {
      showToast('Add cluster keywords first to guide generation', 'error')
      return
    }
    setSiloGenerating(p => ({ ...p, [siloId]: true }))
    const res = await fetch('/api/admin/content/calendar/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, silo_id: siloId, weeks_ahead: 4 }),
    })
    setSiloGenerating(p => ({ ...p, [siloId]: false }))
    if (res.ok) {
      playTopicGenerated()
      showToast('Topics are generating — they\'ll appear in the pipeline shortly', 'info')
      setTimeout(() => {
        loadSilos()
        if (silo.content_type === 'blog') loadPipeline()
        else if (silo.content_type === 'service_page') setSpRefreshSignal(s => s + 1)
        else if (silo.content_type === 'regular_page') setRpRefreshSignal(s => s + 1)
      }, 3000)
    } else {
      const d = await res.json().catch(() => ({}))
      showToast(d.error ?? 'Generation failed', 'error')
    }
  }

  async function handleMarkHubUpdated(siloId: string) {
    await fetch(`/api/admin/content/silos?id=${siloId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pending_links: [] }),
    })
    setSilos(p => p.map(s => s.id === siloId ? { ...s, pending_links: [] } : s))
    showToast('Hub marked as updated')
  }

  const firstConnectionId = clientSites[0]?.connectionId ?? null

  // ── Auto-set connection_id ─────────────────────────────────────────────────
  // When WP is connected after schedule config was saved, persist the default
  // so generate/approve routes pick it up without requiring a manual Save click.
  useEffect(() => {
    if (!schedule.connection_id && firstConnectionId) {
      setSched('connection_id', firstConnectionId)
      fetch('/api/admin/content/client-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, connection_id: firstConnectionId }),
      })
        .then(r => r.ok ? null : r.json().then(d => { throw new Error(d.error ?? 'Save failed') }))
        .catch(err => {
          console.error('[auto-save connection_id]', err)
          setSched('connection_id', null) // roll back optimistic update
          showToast('Could not auto-save site connection — please select and save manually', 'error')
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstConnectionId])

  // ── Load authors ───────────────────────────────────────────────────────────
  useEffect(() => {
    const connId = schedule.connection_id || firstConnectionId
    if (!connId) { setAuthors([]); return }
    fetch(`/api/admin/wordpress/authors?connection_id=${connId}`)
      .then(r => r.json())
      .then((d: { authors?: Author[] } | { error: string }) => {
        if ('authors' in d && Array.isArray(d.authors)) setAuthors(d.authors)
      })
      .catch(() => setAuthors([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.connection_id, firstConnectionId])

  // ── Load categories ────────────────────────────────────────────────────────
  useEffect(() => {
    const connId = schedule.connection_id || firstConnectionId
    if (!connId) { setCategories([]); return }
    fetch(`/api/admin/wordpress/categories?connection_id=${connId}`)
      .then(r => r.json())
      .then((d: { categories?: WpCategory[] } | { error: string }) => {
        if ('categories' in d && Array.isArray(d.categories)) setCategories(d.categories)
      })
      .catch(() => setCategories([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.connection_id, firstConnectionId])

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
      body: JSON.stringify({ client_id: clientId, ...schedule, content_image_generation: imageGen, content_image_prompt: imagePrompt || null, bc_author: bcAuthor || null }),
    })
    setSchedSaving(false)
    if (res.ok) { setSchedSaved(true); setTimeout(() => setSchedSaved(false), 2500) }
    else { const d = await res.json(); setSchedError(d.error || 'Failed to save') }
  }

  async function saveTypeToggles() {
    setTypeToggleSaving(true)
    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, generate_service_pages: generateServicePages, generate_regular_pages: generateRegularPages }),
    })
    setTypeToggleSaving(false)
    if (res.ok) showToast('Saved')
    else showToast((await res.json()).error || 'Failed to save', 'error')
  }

  async function saveSpConfig() {
    setGuidelinesSaving(true)
    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        service_page_topic_guidelines: spGuidelines ?? null,
      }),
    })
    setGuidelinesSaving(false)
    if (res.ok) { showToast('Guidelines saved'); setSpGuidelinesOpen(false) }
    else showToast((await res.json() as { error?: string }).error || 'Failed to save', 'error')
  }

  async function saveRpConfig() {
    setGuidelinesSaving(true)
    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        regular_page_topic_guidelines: rpGuidelines ?? null,
      }),
    })
    setGuidelinesSaving(false)
    if (res.ok) { showToast('Guidelines saved'); setRpGuidelinesOpen(false) }
    else showToast((await res.json() as { error?: string }).error || 'Failed to save', 'error')
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
      }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }).catch(e => {
        console.error('[generateForSlot]', e)
        setTopics(prev => prev.map(topic => topic.id === t.id ? { ...topic, status: 'approved' } : topic))
      })
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

  async function cleanSlot(topicIds: string[]) {
    const res = await fetch('/api/admin/content/topics/bulk-reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_ids: topicIds, client_id: clientId }),
    })
    if (res.ok) {
      setTopics(p => p.map(t => topicIds.includes(t.id) ? { ...t, status: 'rejected' } : t))
      showToast(`Cleaned up ${topicIds.length} stale topic${topicIds.length !== 1 ? 's' : ''}`)
    } else {
      showToast('Cleanup failed', 'error')
    }
  }

  async function purgeItem(kind: 'topic' | 'post', id: string) {
    setPurgeLoading(p => ({ ...p, [id]: true }))
    const url = kind === 'topic'
      ? `/api/admin/content/topics/${id}`
      : `/api/admin/content/posts/${id}`
    try {
      const res = await fetch(url, { method: 'DELETE' })
      if (res.ok) {
        if (kind === 'topic') {
          // Also remove the linked post to prevent it resurfacing as an orphan
          const linkedPost = topicIdToPost.get(id)
          if (linkedPost) setPosts(p => p.filter(post => post.id !== linkedPost.id))
          setTopics(p => p.filter(t => t.id !== id))
        } else {
          setPosts(p => p.filter(post => post.id !== id))
        }
        showToast('Deleted')
      } else {
        showToast('Delete failed', 'error')
      }
    } catch {
      showToast('Delete failed', 'error')
    } finally {
      setPurgeLoading(p => ({ ...p, [id]: false }))
    }
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
  const freqSummary  = schedule.schedule_frequency
    ? `${FREQ_LABEL[schedule.schedule_frequency] ?? schedule.schedule_frequency} · 1 topic/slot`
    : '1 topic/slot'
  const willCreate   = Math.min(modalWeeks, 50)
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

  // Posts linked to rejected topics — used to suppress them from the active view
  const rejectedTopicPostIds = new Set<string>()
  topics.filter(t => t.status === 'rejected').forEach(t => {
    const p = topicIdToPost.get(t.id)
    if (p) rejectedTopicPostIds.add(p.id)
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

  // Archived: date groups older than 2 months (at the front of ascending-sorted dateKeys)
  const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const archivedKeys = dateKeys.filter(k => k !== 'unscheduled' && k < twoMonthsAgo)
  const recentKeys   = dateKeys.filter(k => k === 'unscheduled' || k >= twoMonthsAgo)

  // Shared filter predicate for both recentKeys and archivedKeys maps
  const filterGroupItems = (items: RowItem[]) => items.filter(item => {
    if (!showRejected) {
      if (item.kind === 'topic' && item.data.status === 'rejected') return false
      if (item.kind === 'post'  && item.data.status === 'rejected')  return false
      if (item.kind === 'post'  && rejectedTopicPostIds.has(item.data.id)) return false
    }
    if (item.kind === 'post' && (item.data.status === 'draft_saved' || item.data.status === 'published')) return false
    return true
  })

  const archivedCount = archivedKeys.reduce((sum, k) => sum + filterGroupItems(groups.get(k) ?? []).length, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Pill switcher: 4 content types ─────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, padding: '3px', background: 'var(--bg-subtle)', borderRadius: 8, alignSelf: 'flex-start', border: '1px solid var(--border)' }}>
        {([
          { id: 'blog',         label: 'Blog Posts' },
          { id: 'service_page', label: 'Service Pages' },
          { id: 'service',      label: 'SA Pages' },
          { id: 'regular_page', label: 'Regular Pages' },
          { id: 'silos',        label: 'Silos' },
        ] as const).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActivePill(id)}
            style={{
              padding: '0.3125rem 0.875rem',
              fontSize: '0.8125rem',
              fontWeight: activePill === id ? 600 : 400,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: activePill === id ? 'var(--bg-surface, #fff)' : 'transparent',
              color: activePill === id ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: activePill === id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
            {id === 'blog' && !!schedule.auto_generate && (
              <span className="badge badge-green" style={{ fontSize: '0.55rem', marginLeft: 5, verticalAlign: 'middle' }}>Auto</span>
            )}
            {id === 'service' && (!!saSettings.auto_generate) && (
              <span className="badge badge-green" style={{ fontSize: '0.55rem', marginLeft: 5, verticalAlign: 'middle' }}>Auto</span>
            )}
            {(id === 'service_page' || id === 'regular_page') && (
              <span style={{
                fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.05em',
                background: 'var(--blue)', color: '#fff',
                padding: '1px 4px', borderRadius: 3,
                marginLeft: 5, verticalAlign: 'middle', lineHeight: 1.4,
              }}>BETA</span>
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
          <CalendarCheck size={16} weight="duotone" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
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
            {/* Connection */}
            <div style={{ marginBottom: '0.75rem' }}>
              <Label>Site Connection</Label>
              <select className="input" value={schedule.connection_id ?? ''} onChange={e => setSched('connection_id', e.target.value || null)}>
                <option value="">— Select site —</option>
                {clientSites.map(s => <option key={s.connectionId} value={s.connectionId}>{s.siteName || s.siteUrl}</option>)}
              </select>
            </div>

            {/* Schedule row */}
            <div style={{ marginBottom: '0.75rem' }}>
              <Label>Schedule</Label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <select className="input" style={{ flex: '0 0 auto', width: 160 }} value={schedule.schedule_frequency ?? ''} onChange={e => setSched('schedule_frequency', e.target.value || null)}>
                  <option value="">Use global default</option>
                  {FREQ_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {showDayPicker && (<>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>on</span>
                  <select className="input" style={{ flex: '0 0 auto', width: 140 }} value={schedule.schedule_day_of_week ?? 1} onChange={e => setSched('schedule_day_of_week', Number(e.target.value))}>
                    {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </>)}
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>at</span>
                <input className="input" type="time" style={{ flex: '0 0 auto', width: 120 }} value={schedule.publish_time ?? '09:00'} onChange={e => setSched('publish_time', e.target.value || null)} />
              </div>
            </div>

            {/* Target word count + Author + BC fields */}
            <div className="grid grid-cols-3 gap-3" style={{ marginBottom: '0.75rem' }}>
              <div>
                <Label>Target Word Count</Label>
                <input className="input" type="number" min={300} max={5000} step={100} value={schedule.target_length ?? 1500} onChange={e => setSched('target_length', Number(e.target.value))} />
              </div>
              {clientSites.find(s => s.connectionId === schedule.connection_id)?.connectorType !== 'bigcommerce' && (
                <div>
                  <Label>Default Author</Label>
                  <select className="input" value={schedule.default_author_id ?? ''} onChange={e => setSched('default_author_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— Default —</option>
                    {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              {clientSites.find(s => s.connectionId === schedule.connection_id)?.connectorType === 'bigcommerce' && (<>
                <div>
                  <Label hint="shown as author on BigCommerce blog posts">BC Author Name</Label>
                  <input className="input" type="text" value={bcAuthor} onChange={e => setBcAuthor(e.target.value)} placeholder="e.g. Admin" />
                </div>
                <div>
                  <Label hint="BigCommerce only — URL prefix prepended to blog post URLs (e.g. /blog/). WordPress manages its own permalink structure and does not use this field.">Blog URL Prefix</Label>
                  <input className="input" type="text" value={(schedule as Record<string, unknown>).blog_url_prefix as string ?? ''} onChange={e => setSched('blog_url_prefix' as keyof typeof schedule, e.target.value || null)} placeholder="/blog/" />
                </div>
              </>)}
              {clientSites.find(s => s.connectionId === schedule.connection_id)?.connectorType !== 'bigcommerce' && (
                <div>
                  <Label>WP Publish Mode</Label>
                  <select className="input" value={schedule.wp_publish_mode ?? 'scheduled_draft'} onChange={e => setSched('wp_publish_mode', e.target.value as 'scheduled_draft' | 'draft_only')}>
                    <option value="scheduled_draft">Scheduled Draft</option>
                    <option value="draft_only">Draft Only</option>
                  </select>
                </div>
              )}
            </div>

            {/* Writing Instructions + Topic Restrictions side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <Label>Writing Instructions</Label>
                <textarea
                  className="input"
                  rows={4}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
                  value={schedule.post_structure ?? ''}
                  onChange={e => setSched('post_structure', e.target.value)}
                  placeholder={`e.g.\nAlways link to at least 2 priority pages.\nInclude E-E-A-T signals: cite years of experience, named staff expertise.`}
                />
              </div>
              <div>
                <Label>Topic Restrictions</Label>
                <textarea
                  className="input"
                  rows={4}
                  style={{ width: '100%', resize: 'vertical' }}
                  value={schedule.topic_guidelines ?? ''}
                  onChange={e => setSched('topic_guidelines', e.target.value || null)}
                  placeholder="e.g. Avoid bad credit financing, payday loans, or any topics with negative brand associations."
                />
              </div>
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
              Generate 1 topic per {FREQ_LABEL[schedule.schedule_frequency ?? 'weekly']?.toLowerCase() ?? 'weekly'} slot for your next {schedule.weeks_ahead ?? 1} publish date{(schedule.weeks_ahead ?? 1) > 1 ? 's' : ''}
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
                {recentKeys.map(dateKey => {
                  const group = filterGroupItems(groups.get(dateKey) ?? [])

                  if (group.length === 0) return null

                  // Slot approval progress (topics in this date group)
                  const topicsInGroup      = group.filter(r => r.kind === 'topic').map(r => r.data as Topic)
                  const approvedInGroup    = topicsInGroup.filter(t => ['approved', 'generating', 'generated'].includes(t.status)).length
                  const generatableInGroup = topicsInGroup.filter(t => t.status === 'approved').length
                  const slotReady = approvedInGroup >= 1 && generatableInGroup > 0
                  // Check unfiltered slot for generated/published content (filter hides draft_saved/published)
                  const rawSlotItems = groups.get(dateKey) ?? []
                  const hasGeneratedInSlot = rawSlotItems.some(r =>
                    (r.kind === 'topic' && r.data.status === 'generated') ||
                    (r.kind === 'post'  && ['for_review', 'draft_saved', 'published'].includes(r.data.status))
                  )
                  const staleTopicIds = topicsInGroup
                    .filter(t => ['pending', 'approved'].includes(t.status))
                    .map(t => t.id)
                  const showCleanup = hasGeneratedInSlot && staleTopicIds.length > 0

                  return [
                    // Date section header row
                    <tr key={`hdr-${dateKey}`} style={{ background: 'var(--bg-subtle)' }}>
                      <td colSpan={4} style={{ padding: '5px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                            {dateKey === 'unscheduled' ? 'Unscheduled' : fmtDate(dateKey)}
                          </span>
                          {/* Approval dot (1 per slot) */}
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: approvedInGroup >= 1 ? 'var(--green)' : 'var(--border)' }} />
                          <span style={{ fontSize: '0.68rem', color: slotReady ? 'var(--green)' : 'var(--text-faint)' }}>
                            {approvedInGroup >= 1 ? '✓' : '0/1'}
                          </span>
                          {showCleanup && (
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.65rem', padding: '1px 7px', color: 'var(--text-faint)', marginLeft: 'auto' }}
                              onClick={() => cleanSlot(staleTopicIds)}
                              title="Remove stale topics from this slot — a post has already been generated"
                            >
                              Clean up ({staleTopicIds.length})
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
                                {/* Purge */}
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: '2px 6px', color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center' }}
                                  onClick={() => void purgeItem('topic', t.id)}
                                  disabled={purgeLoading[t.id]}
                                  title="Permanently delete"
                                ><Trash size={12} /></button>
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
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '2px 6px', color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center' }}
                                onClick={() => void purgeItem('post', p.id)}
                                disabled={purgeLoading[p.id]}
                                title="Permanently delete"
                              ><Trash size={12} /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    }).flat(),
                  ]
                }).filter(Boolean)}

                {/* Archived date groups toggle (2+ months old) */}
                {archivedKeys.length > 0 && (
                  <tr key="archived-toggle">
                    <td colSpan={4} style={{ padding: '5px 8px', background: 'var(--bg-subtle)' }}>
                      <button
                        style={{ fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                        onClick={() => setShowArchived(r => !r)}
                      >
                        <span style={{ fontSize: '0.6rem' }}>{showArchived ? '▼' : '▶'}</span>
                        {showArchived ? 'Hide' : 'Show'} Archived ({archivedCount} items — older than 2 months)
                      </button>
                    </td>
                  </tr>
                )}
                {showArchived && archivedKeys.map(dateKey => {
                  const group = filterGroupItems(groups.get(dateKey) ?? [])
                  if (group.length === 0) return null
                  return [
                    <tr key={`hdr-${dateKey}`} style={{ background: 'var(--bg-subtle)', opacity: 0.75 }}>
                      <td colSpan={4} style={{ padding: '5px 8px' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {fmtDate(dateKey)}
                        </span>
                      </td>
                    </tr>,
                    ...group.map(item => {
                      if (item.kind === 'topic') {
                        const t = item.data as Topic
                        const linkedPost = topicIdToPost.get(t.id)
                        const hasReview  = linkedPost && ['for_review', 'generated', 'draft_saved'].includes(linkedPost.status)
                        return (
                          <tr key={`arch-topic-${t.id}`} style={{ opacity: 0.7 }}>
                            <td style={{ padding: '7px 8px 7px 0', verticalAlign: 'middle' }}>
                              <StatusPill status={getTopicDisplayStatus(t)} />
                            </td>
                            <td style={{ padding: '7px 8px', verticalAlign: 'middle' }}>
                              <div style={{ fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.topic}</div>
                              {t.target_keyword && <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>{t.target_keyword}</div>}
                            </td>
                            <td style={{ padding: '7px 8px', textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {fmtDate(t.target_publish_date)}
                            </td>
                            <td style={{ padding: '7px 0 7px 8px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                {hasReview && (
                                  <button className="btn btn-primary" style={{ fontSize: '0.65rem', padding: '2px 7px' }}
                                    onClick={() => setReviewPost(linkedPost!)}>
                                    → Review
                                  </button>
                                )}
                                {t.status === 'approved' && !hasReview && (
                                  <button className="btn btn-secondary"
                                    style={{ padding: '2px 6px', color: 'var(--blue)', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => generatePost(t.id)} title="Generate post">
                                    <Play size={12} weight="fill" />
                                  </button>
                                )}
                                {!['approved', 'generating', 'generated'].includes(t.status) && (
                                  <button className="btn btn-secondary"
                                    style={{ padding: '2px 6px', color: 'var(--green)', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => topicAction(t.id, 'approved')}
                                    disabled={topicLoading[t.id]} title="Approve topic">
                                    <Check size={12} weight="bold" />
                                  </button>
                                )}
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: '2px 6px', color: 'var(--red)', display: 'inline-flex', alignItems: 'center' }}
                                  onClick={() => void purgeItem('topic', t.id)}
                                  disabled={purgeLoading[t.id]}
                                  title="Permanently delete"
                                ><Trash size={12} /></button>
                              </div>
                            </td>
                          </tr>
                        )
                      }
                      const p = item.data as Post
                      return (
                        <tr key={`arch-post-${p.id}`} style={{ opacity: 0.7 }}>
                          <td style={{ padding: '7px 8px 7px 0', verticalAlign: 'middle' }}>
                            <StatusPill status={getPostDisplayStatus(p)} />
                          </td>
                          <td style={{ padding: '7px 8px', verticalAlign: 'middle' }}>
                            <div style={{ fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title ?? '(untitled)'}</div>
                            {p.target_keyword && <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>{p.target_keyword}</div>}
                          </td>
                          <td style={{ padding: '7px 8px', textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {fmtDate(p.target_publish_date)}
                          </td>
                          <td style={{ padding: '7px 0 7px 8px', textAlign: 'right' }}>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '2px 6px', color: 'var(--red)', display: 'inline-flex', alignItems: 'center' }}
                              onClick={() => void purgeItem('post', p.id)}
                              disabled={purgeLoading[p.id]}
                              title="Permanently delete"
                            ><Trash size={12} /></button>
                          </td>
                        </tr>
                      )
                    }),
                  ]
                }).filter(Boolean)}

                {/* Published section — collapsed by default */}
                {showPublished && publishedItems.map(item => {
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
                })}
              </tbody>
            </table>

            {/* Published / Rejected toggles */}
            <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
              {publishedItems.length > 0 && (
                <button
                  style={{ fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                  onClick={() => setShowPublished(v => !v)}
                >
                  {showPublished ? 'Hide' : 'Show'} Published ({publishedItems.length})
                </button>
              )}
              {rejectedCount > 0 && (
                <button
                  style={{ fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                  onClick={() => setShowRejected(r => !r)}
                >
                  {showRejected ? 'Hide' : 'Show'} Rejected ({rejectedCount})
                </button>
              )}
            </div>
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
          SECTION — SERVICE PAGES (pill: service_page)
      ═══════════════════════════════════════════════════════════════════ */}
      {activePill === 'service_page' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Header bar */}
          <div className="card p-4" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>Service Pages</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                On-demand generation — define the pages you need, set a slug structure, and generate them all at once or spaced over time.
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setShowSpWizard(true)}
              disabled={!aiConfigured}
              title={!aiConfigured ? 'Configure an AI provider in Agency Settings first' : undefined}
              style={{ flexShrink: 0 }}
            >
              Generate Service Pages →
            </button>
          </div>

          {/* Collapsible guidelines */}
          <div
            className="card p-4 cursor-pointer select-none"
            onClick={() => setSpGuidelinesOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Article size={16} weight="duotone" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Content Guidelines</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--text-faint)', fontSize: '0.72rem', marginLeft: 4 }}>{spGuidelinesOpen ? '▲' : '▼'}</span>
          </div>
          {spGuidelinesOpen && (
            <div className="card p-5" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: -8 }}>
              <div style={{ marginBottom: '0.875rem' }}>
                <Label>Topic Guidelines</Label>
                <p className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
                  Additional instructions injected into the AI prompt when generating service page content.
                </p>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="e.g. Focus on local service area keywords, emphasize certifications and years of experience…"
                  value={spGuidelines ?? ''}
                  onChange={e => setSpGuidelines(e.target.value || null)}
                  style={{ width: '100%', resize: 'vertical', fontSize: '0.8125rem' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setSpGuidelinesOpen(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveSpConfig} disabled={guidelinesSaving}>
                  {guidelinesSaving ? 'Saving…' : 'Save Guidelines'}
                </button>
              </div>
            </div>
          )}

          {/* SiloManager and PipelineCalendar sunset for service pages — wizard-based flow replaces them */}
          {false && <SiloManager
            contentType="service_page"
            contentTypeLabel="Service Page"
            silos={silos}
            silosLoading={silosLoading}
            expandedSiloId={expandedSiloId}
            setExpandedSiloId={setExpandedSiloId}
            siloGenerating={siloGenerating}
            onCreateSilo={() => openCreateSiloModal('service_page')}
            onEditSilo={openEditSiloModal}
            onArchiveSilo={handleDeleteSilo}
            onGenerateFromSilo={handleGenerateFromSilo}
            onMarkHubUpdated={handleMarkHubUpdated}
          />}
          {false && <PipelineCalendar
            clientId={clientId}
            contentType="service_page"
            connectionId={schedule.connection_id ?? null}
            sites={clientSites}
            onShowToast={showToast}
            aiConfigured={aiConfigured}
            isActive={isActive && activePill === 'service_page'}
            refreshSignal={spRefreshSignal}
          />}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION — SERVICE AREA PAGES (pill: service)
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
            <CalendarCheck size={16} weight="duotone" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Schedule Configuration</span>
            <span style={{ flex: 1 }} />
            {!!saSettings.auto_generate && (
              <span className="badge badge-green" style={{ fontSize: '0.62rem' }}>Auto</span>
            )}
            {(() => {
              const saStarted     = !!(saSettings.slug_structure)
              const saIsConfigured = !!(saSettings.connection_id && saSettings.slug_structure)
              if (saIsConfigured) return <span style={{ color: 'var(--green)', fontSize: '0.8rem', fontWeight: 600 }}>✓</span>
              if (saStarted)      return <span style={{ color: 'var(--amber)', fontSize: '0.75rem' }}>⚠ Setup incomplete</span>
              return <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>Optional</span>
            })()}
            <span style={{ color: 'var(--text-faint)', fontSize: '0.72rem', marginLeft: 4 }}>
              {saSettingsOpen ? '▲' : '▼'}
            </span>
          </div>

          {saSettingsOpen && (
            <div className="card p-4 mt-1" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '0.75rem' }}>
                {/* Connection */}
                <div>
                  <Label>Connection</Label>
                  <select className="input" value={saSettings.connection_id ?? ''} onChange={e => setSa('connection_id', e.target.value || null)}>
                    <option value="">None</option>
                    {clientSites.map(s => (
                      <option key={s.connectionId} value={s.connectionId}>{s.siteName || s.siteUrl}</option>
                    ))}
                  </select>
                </div>
                {/* 4-col row: WP Publish | Author | Target Length | City Slug Format */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.625rem' }}>
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
                    <Label>City Slug Format</Label>
                    <select className="input" value={saSettings.city_slug_format ?? 'city_state'} onChange={e => setSa('city_slug_format', e.target.value)}>
                      <option value="city_state">City + State (melbourne-fl)</option>
                      <option value="city">City only (melbourne)</option>
                    </select>
                  </div>
                </div>
                {/* 2-col: Primary Service + Schedule inline */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '0.625rem', alignItems: 'end' }}>
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
                  <div>
                    <Label>Schedule</Label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <select className="input" style={{ flex: '0 0 auto', width: 150 }} value={saSettings.schedule_frequency ?? 'monthly'} onChange={e => setSa('schedule_frequency', e.target.value || null)}>
                        {FREQ_OPTS.slice(0, 4).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {(saSettings.schedule_frequency === 'weekly' || saSettings.schedule_frequency === 'biweekly') && (<>
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>on</span>
                        <select className="input" style={{ flex: '0 0 auto', width: 120 }} value={saSettings.schedule_day_of_week ?? 1} onChange={e => setSa('schedule_day_of_week', Number(e.target.value))}>
                          {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                        </select>
                      </>)}
                    </div>
                  </div>
                </div>
                {/* Location Notes */}
                <div>
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
                <div>
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
            if (t.post?.id) {
              saPostIdToTopic.set(t.post.id, t)
              // Only mark as seen for non-rejected topics — rejected-topic posts should
              // surface as orphan rows so the admin can see and clean them up.
              if (t.status !== 'rejected') seenSaPostIds.add(t.post.id)
            }
          }

          type SARowItem = { kind: 'topic'; data: SaTopic } | { kind: 'post'; data: SaPost }
          const saAllItems: SARowItem[] = [
            ...saTopics.filter(t => showSaRejected || t.status !== 'rejected').map(t => ({ kind: 'topic' as const, data: t })),
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
          const saPublishedCount = saPosts.filter(p => p.status === 'published' || p.status === 'draft_saved').length

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
                              // Compute slug preview from service page URL in service_pages config
                              const cityFmtSa = (saSettings.city_slug_format ?? 'city_state') === 'city' ? 'city' as const : 'city_state' as const
                              const svcEntry  = (saSettings.service_pages ?? []).find(sp => sp.name?.toLowerCase() === (t.service_name ?? '').toLowerCase())
                              const svcUrl    = svcEntry?.url ?? ''
                              let saSlugPreview: string | null = null
                              if (svcUrl && t.city) {
                                try {
                                  const pn = svcUrl.startsWith('http') ? new URL(svcUrl).pathname : svcUrl
                                  saSlugPreview = buildSlugFromBasePage(pn, t.city, t.state_abbr ?? '', cityFmtSa)
                                } catch { /* non-fatal */ }
                              }

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
                                  <td style={{ padding: '8px', verticalAlign: 'middle', overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 500, fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pageLabel || '—'}</div>
                                    {saSlugPreview && (
                                      <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{saSlugPreview}</div>
                                    )}
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
                                <td style={{ padding: '8px', verticalAlign: 'middle', overflow: 'hidden' }}>
                                  <div style={{ fontWeight: 500, fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pageLabel}</div>
                                  {p.slug && (
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                                      /{p.slug.replace(/^\//, '')}
                                    </div>
                                  )}
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
                                    <button
                                      className="btn btn-secondary"
                                      style={{ fontSize: '0.65rem', padding: '2px 7px', color: 'var(--red)', borderColor: 'var(--red-border)' }}
                                      title="Dismiss this post"
                                      onClick={async () => {
                                        if (!confirm('Remove this post from the schedule?')) return
                                        setSaPosts(prev => prev.filter(x => x.id !== p.id))
                                        await fetch(`/api/admin/content/posts/${p.id}/dismiss`, { method: 'POST' })
                                      }}
                                    >×</button>
                                  </div>
                                </td>
                              </tr>
                            )
                          }),
                        ]
                      })}

                      {/* Published section (orphan posts) — collapsed by default */}
                      {showSaPublished && saPosts.filter(p => seenSaPostIds.has(p.id) && (p.status === 'published' || p.status === 'draft_saved')).map(p => {
                        const pageLabel = p.title ?? [p.service_name, p.city, p.state_abbr].filter(Boolean).join(' — ') ?? '—'
                        return (
                          <tr key={`sa-pub-${p.id}`}>
                            <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}>
                              <StatusPill status="published" />
                            </td>
                            <td style={{ padding: '8px', verticalAlign: 'middle', fontWeight: 500, fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pageLabel}</td>
                            <td style={{ padding: '8px', textAlign: 'right', verticalAlign: 'middle', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtDate(p.target_publish_date)}</td>
                            <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                {p.published_url && <a href={p.published_url} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: '0.65rem', padding: '2px 7px' }}>↗ Live</a>}
                                <button
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.65rem', padding: '2px 7px', color: 'var(--red)', borderColor: 'var(--red-border)' }}
                                  title="Dismiss this post"
                                  onClick={async () => {
                                    if (!confirm('Remove this post from the schedule?')) return
                                    setSaPosts(prev => prev.filter(x => x.id !== p.id))
                                    await fetch(`/api/admin/content/posts/${p.id}/dismiss`, { method: 'POST' })
                                  }}
                                >×</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                    {saPublishedCount > 0 && (
                      <button style={{ fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                        onClick={() => setShowSaPublished(v => !v)}>
                        {showSaPublished ? 'Hide' : 'Show'} Published ({saPublishedCount})
                      </button>
                    )}
                    {saRejectedCount > 0 && (
                      <button style={{ fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                        onClick={() => setShowSaRejected(v => !v)}>
                        {showSaRejected ? 'Hide' : 'Show'} Rejected ({saRejectedCount})
                      </button>
                    )}
                  </div>
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
          SECTION — REGULAR PAGES (pill: regular_page)
      ═══════════════════════════════════════════════════════════════════ */}
      {activePill === 'regular_page' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Header bar */}
          <div className="card p-4" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>Regular Pages</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                On-demand generation — define evergreen pages (About, FAQ, Resources, etc.) and generate them all at once or spaced over time.
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setShowRpWizard(true)}
              disabled={!aiConfigured}
              title={!aiConfigured ? 'Configure an AI provider in Agency Settings first' : undefined}
              style={{ flexShrink: 0 }}
            >
              Generate Regular Pages →
            </button>
          </div>

          {/* Collapsible guidelines */}
          <div
            className="card p-4 cursor-pointer select-none"
            onClick={() => setRpGuidelinesOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Article size={16} weight="duotone" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Content Guidelines</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--text-faint)', fontSize: '0.72rem', marginLeft: 4 }}>{rpGuidelinesOpen ? '▲' : '▼'}</span>
          </div>
          {rpGuidelinesOpen && (
            <div className="card p-5" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: -8 }}>
              <div style={{ marginBottom: '0.875rem' }}>
                <Label>Topic Guidelines</Label>
                <p className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
                  Additional instructions injected into the AI prompt when generating regular page content.
                </p>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="e.g. Write in a friendly, informative tone. These pages are evergreen — avoid time-sensitive references…"
                  value={rpGuidelines ?? ''}
                  onChange={e => setRpGuidelines(e.target.value || null)}
                  style={{ width: '100%', resize: 'vertical', fontSize: '0.8125rem' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setRpGuidelinesOpen(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveRpConfig} disabled={guidelinesSaving}>
                  {guidelinesSaving ? 'Saving…' : 'Save Guidelines'}
                </button>
              </div>
            </div>
          )}

          {/* SiloManager and PipelineCalendar sunset for regular pages — wizard-based flow replaces them */}
          {false && <SiloManager
            contentType="regular_page"
            contentTypeLabel="Regular Page"
            silos={silos}
            silosLoading={silosLoading}
            expandedSiloId={expandedSiloId}
            setExpandedSiloId={setExpandedSiloId}
            siloGenerating={siloGenerating}
            onCreateSilo={() => openCreateSiloModal('regular_page')}
            onEditSilo={openEditSiloModal}
            onArchiveSilo={handleDeleteSilo}
            onGenerateFromSilo={handleGenerateFromSilo}
            onMarkHubUpdated={handleMarkHubUpdated}
          />}
          {false && <PipelineCalendar
            clientId={clientId}
            contentType="regular_page"
            connectionId={schedule.connection_id ?? null}
            sites={clientSites}
            onShowToast={showToast}
            aiConfigured={aiConfigured}
            isActive={isActive && activePill === 'regular_page'}
            refreshSignal={rpRefreshSignal}
          />}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION — SILOS (pill: silos)
      ═══════════════════════════════════════════════════════════════════ */}
      {activePill === 'silos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card p-4" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', margin: 0 }}>Content Silos</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2, marginBottom: 0 }}>
                Organise blog content into topical clusters with hub pages and internal linking.
              </p>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => openCreateSiloModal('blog')}
              style={{ flexShrink: 0 }}
            >
              + New Silo
            </button>
          </div>
          <SiloManager
            contentType="blog"
            contentTypeLabel="Blog"
            silos={silos}
            silosLoading={silosLoading}
            expandedSiloId={expandedSiloId}
            setExpandedSiloId={setExpandedSiloId}
            siloGenerating={siloGenerating}
            onCreateSilo={() => openCreateSiloModal('blog')}
            onEditSilo={openEditSiloModal}
            onArchiveSilo={handleDeleteSilo}
            onGenerateFromSilo={handleGenerateFromSilo}
            onMarkHubUpdated={handleMarkHubUpdated}
          />
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

      {/* ═══════════════════════════════════════════════════════════════════
          SILO ARCHIVE CONFIRM DIALOG
      ═══════════════════════════════════════════════════════════════════ */}
      {siloArchiveConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ maxWidth: 380, width: '90%', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontWeight: 600, fontSize: '0.9375rem', margin: 0 }}>Archive silo?</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>
              This silo has active topics in the pipeline. Archiving will keep those topics but they&apos;ll no longer be associated with a silo.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button className="btn btn-secondary" onClick={() => setSiloArchiveConfirm(null)}>Cancel</button>
              <button className="btn btn-danger btn-sm" onClick={() => doArchiveSilo(siloArchiveConfirm)}>Archive Anyway</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SILO CREATE / EDIT MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      {siloModalOpen && (
        <SiloModal
          mode={siloModalMode}
          draft={draftSilo}
          saving={siloSaving}
          onChange={patch => setDraftSilo(d => ({ ...d, ...patch }))}
          onAddClusterKw={handleAddClusterKw}
          onRemoveClusterKw={handleRemoveClusterKw}
          onUpdateClusterKw={handleUpdateClusterKw}
          onMoveClusterKw={handleMoveClusterKw}
          onSave={handleSaveSilo}
          onClose={() => setSiloModalOpen(false)}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          PAGE GENERATION WIZARDS
      ═══════════════════════════════════════════════════════════════════ */}
      {showSpWizard && (
        <PageGenerationWizard
          clientId={clientId}
          contentType="service_page"
          onClose={() => setShowSpWizard(false)}
          onSuccess={() => {
            setShowSpWizard(false)
            setSpRefreshSignal(s => s + 1)
            showToast('Service pages queued for generation.', 'success')
          }}
        />
      )}
      {showRpWizard && (
        <PageGenerationWizard
          clientId={clientId}
          contentType="regular_page"
          onClose={() => setShowRpWizard(false)}
          onSuccess={() => {
            setShowRpWizard(false)
            setRpRefreshSignal(s => s + 1)
            showToast('Regular pages queued for generation.', 'success')
          }}
        />
      )}
    </div>
  )
}

// ─── Silo Manager ─────────────────────────────────────────────────────────────

interface SiloManagerProps {
  contentType: string
  contentTypeLabel: string
  silos: Silo[]
  silosLoading: boolean
  expandedSiloId: string | null
  setExpandedSiloId: (id: string | null) => void
  siloGenerating: Record<string, boolean>
  onCreateSilo: () => void
  onEditSilo: (silo: Silo) => void
  onArchiveSilo: (id: string) => void
  onGenerateFromSilo: (id: string, silo: Silo) => void
  onMarkHubUpdated: (id: string) => void
}

function SiloManager({
  contentType, contentTypeLabel, silos, silosLoading,
  expandedSiloId, setExpandedSiloId, siloGenerating,
  onCreateSilo, onEditSilo, onArchiveSilo, onGenerateFromSilo, onMarkHubUpdated,
}: SiloManagerProps) {
  const filtered = silos.filter(s => s.content_type === contentType)
  const badgeRef = useRef<Record<string, HTMLSpanElement | null>>({})

  useEffect(() => {
    filtered.forEach(s => {
      const el = badgeRef.current[s.id]
      if (el && s.pending_links?.length > 0) {
        el.classList.remove('silo-badge-pop')
        void el.offsetWidth
        el.classList.add('silo-badge-pop')
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.map(s => s.pending_links?.length).join(',')])

  return (
    <div className="card" style={{ padding: '14px 18px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h4 className="section-title" style={{ margin: 0, fontSize: '0.875rem' }}>{contentTypeLabel} Silos</h4>
        <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem' }} onClick={onCreateSilo}>
          + New Silo
        </button>
      </div>

      {silosLoading ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', margin: 0 }}>Loading silos…</p>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 6, opacity: 0.4 }}>◎</div>
          <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>No {contentTypeLabel.toLowerCase()} silos yet</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            Silos organize content into pillar-cluster groups for topical authority
          </p>
          <button className="btn btn-secondary btn-sm" onClick={onCreateSilo}>+ Create First Silo</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((s, idx) => {
            const isExpanded  = expandedSiloId === s.id
            const kwList      = Array.isArray(s.cluster_keywords) ? s.cluster_keywords : []
            const published   = kwList.filter(k => k.status === 'published').length
            const planned     = kwList.filter(k => k.status === 'planned').length
            const total       = kwList.length
            const pct         = total > 0 ? published / total : 0
            const pendCount   = s.pending_links?.length ?? 0
            const isGenerating = siloGenerating[s.id]

            return (
              <div
                key={s.id}
                className="silo-card-enter card"
                style={{ '--silo-i': idx } as React.CSSProperties}
              >
                {/* Card header */}
                <div
                  onClick={() => setExpandedSiloId(isExpanded ? null : s.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <span className="badge badge-blue" style={{ fontSize: '0.65rem', flexShrink: 0 }}>
                    {contentTypeLabel}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </span>
                  {pendCount > 0 && (
                    <span
                      ref={el => { badgeRef.current[s.id] = el }}
                      className="badge badge-amber"
                      style={{ fontSize: '0.65rem', flexShrink: 0 }}
                    >
                      {pendCount} link{pendCount !== 1 ? 's' : ''} ↑
                    </span>
                  )}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', flexShrink: 0 }}>
                    {published}/{total} kw
                  </span>
                  <span style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{isExpanded ? '▲' : '▼'}</span>
                </div>
                {/* Coverage progress bar */}
                {total > 0 && (
                  <div style={{ height: 3, background: 'var(--bg-subtle)', borderRadius: '0 0 0 0', overflow: 'hidden', marginTop: -1 }}>
                    <div style={{ display: 'flex', height: '100%' }}>
                      <div style={{ width: `${pct * 100}%`, background: 'var(--green)', transition: 'width 0.3s' }} />
                      <div style={{ width: `${(planned / total) * 100}%`, background: 'var(--amber)', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}

                {/* Expandable body using CSS Grid pattern */}
                <div className={`silo-body-grid${isExpanded ? ' expanded' : ''}`}>
                  <div>
                    <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                      {/* Target info */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        {s.hub_page_url && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Hub:
                            <a href={s.hub_page_url} target="_blank" rel="noreferrer" style={{ marginLeft: 4, color: 'var(--blue)' }}>
                              {s.hub_page_url.length > 40 ? '…' + s.hub_page_url.slice(-32) : s.hub_page_url} ↗
                            </a>
                          </span>
                        )}
                        <span style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: 3, background: s.target_exists ? 'var(--green-subtle)' : 'var(--amber-subtle)', color: s.target_exists ? 'var(--green)' : 'var(--amber)' }}>
                          {s.target_exists ? '✓ hub exists' : '⚠ hub not created'}
                        </span>
                      </div>
                      {s.target_keyword && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                          Target keyword: <em>&ldquo;{s.target_keyword}&rdquo;</em>
                        </p>
                      )}

                      {/* Cluster keywords list */}
                      {kwList.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                            Cluster Keywords ({total})
                          </p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 120, overflowY: 'auto' }}>
                            {kwList.map(k => (
                              <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
                                <span style={{ color: k.status === 'published' ? 'var(--green)' : 'var(--text-faint)' }}>
                                  {k.status === 'published' ? '✓' : '○'}
                                </span>
                                <span style={{ flex: 1, color: 'var(--text-primary)' }}>&ldquo;{k.keyword}&rdquo;</span>
                                <span style={{ color: 'var(--text-faint)', fontSize: '0.65rem' }}>[{k.status}]</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Pending links */}
                      {pendCount > 0 && (
                        <div style={{ padding: '8px 10px', background: 'var(--amber-subtle)', border: '1px solid var(--amber-border, #fde68a)', borderRadius: 5, marginBottom: 8 }}>
                          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--amber)', marginBottom: 4 }}>
                            {pendCount} cluster page{pendCount !== 1 ? 's' : ''} ready — update hub page on WordPress
                          </p>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.7rem' }}
                            onClick={() => onMarkHubUpdated(s.id)}
                          >
                            Mark hub updated
                          </button>
                        </div>
                      )}

                      {/* Action row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.72rem' }} onClick={() => onEditSilo(s)}>
                            Edit Silo
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.72rem', color: 'var(--red)' }}
                            onClick={() => onArchiveSilo(s.id)}
                          >
                            Archive
                          </button>
                        </div>
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ fontSize: '0.75rem' }}
                          disabled={isGenerating}
                          onClick={() => onGenerateFromSilo(s.id, s)}
                        >
                          {isGenerating
                            ? 'Generating…'
                            : s.target_exists === false
                              ? `Generate Hub ${contentTypeLabel} First →`
                              : `Generate ${contentTypeLabel} Topics →`
                          }
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
    </div>
  )
}

// ─── Silo Modal ───────────────────────────────────────────────────────────────

interface SiloModalProps {
  mode: 'create' | 'edit'
  draft: {
    name: string; content_type: string; hub_page_url: string; hub_page_title: string
    target_keyword: string; target_exists: boolean; cluster_keywords: ClusterKw[]; priority: number; section: string
  }
  saving: boolean
  onChange: (patch: Partial<SiloModalProps['draft']>) => void
  onAddClusterKw: () => void
  onRemoveClusterKw: (id: string) => void
  onUpdateClusterKw: (id: string, field: keyof ClusterKw, value: string) => void
  onMoveClusterKw: (id: string, dir: 'up' | 'down') => void
  onSave: () => void
  onClose: () => void
}

function SiloModal({ mode, draft, saving, onChange, onAddClusterKw, onRemoveClusterKw, onUpdateClusterKw, onMoveClusterKw, onSave, onClose }: SiloModalProps) {
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const PRIORITY_TIERS = [
    { label: 'High',   value: 25  },
    { label: 'Medium', value: 100 },
    { label: 'Low',    value: 175 },
  ]

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="card" style={{ maxWidth: 480, width: '100%', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>
            {mode === 'create' ? 'Create Silo' : 'Edit Silo'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.125rem', padding: 4 }}>×</button>
        </div>

        {/* Body — scrollable */}
        <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Name */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Silo Name *</label>
            <input ref={nameRef} className="input" value={draft.name} onChange={e => onChange({ name: e.target.value })} placeholder="e.g. HVAC Repair" />
          </div>

          {/* Content Type */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Content Type</label>
            <div style={{ display: 'flex', gap: 4, padding: '3px', background: 'var(--bg-subtle)', borderRadius: 7, border: '1px solid var(--border)', alignSelf: 'flex-start', width: 'fit-content' }}>
              {([['blog', 'Blog'], ['service_page', 'Service Page'], ['regular_page', 'Regular Page']] as const).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => onChange({ content_type: val })}
                  style={{
                    padding: '0.28rem 0.75rem', fontSize: '0.8rem', borderRadius: 5, border: 'none', cursor: 'pointer',
                    fontWeight: draft.content_type === val ? 600 : 400,
                    background: draft.content_type === val ? 'var(--bg-surface)' : 'transparent',
                    color: draft.content_type === val ? 'var(--text-primary)' : 'var(--text-muted)',
                    boxShadow: draft.content_type === val ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Hub URL + Title */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Hub Page URL</label>
              <input className="input" value={draft.hub_page_url} onChange={e => onChange({ hub_page_url: e.target.value })} placeholder="https://…" />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Hub Page Title</label>
              <input className="input" value={draft.hub_page_title} onChange={e => onChange({ hub_page_title: e.target.value })} placeholder="e.g. HVAC Repair Services" />
            </div>
          </div>

          {/* Target Keyword */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Target Keyword</label>
            <input className="input" value={draft.target_keyword} onChange={e => onChange({ target_keyword: e.target.value })} placeholder="e.g. hvac repair denver" />
          </div>

          {/* Hub exists toggle */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={draft.target_exists} onChange={e => onChange({ target_exists: e.target.checked })} style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>Hub page already exists</span>
            </label>
            {!draft.target_exists && (
              <p style={{ fontSize: '0.75rem', color: 'var(--amber)', marginTop: 4, marginLeft: 26 }}>
                ⚠ Hub page will be generated first before any cluster articles
              </p>
            )}
          </div>

          {/* Priority */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Priority</label>
            <div style={{ display: 'flex', gap: 4, padding: '3px', background: 'var(--bg-subtle)', borderRadius: 7, border: '1px solid var(--border)', alignSelf: 'flex-start', width: 'fit-content' }}>
              {PRIORITY_TIERS.map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChange({ priority: value })}
                  style={{
                    padding: '0.28rem 0.75rem', fontSize: '0.8rem', borderRadius: 5, border: 'none', cursor: 'pointer',
                    fontWeight: draft.priority === value ? 600 : 400,
                    background: draft.priority === value ? 'var(--bg-surface)' : 'transparent',
                    color: draft.priority === value ? 'var(--text-primary)' : 'var(--text-muted)',
                    boxShadow: draft.priority === value ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Cluster Keywords */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                Cluster Keywords ({draft.cluster_keywords.length})
              </label>
              <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: '0.7rem' }} onClick={onAddClusterKw}>
                + Add Keyword
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
              {draft.cluster_keywords.length === 0 && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', padding: '6px 0' }}>
                  No keywords yet — add cluster keywords to guide AI generation
                </p>
              )}
              {draft.cluster_keywords.map((kw, idx) => (
                <div key={kw.id} className={idx === draft.cluster_keywords.length - 1 && draft.cluster_keywords.length > 1 ? 'silo-cluster-row-enter' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <input
                    className="input"
                    style={{ flex: 2, fontSize: '0.8rem' }}
                    value={kw.keyword}
                    onChange={e => onUpdateClusterKw(kw.id, 'keyword', e.target.value)}
                    placeholder="e.g. emergency hvac repair"
                  />
                  <input
                    className="input"
                    style={{ flex: 1.5, fontSize: '0.8rem' }}
                    value={kw.title ?? ''}
                    onChange={e => onUpdateClusterKw(kw.id, 'title', e.target.value)}
                    placeholder="Suggested title (optional)"
                  />
                  <select
                    className="input"
                    style={{ width: 100, fontSize: '0.75rem' }}
                    value={kw.status}
                    onChange={e => onUpdateClusterKw(kw.id, 'status', e.target.value)}
                  >
                    <option value="planned">planned</option>
                    <option value="published">published</option>
                  </select>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                    <button type="button" onClick={() => onMoveClusterKw(kw.id, 'up')} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx > 0 ? 'pointer' : 'default', color: idx > 0 ? 'var(--text-muted)' : 'var(--border)', fontSize: '0.65rem', padding: '0 2px', lineHeight: 1 }}>▲</button>
                    <button type="button" onClick={() => onMoveClusterKw(kw.id, 'down')} disabled={idx === draft.cluster_keywords.length - 1} style={{ background: 'none', border: 'none', cursor: idx < draft.cluster_keywords.length - 1 ? 'pointer' : 'default', color: idx < draft.cluster_keywords.length - 1 ? 'var(--text-muted)' : 'var(--border)', fontSize: '0.65rem', padding: '0 2px', lineHeight: 1 }}>▼</button>
                  </div>
                  <button type="button" onClick={() => onRemoveClusterKw(kw.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '0.9rem', padding: '0 2px', flexShrink: 0 }}>×</button>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 6 }}>
              Keywords are ordered by priority (top = highest). URLs auto-populated when pages publish.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving || !draft.name.trim()}>
            {saving ? 'Saving…' : mode === 'create' ? 'Create Silo' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Pipeline Calendar ────────────────────────────────────────────────────────
// Self-contained content pipeline for service_page or regular_page content types.
// Manages its own data fetching, actions, and UI so the parent stays lean.

interface PipelineCalendarProps {
  clientId:      string
  contentType:   'service_page' | 'regular_page'
  connectionId:  string | null
  sites:         SiteOption[]
  onShowToast:   (msg: string, type?: 'success' | 'error' | 'info') => void
  aiConfigured:  boolean
  isActive:      boolean
  refreshSignal: number
}

function PipelineCalendar({
  clientId, contentType, connectionId, sites,
  onShowToast, aiConfigured, isActive, refreshSignal,
}: PipelineCalendarProps) {
  const [topics,         setTopics]         = useState<Topic[]>([])
  const [posts,          setPosts]          = useState<Post[]>([])
  const [loading,        setLoading]        = useState(true)
  const [showRejected,   setShowRejected]   = useState(false)
  const [expandedId,     setExpandedId]     = useState<string | null>(null)
  const [editingId,      setEditingId]      = useState<string | null>(null)
  const [editTitle,      setEditTitle]      = useState('')
  const [editNotes,      setEditNotes]      = useState('')
  const [topicLoading,   setTopicLoading]   = useState<Record<string, boolean>>({})
  const [slotGenerating, setSlotGenerating] = useState<Record<string, boolean>>({})
  const [reviewPost,     setReviewPost]     = useState<Post | null>(null)
  const [calModalOpen,   setCalModalOpen]   = useState(false)
  const [modalStartDate, setModalStartDate] = useState(today())
  const [modalWeeks,     setModalWeeks]     = useState(6)
  const [generating,     setGenerating]     = useState(false)
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const topicsRef = useRef<Topic[]>([])
  useEffect(() => { topicsRef.current = topics }, [topics])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  useEffect(() => {
    if (!isActive) { setCalModalOpen(false); setReviewPost(null) }
  }, [isActive])

  const loadPipeline = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/admin/content/topics?client_id=${clientId}&content_type=${contentType}`).then(r => r.json()),
      fetch(`/api/admin/content/posts?client_id=${clientId}&content_type=${contentType}`).then(r => r.json()),
    ]).then(([t, p]) => {
      setTopics(Array.isArray(t) ? t as Topic[] : [])
      setPosts(Array.isArray(p)  ? p  as Post[]  : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [clientId, contentType])

  useEffect(() => { loadPipeline() }, [loadPipeline])
  useEffect(() => { if (refreshSignal > 0) loadPipeline() }, [refreshSignal, loadPipeline])

  async function topicAction(id: string, status: 'approved' | 'rejected') {
    setTopicLoading(p => ({ ...p, [id]: true }))
    const res = await fetch(`/api/admin/content/topics/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setTopicLoading(p => ({ ...p, [id]: false }))
    if (res.ok) {
      setTopics(p => p.map(t => t.id === id ? { ...t, status } : t))
      onShowToast(status === 'approved' ? 'Topic approved' : 'Topic rejected')
    } else { onShowToast('Action failed', 'error') }
  }

  function generatePost(topicId: string) {
    setTopics(prev => prev.map(t => t.id === topicId ? { ...t, status: 'generating' } : t))
    onShowToast('Post generation started — check back shortly', 'info')
    fetch('/api/admin/content/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: topicId, suppress_email: true }),
    }).catch(e => console.error('[PipelineCalendar.generatePost]', e))
  }

  function generateForSlot(dateKey: string, group: Topic[]) {
    const approved = group.filter(t => t.status === 'approved')
    if (!approved.length) return
    setSlotGenerating(p => ({ ...p, [dateKey]: true }))
    setTopics(prev => prev.map(t => approved.find(a => a.id === t.id) ? { ...t, status: 'generating' } : t))
    onShowToast(`Generating ${approved.length} post${approved.length !== 1 ? 's' : ''}…`, 'info')
    Promise.all(approved.map(t =>
      fetch('/api/admin/content/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: t.id, suppress_email: true }),
      }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }).catch(e => {
        console.error('[PipelineCalendar.generateForSlot]', e)
        setTopics(prev => prev.map(topic => topic.id === t.id ? { ...topic, status: 'approved' } : topic))
      })
    )).finally(() => setSlotGenerating(p => ({ ...p, [dateKey]: false })))
  }

  async function retryGenerate(topicId: string) {
    setTopicLoading(p => ({ ...p, [topicId]: true }))
    await fetch(`/api/admin/content/topics/${topicId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    setTopics(prev => prev.map(t => t.id === topicId ? { ...t, status: 'approved', generation_error: null } : t))
    setTopicLoading(p => ({ ...p, [topicId]: false }))
    generatePost(topicId)
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim()) { onShowToast('Title cannot be empty', 'error'); return }
    setTopicLoading(p => ({ ...p, [id]: true }))
    const res = await fetch(`/api/admin/content/topics/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: editTitle.trim(), edit_notes: editNotes.trim() || null }),
    })
    setTopicLoading(p => ({ ...p, [id]: false }))
    if (res.ok) {
      setTopics(p => p.map(t => t.id === id ? { ...t, topic: editTitle.trim(), edit_notes: editNotes.trim() || null } : t))
      setEditingId(null)
      onShowToast('Title updated')
    } else { onShowToast('Failed to update', 'error') }
  }

  async function cleanSlot(topicIds: string[]) {
    const res = await fetch('/api/admin/content/topics/bulk-reject', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_ids: topicIds, client_id: clientId }),
    })
    if (res.ok) {
      setTopics(p => p.map(t => topicIds.includes(t.id) ? { ...t, status: 'rejected' } : t))
      onShowToast(`Cleaned up ${topicIds.length} stale topic${topicIds.length !== 1 ? 's' : ''}`)
    } else { onShowToast('Cleanup failed', 'error') }
  }

  async function generateCalendar(e: React.FormEvent) {
    e.preventDefault()
    setGenerating(true)
    const res = await fetch('/api/admin/content/calendar/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, start_date: modalStartDate, weeks_ahead: modalWeeks, content_type: contentType }),
    })
    const data = await res.json() as { ok?: boolean; queued?: boolean; count?: number; error?: string }
    setGenerating(false)
    if (res.ok) {
      setCalModalOpen(false)
      if (data.queued) {
        onShowToast('Topics are generating — they\'ll appear here automatically', 'info')
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
              onShowToast(`${topicsRef.current.length - prevCount} topics generated`, 'success')
          }
        }, 15_000)
      } else {
        onShowToast(`${data.count ?? 0} topics generated`)
        loadPipeline()
      }
    } else { onShowToast(data.error || 'Generation failed', 'error') }
  }

  // ── Build calendar data ──────────────────────────────────────────────────────
  const allItems: RowItem[] = []
  const seenPostIds = new Set<string>()
  const topicIdToPost = new Map<string, Post>()

  topics.forEach(t => {
    const linkedPost = t.post?.id
      ? posts.find(p => p.id === t.post!.id)
      : posts.find(p => p.target_keyword === t.target_keyword && p.target_publish_date === t.target_publish_date && !seenPostIds.has(p.id))
    if (linkedPost) { seenPostIds.add(linkedPost.id); topicIdToPost.set(t.id, linkedPost) }
    allItems.push({ kind: 'topic', data: t })
  })
  posts.forEach(p => {
    if (!seenPostIds.has(p.id) && ['for_review', 'draft_saved', 'published'].includes(p.status))
      allItems.push({ kind: 'post', data: p })
  })

  const groups = new Map<string, RowItem[]>()
  for (const item of allItems) {
    const date = item.data.target_publish_date ?? 'unscheduled'
    const arr = groups.get(date) ?? []; arr.push(item); groups.set(date, arr)
  }
  const dateKeys = Array.from(groups.keys()).filter(k => k !== 'unscheduled').sort((a, b) => a.localeCompare(b))
  if (groups.has('unscheduled')) dateKeys.push('unscheduled')
  const statusCounts = computeStatusCounts(topics, posts)
  const rejectedCount = topics.filter(t => t.status === 'rejected').length + posts.filter(p => p.status === 'rejected').length
  const typeLabel = contentType === 'service_page' ? 'Service Page' : 'Regular Page'

  return (
    <>
      {/* AI Content Plan card */}
      {aiConfigured ? (
        <div className="card" style={{ borderLeft: '3px solid var(--accent, #2563eb)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-subtle, #eff6ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #2563eb)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>AI {typeLabel} Plan</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Generate 1 {typeLabel.toLowerCase()} topic per publish slot</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setCalModalOpen(true)} style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
            Generate Plan
          </button>
        </div>
      ) : (
        <div style={{ padding: '10px 14px', marginBottom: 12, fontSize: '0.8125rem', color: 'var(--text-faint)', background: 'var(--bg-subtle)', borderRadius: 6, border: '1px solid var(--border)' }}>
          AI not configured — add a provider in Settings to generate content plans
        </div>
      )}

      {/* Calendar table */}
      <div className="card p-6">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h4 className="section-title" style={{ margin: 0 }}>{typeLabel} Calendar</h4>
        </div>
        {!loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
            <ContentStatusBar counts={statusCounts} />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', flexShrink: 0, marginLeft: 12 }}>{topics.length + posts.length} items</span>
          </div>
        )}
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : allItems.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-faint)', padding: '1rem 0' }}>
            No topics yet — click &quot;Generate Plan&quot; or generate topics from a silo above.
          </p>
        ) : (
          <div>
            <table className="data-table" style={{ width: '100%', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 130 }} /><col /><col style={{ width: 110 }} /><col style={{ width: 130 }} />
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
                      if (item.kind === 'post'  && item.data.status === 'rejected') return false
                    }
                    if (item.kind === 'post' && (item.data.status === 'draft_saved' || item.data.status === 'published')) return false
                    return true
                  })
                  if (group.length === 0) return null

                  const topicsInGroup      = group.filter(r => r.kind === 'topic').map(r => r.data as Topic)
                  const approvedInGroup    = topicsInGroup.filter(t => ['approved', 'generating', 'generated'].includes(t.status)).length
                  const generatableInGroup = topicsInGroup.filter(t => t.status === 'approved').length
                  const slotReady         = approvedInGroup >= 1 && generatableInGroup > 0
                  // Check unfiltered slot for generated/published content (filter hides draft_saved/published)
                  const rawSlotItems = groups.get(dateKey) ?? []
                  const hasGeneratedInSlot = rawSlotItems.some(r =>
                    (r.kind === 'topic' && r.data.status === 'generated') ||
                    (r.kind === 'post'  && ['for_review', 'draft_saved', 'published'].includes(r.data.status))
                  )
                  const staleTopicIds = topicsInGroup.filter(t => ['pending', 'approved'].includes(t.status)).map(t => t.id)
                  const showCleanup   = hasGeneratedInSlot && staleTopicIds.length > 0

                  return [
                    <tr key={`hdr-${dateKey}`} style={{ background: 'var(--bg-subtle)' }}>
                      <td colSpan={4} style={{ padding: '5px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                            {dateKey === 'unscheduled' ? 'Unscheduled' : fmtDate(dateKey)}
                          </span>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: approvedInGroup >= 1 ? 'var(--green)' : 'var(--border)' }} />
                          <span style={{ fontSize: '0.68rem', color: slotReady ? 'var(--green)' : 'var(--text-faint)' }}>
                            {approvedInGroup >= 1 ? '✓' : '0/1'}
                          </span>
                          {slotReady && (
                            <button className="btn btn-secondary"
                              style={{ fontSize: '0.65rem', padding: '1px 7px', color: 'var(--blue)', marginLeft: 4 }}
                              onClick={() => generateForSlot(dateKey, topicsInGroup)}
                              disabled={slotGenerating[dateKey]}
                            >
                              {slotGenerating[dateKey] ? '…' : <><Play size={10} weight="fill" style={{ marginRight: 3 }} />Generate Slot</>}
                            </button>
                          )}
                          {showCleanup && (
                            <button className="btn btn-secondary"
                              style={{ fontSize: '0.65rem', padding: '1px 7px', color: 'var(--text-faint)', marginLeft: 'auto' }}
                              onClick={() => cleanSlot(staleTopicIds)}
                              title="Remove stale topics — a post already exists for this slot"
                            >
                              Clean up ({staleTopicIds.length})
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>,

                    ...group.map(item => {
                      const id = item.data.id
                      const isExpanded = expandedId === id
                      const isEditing  = editingId  === id

                      if (item.kind === 'topic') {
                        const t = item.data
                        const linkedPost    = topicIdToPost.get(t.id)
                        const displayStatus = (linkedPost?.status === 'draft_saved' || linkedPost?.status === 'published') ? 'published' as const : getTopicDisplayStatus(t)
                        const hasDetail     = !!(t.keyword_opportunity || t.ranking_strategy || t.audience_intent || t.why_now || t.competition_level)
                        const hasReview     = linkedPost && ['for_review', 'generated', 'draft_saved'].includes(linkedPost.status)
                        const hasError      = !!t.generation_error && !['rejected', 'generated'].includes(t.status)

                        return [
                          <tr key={`topic-${t.id}`}
                            style={{ cursor: hasDetail ? 'pointer' : 'default', background: isExpanded ? 'var(--bg-subtle)' : undefined, borderLeft: hasError ? '2px solid #f59e0b' : undefined }}
                            onClick={() => { if (hasDetail && !isEditing) setExpandedId(isExpanded ? null : id) }}
                          >
                            <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <StatusPill status={displayStatus} generating={t.status === 'generating'} />
                                {hasError && <span title={t.generation_error ?? ''} style={{ fontSize: '0.7rem', color: '#f59e0b', cursor: 'help' }}>⚠</span>}
                              </div>
                            </td>
                            <td style={{ padding: '8px', verticalAlign: 'middle' }}>
                              <div style={{ fontWeight: 500, fontSize: '0.8125rem', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {t.topic}{hasDetail && <span style={{ fontSize: '0.6rem', marginLeft: 4, opacity: 0.5 }}>↗</span>}
                              </div>
                              {t.target_keyword && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>
                                  {t.target_keyword}
                                  {t.cluster_group && <span style={{ marginLeft: 5, fontSize: '0.62rem', background: 'var(--bg-muted)', padding: '0 4px', borderRadius: 3 }}>{t.cluster_group}</span>}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', verticalAlign: 'middle', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {fmtDate(t.target_publish_date)}
                            </td>
                            <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                {hasReview && (
                                  <button className="btn btn-primary" style={{ fontSize: '0.65rem', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                    onClick={() => setReviewPost(linkedPost!)}>
                                    <ArrowRight size={11} weight="bold" /> {linkedPost?.status === 'draft_saved' ? 'Edit' : 'Review'}
                                  </button>
                                )}
                                {hasError && (
                                  <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: '0.65rem', color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                    onClick={() => retryGenerate(t.id)} disabled={topicLoading[t.id]} title="Retry generation">
                                    <ArrowClockwise size={11} weight="bold" /> Retry
                                  </button>
                                )}
                                {t.status === 'approved' && !hasReview && (
                                  <button className="btn btn-secondary" style={{ padding: '2px 6px', color: 'var(--blue)', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => generatePost(t.id)} title="Generate post now">
                                    <Play size={12} weight="fill" />
                                  </button>
                                )}
                                {!['approved', 'generating', 'generated'].includes(t.status) && (
                                  <button className="btn btn-secondary" style={{ padding: '2px 6px', color: 'var(--green)', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => topicAction(t.id, 'approved')} disabled={topicLoading[t.id]} title="Approve topic">
                                    <Check size={12} weight="bold" />
                                  </button>
                                )}
                                {!['generating', 'generated', 'rejected'].includes(t.status) && (
                                  <button className="btn btn-secondary" style={{ padding: '2px 6px', color: 'var(--red)', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => topicAction(t.id, 'rejected')} disabled={topicLoading[t.id]} title="Reject topic">
                                    <X size={12} weight="bold" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>,
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
                                </div>
                              </td>
                            </tr>
                          ),
                          isEditing && (
                            <tr key={`edit-${t.id}`}>
                              <td colSpan={4} style={{ padding: '4px 0 12px 0', background: 'var(--bg-subtle)' }}>
                                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <input className="input" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Topic title" style={{ fontSize: '0.875rem' }} autoFocus />
                                  <textarea className="input" rows={2} value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Direction notes (optional)" style={{ fontSize: '0.8125rem', resize: 'vertical' }} />
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button className="btn btn-primary btn-sm" onClick={() => saveEdit(t.id)}>Save</button>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ),
                        ]
                      }

                      // Orphan post row
                      const p = item.data as Post
                      const displayStatus = getPostDisplayStatus(p)
                      const siteUrl = p.published_url ?? (p.wp_site_url ? `${p.wp_site_url}/wp-admin/post.php?post=${p.wp_post_id}&action=edit` : null)
                      return (
                        <tr key={`post-${p.id}`}>
                          <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}><StatusPill status={displayStatus} /></td>
                          <td style={{ padding: '8px', verticalAlign: 'middle' }}>
                            <div style={{ fontWeight: 500, fontSize: '0.8125rem' }}>{p.title ?? p.seo_title ?? '—'}</div>
                            {p.target_keyword && <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 1 }}>{p.target_keyword}</div>}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', verticalAlign: 'middle', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(p.target_publish_date)}</td>
                          <td style={{ padding: '8px 0 8px 8px', textAlign: 'right', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              <button className="btn btn-primary" style={{ fontSize: '0.65rem', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }} onClick={() => setReviewPost(p)}>
                                <ArrowRight size={11} weight="bold" /> {p.status === 'draft_saved' ? 'Edit' : 'Review'}
                              </button>
                              {siteUrl && <a href={siteUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: '0.65rem', padding: '2px 7px' }}>↗ Live</a>}
                            </div>
                          </td>
                        </tr>
                      )
                    }),
                  ]
                })}
              </tbody>
            </table>
            {rejectedCount > 0 && (
              <button style={{ marginTop: 10, fontSize: '0.72rem', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                onClick={() => setShowRejected(r => !r)}>
                {showRejected ? 'Hide' : 'Show'} Rejected ({rejectedCount})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Calendar generate modal */}
      {calModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setCalModalOpen(false) }}>
          <div className="card" style={{ maxWidth: 460, width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>Generate {typeLabel} Plan</h3>
              <button onClick={() => setCalModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.125rem', padding: 4 }}>×</button>
            </div>
            <form onSubmit={generateCalendar} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <Label>Start Date</Label>
                <input className="input" type="date" value={modalStartDate} onChange={e => setModalStartDate(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <Label>Weeks to Plan</Label>
                <input className="input" type="number" min={1} max={24} value={modalWeeks} onChange={e => setModalWeeks(Number(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div style={{ borderRadius: '0.375rem', padding: '0.625rem 0.875rem', background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)' }}>
                <p className="text-xs" style={{ color: 'var(--blue)' }}>
                  Creates 1 {typeLabel.toLowerCase()} topic per slot across {modalWeeks} week{modalWeeks !== 1 ? 's' : ''}. Topics are assigned to your silos by priority.
                </p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCalModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={generating}>{generating ? 'Generating…' : 'Generate →'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Post review editor */}
      {reviewPost && (
        <ContentPostEditor
          postId={reviewPost.id}
          defaultConnectionId={connectionId}
          sites={sites}
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
    </>
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
