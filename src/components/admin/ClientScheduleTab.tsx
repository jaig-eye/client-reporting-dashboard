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
  id:                  string
  topic:               string
  target_keyword:      string | null
  status:              string
  target_publish_date: string | null
  rationale:           string | null
  competition_level:   string | null
  search_intent:       string | null
  keyword_opportunity: string | null
  ranking_strategy:    string | null
  audience_intent:     string | null
  why_now:             string | null
  search_volume:       number | null
  keyword_difficulty:  number | null
  seo_brief:           Record<string, unknown> | null
  cannibalization_warning?: string | null
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

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:    { label: 'Pending',    cls: 'badge badge-amber'  },
  approved:   { label: 'Approved',   cls: 'badge badge-green'  },
  generating: { label: 'Generating', cls: 'badge badge-blue'   },
  generated:  { label: 'Generated ✓', cls: 'badge badge-green'  },
  scheduled:  { label: 'Scheduled',  cls: 'badge badge-gray'   },
  rejected:   { label: 'Rejected',   cls: 'badge badge-red'    },
  draft_saved:{ label: 'On Site',     cls: 'badge badge-green'  },
  for_review: { label: 'For Review',  cls: 'badge badge-amber'  },
  published:  { label: 'Published',  cls: 'badge badge-green'  },
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

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
      <h4 className="section-title" style={{ margin: 0 }}>{title}</h4>
      {action}
    </div>
  )
}

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

  // Pipeline data
  const [topics,         setTopics]        = useState<Topic[]>([])
  const [posts,          setPosts]         = useState<Post[]>([])
  const [dataLoading,    setDataLoading]   = useState(true)
  const [postTab,        setPostTab]       = useState<'draft_saved' | 'published' | 'rejected'>('draft_saved')

  // Topic action states
  const [topicLoading,   setTopicLoading]  = useState<Record<string, boolean>>({})
  const [rationaleFor,   setRationaleFor]  = useState<Topic | null>(null)
  const [slotGenerating, setSlotGenerating] = useState<Record<string, boolean>>({})
  const [reviewPost,     setReviewPost]    = useState<Post | null>(null)

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)

  // Calendar modal
  const [calendarModalOpen, setCalendarModalOpen] = useState(false)
  const [modalStartDate, setModalStartDate] = useState(today())
  const [modalWeeks,     setModalWeeks]     = useState(6)
  const [generating,     setGenerating]     = useState(false)

  // ── Load schedule settings ─────────────────────────────────────────────────
  useEffect(() => {
    setSchedLoading(true)
    fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        setSchedule({
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
        })
        setModalStartDate(d.schedule_start_date ? String(d.schedule_start_date) : today())
        setModalWeeks((d.weeks_ahead as number) ?? 6)
        setSchedLoading(false)
      })
      .catch(() => setSchedLoading(false))
  }, [clientId])

  // ── Auto-set connection_id from the client's only site ────────────────────
  useEffect(() => {
    if (!schedule.connection_id && clientSites[0]?.connectionId) {
      setSched('connection_id', clientSites[0].connectionId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSites])

  // ── Load authors from first connected site ─────────────────────────────────
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

  // ── Toast helper ───────────────────────────────────────────────────────────
  function showToast(msg: string, type: 'success' | 'error' | 'info' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3800)
  }

  // ── Schedule save ──────────────────────────────────────────────────────────
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

  // ── Topic regenerate ──────────────────────────────────────────────────────
  async function regenerateTopic(id: string) {
    setTopicLoading(p => ({ ...p, [id]: true }))
    const res = await fetch(`/api/admin/content/topics/${id}/regenerate`, { method: 'POST' })
    setTopicLoading(p => ({ ...p, [id]: false }))
    if (res.ok) {
      const updated = await res.json() as Topic
      setTopics(p => p.map(t => t.id === id ? { ...t, ...updated } : t))
      showToast('New idea generated')
    } else {
      const d = await res.json()
      showToast(d.error || 'Regeneration failed', 'error')
    }
  }

  // ── Topic approve / reject ─────────────────────────────────────────────────
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

  // ── Force-generate a post from an approved topic (fire-and-forget) ────────
  function generatePost(topicId: string) {
    setTopics(prev => prev.map(t => t.id === topicId ? { ...t, status: 'generating' } : t))
    showToast('Post generation started — check back shortly', 'info')
    fetch('/api/admin/content/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: topicId, suppress_email: true }),
    }).catch(e => console.error('[generatePost]', e))
  }

  // ── Force-generate all approved topics in a date slot (fire-and-forget) ───
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

  // ── Derived data ───────────────────────────────────────────────────────────
  const forReviewPosts = posts.filter(p => p.status === 'for_review')
  const postsForTab    = posts.filter(p => p.status === postTab)

  const postsPerRun    = schedule.posts_per_run  ?? 2
  const topicsPerRun   = schedule.topics_per_run ?? 5

  const freqSummary    = schedule.schedule_frequency
    ? `${FREQ_LABEL[schedule.schedule_frequency] ?? schedule.schedule_frequency} · ${topicsPerRun} topic${topicsPerRun !== 1 ? 's' : ''}/run`
    : `${topicsPerRun} topic${topicsPerRun !== 1 ? 's' : ''}/run`

  const willCreate     = Math.min(modalWeeks * topicsPerRun, 50)
  const showDayPicker  = schedule.schedule_frequency === 'weekly' || schedule.schedule_frequency === 'biweekly'

  if (schedLoading) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION A — SCHEDULE CONFIGURATION
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="card p-6">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <h3 className="section-title" style={{ marginBottom: 0 }}>Schedule Configuration</h3>
            <p className="section-desc" style={{ marginTop: '0.125rem' }}>Controls how often content is generated and published for this client.</p>
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
            rows={5}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
            value={schedule.post_structure ?? ''}
            onChange={e => setSched('post_structure', e.target.value)}
            placeholder={`e.g.\nAlways link to at least 2 priority pages listed in the context.\nNever link to excluded pages.\nInclude E-E-A-T signals: cite the business's years of experience, named staff expertise, or accreditations where natural.\nUse always-included links in the body with descriptive anchor text — never raw URLs.`}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)', lineHeight: 1.5 }}>
            This text is appended to the master writing prompt on every generation.
            Priority pages, excluded pages, and always-included links from Brand DNA are already injected as context — use this field to give the AI explicit instructions on how to use them (E-E-A-T signals, linking rules, section boilerplate, CTA style, etc.).
          </p>
        </div>

        <div className="flex items-center gap-3" style={{ marginTop: '1rem' }}>
          <button className="btn btn-primary" onClick={saveSchedule} disabled={schedSaving}>
            {schedSaving ? 'Saving…' : 'Save Schedule'}
          </button>
          {schedSaved  && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {schedError  && <span className="text-xs" style={{ color: 'var(--red)' }}>{schedError}</span>}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION B — CONTENT CALENDAR (Generate + Pipeline)
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="card p-6">
        <SectionHeader
          title="Content Calendar"
          action={
            aiConfigured ? (
              <button
                className="btn btn-primary"
                style={{ fontSize: '0.8125rem', padding: '0.375rem 0.875rem' }}
                onClick={() => setCalendarModalOpen(true)}
              >
                Generate Topics →
              </button>
            ) : (
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>AI not configured</span>
            )
          }
        />

        {/* Active Topics — grouped by publish date */}
        {(() => {
          const allPending = topics.filter(t => ['pending', 'approved', 'scheduled', 'generating'].includes(t.status))
          // Group by publish date (undefined → 'unscheduled')
          const groups = new Map<string, Topic[]>()
          for (const t of allPending) {
            const key = t.target_publish_date ?? 'unscheduled'
            const arr = groups.get(key) ?? []
            arr.push(t)
            groups.set(key, arr)
          }
          const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
            if (a === 'unscheduled') return 1
            if (b === 'unscheduled') return -1
            return a.localeCompare(b)
          })

          return (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ marginBottom: '0.75rem' }}>
                <span className="text-sm font-medium">
                  Active Topics{' '}
                  <span style={{ color: 'var(--text-faint)' }}>({allPending.length})</span>
                </span>
              </div>

              {dataLoading ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : allPending.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
                  {topics.length === 0
                    ? 'No topics yet — click "Generate Topics" to create your first content calendar.'
                    : 'No topics pending approval.'}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {sortedKeys.map(dateKey => {
                    const group        = groups.get(dateKey)!
                    const approvedInGroup = group.filter(t => t.status === 'approved').length
                    const slotPct      = Math.min(100, (approvedInGroup / postsPerRun) * 100)
                    const slotReady    = approvedInGroup >= postsPerRun
                    return (
                      <div key={dateKey}>
                        {/* Slot header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                            {dateKey === 'unscheduled' ? 'Unscheduled' : fmtDate(dateKey)}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="text-xs" style={{ color: slotReady ? 'var(--green)' : 'var(--text-muted)' }}>
                              {approvedInGroup}/{postsPerRun} approved{slotReady ? ' ✓' : ''}
                            </span>
                            {slotReady && (
                              <button
                                className="btn btn-secondary"
                                style={{ fontSize: '0.6875rem', padding: '0.1875rem 0.5rem', color: 'var(--blue)' }}
                                onClick={() => generateForSlot(dateKey, group)}
                                disabled={slotGenerating[dateKey]}
                                title="Force-generate posts for this slot now"
                              >
                                {slotGenerating[dateKey] ? '…' : '▶ Generate'}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="quota-bar" style={{ marginBottom: '0.375rem' }}>
                          <div className="quota-bar__fill" style={{ width: `${slotPct}%`, background: slotReady ? 'var(--green)' : 'var(--blue)' }} />
                        </div>
                        {/* Topic rows */}
                        <div style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden' }}>
                          {group.map((t, i) => {
                            // Extract just Low/Medium/High from competition_level (which may be a full sentence)
                            const compRaw   = t.competition_level ?? ''
                            const compLevel = compRaw.match(/^(low|medium|high)/i)?.[1]?.toLowerCase() ?? null
                            const hasRationale = !!(t.keyword_opportunity || t.ranking_strategy || t.audience_intent || t.why_now || t.competition_level)
                            return (
                              <div key={t.id} style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem', borderBottom: i < group.length - 1 ? '1px solid var(--border-subtle)' : 'none', background: ['approved', 'generating', 'generated'].includes(t.status) ? 'var(--green-subtle)' : undefined }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p
                                    className="text-sm font-medium"
                                    style={{ marginBottom: '0.2rem', lineHeight: 1.35, cursor: hasRationale ? 'pointer' : 'default', color: hasRationale ? 'var(--blue)' : undefined }}
                                    onClick={() => hasRationale && setRationaleFor(t)}
                                    title={hasRationale ? 'Click to view SEO analysis' : undefined}
                                  >
                                    {t.topic}{hasRationale && <span style={{ fontSize: '0.6875rem', marginLeft: 4, opacity: 0.7 }}>↗</span>}
                                  </p>
                                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    {t.target_keyword && <span className="badge badge-gray">{t.target_keyword}</span>}
                                    {compLevel && (
                                      <span className="badge" style={{
                                        background: compLevel === 'low' ? 'var(--green-subtle)' : compLevel === 'high' ? 'var(--red-subtle)' : 'var(--amber-subtle)',
                                        color:      compLevel === 'low' ? 'var(--green)'        : compLevel === 'high' ? 'var(--red)'        : 'var(--amber)',
                                      }}>
                                        {compLevel.charAt(0).toUpperCase() + compLevel.slice(1)}
                                      </span>
                                    )}
                                    <span className={STATUS_BADGE[t.status]?.cls ?? 'badge badge-gray'}>{STATUS_BADGE[t.status]?.label ?? t.status}</span>
                                    {typeof t.seo_brief?.cannibalization_warning === 'string' && t.seo_brief.cannibalization_warning && (
                                      <span className="badge badge-amber">⚠ Overlap</span>
                                    )}
                                  </div>
                                  {/* One-line keyword opportunity preview */}
                                  {t.keyword_opportunity && (
                                    <p className="text-xs mt-1" style={{
                                      color: 'var(--text-muted)',
                                      display: '-webkit-box',
                                      WebkitLineClamp: 1,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                    }}>{t.keyword_opportunity}</p>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                                  {t.status === 'approved' && (
                                    <button
                                      className="btn btn-secondary"
                                      style={{ fontSize: '0.6875rem', padding: '0.1875rem 0.5rem', color: 'var(--blue)' }}
                                      onClick={() => generatePost(t.id)}
                                      title="Force-generate this post now"
                                    >▶</button>
                                  )}
                                  {t.status === 'generating' && (
                                    <span className="text-xs" style={{ color: 'var(--blue)', padding: '0.25rem 0.5rem' }}>⏳</span>
                                  )}
                                  {!['approved', 'generating', 'generated'].includes(t.status) && (
                                    <button
                                      className="btn btn-secondary"
                                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem', color: 'var(--green)' }}
                                      onClick={() => topicAction(t.id, 'approved')}
                                      disabled={topicLoading[t.id]}
                                    >✓</button>
                                  )}
                                  {!['generating', 'generated'].includes(t.status) && (
                                    <button
                                      className="btn btn-secondary"
                                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', color: 'var(--text-muted)' }}
                                      onClick={() => regenerateTopic(t.id)}
                                      disabled={topicLoading[t.id]}
                                      title="Generate a different topic idea for this slot"
                                    >↻</button>
                                  )}
                                  {!['generating', 'generated'].includes(t.status) && (
                                    <button
                                      className="btn btn-secondary"
                                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem', color: 'var(--red)' }}
                                      onClick={() => topicAction(t.id, 'rejected')}
                                      disabled={topicLoading[t.id]}
                                    >✕</button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

        {/* For Review — generated posts awaiting manual approval */}
        {forReviewPosts.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <span className="text-sm font-medium">
                For Review{' '}
                <span style={{ color: 'var(--text-faint)' }}>({forReviewPosts.length})</span>
              </span>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden' }}>
              {forReviewPosts.map((p, i) => (
                <div key={p.id} style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: i < forReviewPosts.length - 1 ? '1px solid var(--border-subtle)' : 'none', background: 'var(--amber-subtle)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="text-sm font-medium" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '0.125rem' }}>{p.title ?? '(generating…)'}</p>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {p.target_keyword && <span className="badge badge-gray">{p.target_keyword}</span>}
                      {p.target_publish_date && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>→ {fmtDate(p.target_publish_date)}</span>}
                      {p.seo_score && (
                        <span className="text-xs font-semibold" style={{ color: scoreColor(p.seo_score) }}>
                          SEO: {p.seo_score.overall}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '0.75rem', padding: '0.3125rem 0.75rem', flexShrink: 0 }}
                    onClick={() => setReviewPost(p)}
                  >
                    Review &amp; Approve
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Posts */}
        <div>
          <span className="text-sm font-medium" style={{ display: 'block', marginBottom: '0.5rem' }}>Posts</span>
          <div className="pipeline-tabs">
            {(['draft_saved', 'published', 'rejected'] as const).map(tab => (
              <button
                key={tab}
                className={`pipeline-tab${postTab === tab ? ' active' : ''}`}
                onClick={() => setPostTab(tab)}
              >
                {tab === 'draft_saved' ? 'On Site' : tab === 'published' ? 'Published' : 'Rejected'}
                {' '}
                <span style={{ color: postTab === tab ? 'var(--blue)' : 'var(--text-faint)' }}>
                  ({posts.filter(p => p.status === tab).length})
                </span>
              </button>
            ))}
          </div>

          {dataLoading ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : postsForTab.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-faint)', padding: '1rem 0' }}>
              {postTab === 'draft_saved' ? 'No posts on site yet. Approve a post from the "For Review" section to push it to your connected site.' :
               postTab === 'published'   ? 'No published posts yet.' :
               'No rejected posts.'}
            </p>
          ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden' }}>
              {postsForTab.map((p, i) => {
                const siteUrl = p.status === 'published'
                  ? p.published_url
                  : p.wp_post_id && p.wp_site_url
                    ? `${p.wp_site_url.replace(/\/$/, '')}/?p=${p.wp_post_id}`
                    : p.bc_post_id && p.bc_store_hash
                      ? `https://store-${p.bc_store_hash}.mybigcommerce.com/manage/site/content`
                      : null
                const siteLabel = p.bc_post_id && !p.wp_post_id ? 'Edit ↗' : 'View ↗'
                return (
                  <div key={p.id} style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: i < postsForTab.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="text-sm font-medium" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '0.125rem' }}>{p.title ?? '(untitled)'}</p>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {p.target_keyword && <span className="badge badge-gray">{p.target_keyword}</span>}
                        {p.target_publish_date && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>→ {fmtDate(p.target_publish_date)}</span>}
                      </div>
                    </div>
                    {p.seo_score && (
                      <span className="text-xs font-semibold" style={{ color: scoreColor(p.seo_score), flexShrink: 0 }}>
                        SEO: {p.seo_score.overall}
                      </span>
                    )}
                    {siteUrl && (
                      <a href={siteUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem', flexShrink: 0 }}>
                        {siteLabel}
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
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
          GENERATE MODAL
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
          RATIONALE POPUP
      ═══════════════════════════════════════════════════════════════════ */}
      {rationaleFor && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setRationaleFor(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: '0.75rem', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', padding: '1.25rem', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <p style={{ fontWeight: 600, fontSize: '0.9375rem', lineHeight: 1.3, flex: 1, marginRight: '1rem' }}>{rationaleFor.topic}</p>
              <button onClick={() => setRationaleFor(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '1rem' }}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {rationaleFor.target_keyword && <span className="badge badge-blue">{rationaleFor.target_keyword}</span>}
              {rationaleFor.search_intent  && <span className="badge badge-gray">{rationaleFor.search_intent}</span>}
            </div>
            {([
              { key: 'keyword_opportunity' as const, label: 'Keyword Opportunity', color: '#2563eb', bg: '#eff6ff' },
              { key: 'ranking_strategy'    as const, label: 'Ranking Strategy',    color: '#7c3aed', bg: '#f5f3ff' },
              { key: 'audience_intent'     as const, label: 'Audience Intent',     color: '#059669', bg: '#f0fdf4' },
              { key: 'why_now'             as const, label: 'Why Now',             color: '#d97706', bg: '#fffbeb' },
              { key: 'competition_level'   as const, label: 'Competition',         color: '#dc2626', bg: '#fef2f2' },
            ] as const).filter(s => rationaleFor[s.key]).map(({ key, label, color, bg }) => (
              <div key={key} style={{ borderLeft: `3px solid ${color}`, background: bg, borderRadius: '0 0.375rem 0.375rem 0', padding: '0.5rem 0.75rem', marginBottom: '0.5rem' }}>
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color, marginBottom: '0.1875rem' }}>{label}</p>
                <p style={{ fontSize: '0.8125rem', color: '#374151', lineHeight: 1.5 }}>{rationaleFor[key]}</p>
              </div>
            ))}
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

// ─── Manual Post Stub ──────────────────────────────────────────────────────────
// Lazy-loads the full ContentEditor from the content page to avoid a heavy
// import at the top of this component.

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
