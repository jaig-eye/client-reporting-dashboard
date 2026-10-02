'use client'

// Per-client content Settings sub-tab — a clean, grouped-card layout that pairs
// with the global content settings panel. Composes the existing Brand DNA form
// and adds Publishing / Schedule & Automation / Writing cards. Every card saves
// independently through the partial-update PUT /api/admin/content/client-settings
// (only the keys a card sends are written), so sections never clobber each other.

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Fingerprint, PaperPlaneTilt, CalendarBlank, PencilSimpleLine, Sparkle } from '@phosphor-icons/react'
import type { ClientScheduleSettings, SiteOption } from '@/lib/content/types'
import ClientContentSettingsForm, { SettingsLoadError } from '@/components/admin/ClientContentSettingsForm'

type SettingsSection = 'brand' | 'publishing' | 'schedule' | 'writing'

interface Author   { id: number; name: string }
interface WpCategory { id: number; name: string }

interface Props {
  clientId:     string
  clientName:   string
  sites:        SiteOption[]
  /**
   * A section another tab asked to show — the Pipeline's "Change in Content settings" opens
   * Schedule. `n` changes on every request, so asking again after wandering off still moves there.
   */
  sectionRequest?: { section: SettingsSection; n: number } | null
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const FREQ_OPTS = [
  { value: 'daily',         label: 'Daily' },
  { value: 'weekly',        label: 'Weekly' },
  { value: 'biweekly',      label: 'Every 2 weeks' },
  { value: 'monthly',       label: 'Monthly (first weekday)' },
  { value: 'monthly_first', label: 'Monthly (1st)' },
  { value: 'monthly_mid',   label: 'Monthly (15th)' },
  { value: 'monthly_end',   label: 'Monthly (28th)' },
]

function Label({ children, hint, htmlFor, id }: {
  children: React.ReactNode; hint?: string
  /** The control this names. A label without one names nothing for a screen reader. */
  htmlFor?: string
  /** For a group of controls, which points at the label with aria-labelledby instead. */
  id?: string
}) {
  return (
    <label htmlFor={htmlFor} id={id} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
      {children}
      {hint && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — {hint}</span>}
    </label>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none"
      style={{ background: checked ? 'var(--blue)' : 'var(--bg-muted)', cursor: 'pointer' }}
    >
      <span className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(1rem)' : 'translateX(0)' }} />
    </button>
  )
}

// Per-card save button + success/error feedback (one primary CTA per card).
function SaveRow({ onSave, saving, saved, error, note }: { onSave: () => void; saving: boolean; saved: boolean; error: string; note?: string }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {saved && <span className="text-xs" style={{ color: 'var(--green)' }} role="status">Saved ✓</span>}
        {error && <span className="text-xs" style={{ color: 'var(--red)' }} role="alert">{error}</span>}
      </div>
      {note && <p className="text-xs" style={{ margin: '8px 0 0', color: 'var(--text-secondary)', lineHeight: 1.5 }} role="status">{note}</p>}
    </div>
  )
}

/** note: something the save changed that the person should know, kept until the next save. */
type SaveState = { saving: boolean; saved: boolean; error: string; note?: string }
const IDLE: SaveState = { saving: false, saved: false, error: '' }

// What a schedule save that moved the publish dates did to automatic planning (lib/content/scheduleHold).
const HOLD_NOTE = 'Automatic planning is paused: topics are still planned on dates the new schedule doesn’t use, so no new dates are planned until you press Regenerate plan on the Pipeline. The planned topics stay where they are.'

export default function ClientContentSettings({ clientId, clientName, sites, sectionRequest = null }: Props) {
  const router = useRouter()
  const clientSites = sites.filter(s => s.clientId === clientId)
  const firstConnectionId = clientSites[0]?.connectionId ?? null

  const [form,    setForm]    = useState<Partial<ClientScheduleSettings>>({})
  const [imageGen, setImageGen] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  const [bcAuthor, setBcAuthor] = useState('')
  const [blogUrlPrefix, setBlogUrlPrefix] = useState('')
  const [categoryIds, setCategoryIds] = useState<number[]>([])
  const [newCategory,      setNewCategory]      = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [categoryMsg,      setCategoryMsg]      = useState('')
  const [authors,    setAuthors]    = useState<Author[]>([])
  const [categories, setCategories] = useState<WpCategory[]>([])
  const [loading,    setLoading]    = useState(true)

  const [pubSave,   setPubSave]   = useState<SaveState>(IDLE)
  const [schedSave, setSchedSave] = useState<SaveState>(IDLE)
  const [writeSave, setWriteSave] = useState<SaveState>(IDLE)
  const [activeSection, setActiveSection] = useState<SettingsSection>(sectionRequest?.section ?? 'brand')
  // Bring the requested section to the front, and the panel into view: the sub-nav sits above the
  // fold on a phone, and arriving from the Pipeline lands wherever the page was scrolled.
  const panelRef = useRef<HTMLDivElement>(null)
  const requestN = sectionRequest?.n ?? 0
  useEffect(() => {
    if (!sectionRequest) return
    setActiveSection(sectionRequest.section)
    // After the tab around this is shown again (it was display:none until this render).
    const t = setTimeout(() => panelRef.current?.scrollIntoView({ block: 'start' }), 50)
    return () => clearTimeout(t)
    // Keyed on the request counter: the object itself is rebuilt by the parent on every request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestN])

  const set = useCallback(<K extends keyof ClientScheduleSettings>(key: K, val: ClientScheduleSettings[K]) => {
    setForm(p => ({ ...p, [key]: val }))
  }, [])

  // ── Load settings ──────────────────────────────────────────────────────────
  // A failed read is not an empty client. Filling the cards from an error body gave every field
  // its default, and any card's Save then wrote those defaults over the real settings.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as { error?: string }
          throw new Error(body.error ?? `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((d: Record<string, unknown>) => {
        const autoGen = (d.auto_generate as boolean) ?? false
        setForm({
          schedule_frequency:   (d.schedule_frequency   as string | null) ?? null,
          schedule_day_of_week: (d.schedule_day_of_week as number | null) ?? null,
          weeks_ahead:          (d.weeks_ahead          as number)        ?? 6,
          posts_per_run:        (d.posts_per_run        as number | null) ?? 1,
          schedule_start_date:  (d.schedule_start_date  as string | null) ?? null,
          auto_generate:        autoGen,
          connection_id:        (d.connection_id        as string | null) ?? null,
          default_author_id:    (d.default_author_id    as number | null) ?? null,
          post_structure:       (d.post_structure       as string)        ?? '',
          target_length:        (d.target_length        as number)        ?? 1500,
          publish_time:         (d.publish_time         as string | null) ?? null,
          wp_publish_mode:      ((d.wp_publish_mode as string | null) === 'draft_only' ? 'draft_only' : 'scheduled_draft'),
          topic_guidelines:     (d.topic_guidelines     as string | null) ?? null,
          auto_approve_topics:  autoGen || ((d.auto_approve_topics as boolean) ?? false),
          auto_push_posts:      autoGen || ((d.auto_push_posts    as boolean) ?? false),
        })
        setCategoryIds(Array.isArray(d.default_category_ids) ? (d.default_category_ids as number[]) : [])
        setImageGen(!!(d.content_image_generation as boolean | null))
        setImagePrompt(String(d.content_image_prompt ?? ''))
        setBcAuthor(String(d.bc_author ?? ''))
        setBlogUrlPrefix(String(d.blog_url_prefix ?? ''))
        setLoading(false)
        // Legacy self-heal: if auto_generate is on but sub-flags lag, sync them.
        if (autoGen && (!(d.auto_approve_topics as boolean) || !(d.auto_push_posts as boolean))) {
          fetch('/api/admin/content/client-settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, auto_approve_topics: true, auto_push_posts: true }),
          }).catch(() => {})
        }
      })
      .catch(e => { setLoadError(e instanceof Error ? e.message : 'Could not load'); setLoading(false) })
  }, [clientId, reloadKey])

  // ── Auto-default the connection when one exists but none is saved ───────────
  useEffect(() => {
    if (loading || loadError) return
    if (!form.connection_id && firstConnectionId) {
      set('connection_id', firstConnectionId)
      fetch('/api/admin/content/client-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, connection_id: firstConnectionId }),
      }).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstConnectionId, loading])

  // ── Load WP authors + categories for the selected connection ────────────────
  const effectiveConn = form.connection_id || firstConnectionId
  useEffect(() => {
    if (!effectiveConn) { setAuthors([]); setCategories([]); return }
    fetch(`/api/admin/wordpress/authors?connection_id=${effectiveConn}`)
      .then(r => r.json())
      .then((d: { authors?: Author[] }) => { if (Array.isArray(d.authors)) setAuthors(d.authors) })
      .catch(() => setAuthors([]))
    fetch(`/api/admin/wordpress/categories?connection_id=${effectiveConn}`)
      .then(r => r.json())
      .then((d: { categories?: WpCategory[] }) => { if (Array.isArray(d.categories)) setCategories(d.categories) })
      .catch(() => setCategories([]))
  }, [effectiveConn])

  const isBc = clientSites.find(s => s.connectionId === effectiveConn)?.connectorType === 'bigcommerce'
  // Monthly publishes on the first of the chosen weekday, so it takes the day picker too.
  const showDayPicker = form.schedule_frequency === 'weekly' || form.schedule_frequency === 'biweekly' || form.schedule_frequency === 'monthly'

  // ── Saves (each PUTs only its disjoint keys) ────────────────────────────────
  async function putFields(fields: Record<string, unknown>, setState: (s: SaveState) => void) {
    setState({ saving: true, saved: false, error: '' })
    try {
      const res = await fetch('/api/admin/content/client-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, ...fields }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; schedule_hold?: boolean | null }
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      const note = data.schedule_hold ? HOLD_NOTE : undefined
      setState({ saving: false, saved: true, error: '', note })
      setTimeout(() => setState({ saving: false, saved: false, error: '', note }), 2500)
      // The Pipeline tab stays mounted beside this one and reads cadence and automation from the
      // server-rendered settings. Without a refresh it kept saying "Running · weekly" after the
      // schedule was changed here. This keeps local state; it only re-reads the page's data.
      router.refresh()
    } catch (e) {
      setState({ saving: false, saved: false, error: e instanceof Error ? e.message : 'Failed to save' })
    }
  }

  const savePublishing = () => putFields({
    connection_id:        form.connection_id ?? null,
    default_author_id:    isBc ? null : (form.default_author_id ?? null),
    wp_publish_mode:      form.wp_publish_mode ?? 'scheduled_draft',
    default_category_ids: isBc ? null : (categoryIds.length ? categoryIds : null),
    bc_author:            isBc ? (bcAuthor || null) : null,
    blog_url_prefix:      isBc ? (blogUrlPrefix || null) : null,
  }, setPubSave)

  const saveSchedule = () => putFields({
    schedule_frequency:      form.schedule_frequency ?? null,
    schedule_day_of_week:    showDayPicker ? (form.schedule_day_of_week ?? 1) : (form.schedule_day_of_week ?? null),
    publish_time:            form.publish_time ?? null,
    weeks_ahead:             form.weeks_ahead || 6,
    // The column's CHECK is 1..10; clamp here so a typed 0 or 99 is corrected on save rather
    // than rejected by the database with an error nobody can act on.
    posts_per_run:           Math.min(10, Math.max(1, Number(form.posts_per_run) || 1)),
    schedule_start_date:     form.schedule_start_date ?? null,
    auto_generate:           form.auto_generate ?? false,
    auto_approve_topics:     form.auto_approve_topics ?? false,
    auto_push_posts:         form.auto_push_posts ?? false,
    content_image_generation: imageGen,
    content_image_prompt:    imagePrompt || null,
  }, setSchedSave)

  const saveWriting = () => putFields({
    target_length:    form.target_length || 1500,
    post_structure:   form.post_structure ?? '',
    topic_guidelines: form.topic_guidelines ?? null,
  }, setWriteSave)

  /**
   * Make a category on the client's site and select it.
   *
   * The same endpoint the post editor uses, including its treatment of duplicates: WordPress
   * rejects a name it already has, and the API resolves that to the existing term instead of
   * erroring — otherwise retyping a name you already made pushes you to invent a near-duplicate.
   */
  async function createCategory() {
    const name = newCategory.trim()
    if (!effectiveConn || name.length < 2) return
    setCreatingCategory(true); setCategoryMsg('')
    try {
      const res = await fetch('/api/admin/wordpress/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: effectiveConn, name }),
      })
      // `existed` is a sibling of `category`, not a field on it: reading it off the category meant
      // a name WordPress already had always said "Created".
      const d = await res.json().catch(() => ({})) as { category?: WpCategory; existed?: boolean; error?: string }
      if (!res.ok || d.error || !d.category) throw new Error(d.error ?? 'Could not create it')
      const made = d.category
      setCategories(prev => prev.some(c => c.id === made.id) ? prev : [...prev, made])
      setCategoryIds(prev => prev.includes(made.id) ? prev : [...prev, made.id])
      setNewCategory('')
      setCategoryMsg(d.existed ? 'Already existed — selected. Save to apply.' : 'Created and selected. Save to apply.')
    } catch (e) {
      setCategoryMsg(e instanceof Error ? e.message : 'Could not create it')
    } finally {
      setCreatingCategory(false)
    }
  }

  function toggleCategory(id: number) {
    setCategoryIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>Loading settings…</p>
  }
  if (loadError) {
    return <SettingsLoadError message={loadError} onRetry={() => setReloadKey(k => k + 1)} />
  }

  const SECTIONS: { id: SettingsSection; label: string; desc: string; icon: React.ReactNode }[] = [
    { id: 'brand',      label: 'Brand DNA',   desc: 'Business, voice, E-E-A-T', icon: <Fingerprint size={18} weight="duotone" /> },
    { id: 'publishing', label: 'Publishing',  desc: 'Site, author, categories',  icon: <PaperPlaneTilt size={18} weight="duotone" /> },
    { id: 'schedule',   label: 'Schedule',    desc: 'Cadence & automation',      icon: <CalendarBlank size={18} weight="duotone" /> },
    { id: 'writing',    label: 'Writing',     desc: 'Length, structure, limits', icon: <PencilSimpleLine size={18} weight="duotone" /> },
  ]

  return (
    <>
    <style>{`
      .cc-set-grid { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 1.25rem; align-items: start; }
      .cc-set-rail { display: flex; flex-direction: column; gap: 6px; position: sticky; top: 16px; }
      .cc-set-navitem { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 10px 12px; border-radius: 10px; border: 1px solid transparent; background: transparent; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
      .cc-set-navitem:hover:not(.cc-set-navitem--active) { background: var(--bg-subtle); }
      .cc-set-navitem--active { background: var(--bg-surface); border-color: var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      .cc-set-navitem:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
      @media (max-width: 720px) {
        .cc-set-grid { grid-template-columns: 1fr; }
        .cc-set-rail { position: static; flex-direction: row; flex-wrap: wrap; }
        .cc-set-navitem { width: auto; }
        .cc-set-navitem .cc-set-desc { display: none; }
      }
    `}</style>
    {/* Every sub-tab names itself in the same shape: title, then one line. */}
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
      <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
        Settings
      </h3>
      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
        Who this client is, where posts go, and how often.
      </p>
    </div>
    <div className="cc-set-grid">
      {/* Left sub-nav (progressive disclosure — one section at a time) */}
      <nav className="cc-set-rail" aria-label="Content settings sections">
        {SECTIONS.map(s => {
          const on = activeSection === s.id
          return (
            <button
              key={s.id}
              type="button"
              className={`cc-set-navitem${on ? ' cc-set-navitem--active' : ''}`}
              aria-current={on ? 'page' : undefined}
              onClick={() => setActiveSection(s.id)}
            >
              <span style={{ color: on ? 'var(--blue)' : 'var(--text-faint)', flexShrink: 0, display: 'inline-flex' }}>{s.icon}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '0.82rem', fontWeight: on ? 600 : 500, color: on ? 'var(--text-primary)' : 'var(--text-muted)' }}>{s.label}</span>
                <span className="cc-set-desc" style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-faint)' }}>{s.desc}</span>
              </span>
            </button>
          )
        })}

        {/* The writing prompt every client inherits lives at agency level. Anyone tuning a client's
            writing rules is one question away from wanting it, and there was no path from here. */}
        <Link
          href="/admin/content/settings"
          className="cc-set-navitem"
          style={{ textDecoration: 'none', marginTop: 4, borderTop: '1px solid var(--border)', borderRadius: 0, paddingTop: 12 }}
        >
          <Sparkle size={18} weight="duotone" style={{ color: 'var(--text-faint)' }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-muted)' }}>
              Global prompts →
            </span>
            <span className="cc-set-desc" style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-faint)' }}>
              Applies to every client
            </span>
          </span>
        </Link>
      </nav>

      {/* Right panel — active section */}
      <div ref={panelRef} style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1.5rem', scrollMarginTop: 16 }}>

      {/* Brand DNA — reused as-is (own save + AI auto-fill). Kept MOUNTED and hidden
          (not conditionally rendered) so unsaved edits survive a sub-nav switch —
          it holds its own internal form state, unlike the parent-owned sections below. */}
      <div style={{ display: activeSection === 'brand' ? 'block' : 'none' }}>
        <ClientContentSettingsForm clientId={clientId} />
      </div>

      {/* ── Publishing ─────────────────────────────────────────────────────── */}
      {activeSection === 'publishing' && (
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Publishing</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>Where {clientName}&apos;s posts publish, and how they&apos;re attributed.</p>
        </div>

        <div>
          <Label htmlFor="cs-connection">Site Connection</Label>
          <select
            id="cs-connection"
            className="input"
            value={form.connection_id ?? ''}
            onChange={e => {
              // New site → author/category IDs from the old site no longer apply.
              set('connection_id', e.target.value || null)
              set('default_author_id', null)
              setCategoryIds([])
            }}
          >
            <option value="">— Select site —</option>
            {clientSites.map(s => <option key={s.connectionId} value={s.connectionId}>{s.siteName || s.siteUrl}</option>)}
          </select>
        </div>

        {isBc ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cs-bc-author" hint="shown as author on BigCommerce blog posts">BC Author Name</Label>
              <input id="cs-bc-author" className="input" type="text" value={bcAuthor} onChange={e => setBcAuthor(e.target.value)} placeholder="e.g. Admin" />
            </div>
            <div>
              <Label htmlFor="cs-blog-prefix" hint="URL prefix for BigCommerce blog posts">Blog URL Prefix</Label>
              <input id="cs-blog-prefix" className="input" type="text" value={blogUrlPrefix} onChange={e => setBlogUrlPrefix(e.target.value)} placeholder="/blog/" />
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cs-author">Default Author</Label>
                <select id="cs-author" className="input" value={form.default_author_id ?? ''} onChange={e => set('default_author_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Default —</option>
                  {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="cs-publish-mode">WP Publish Mode</Label>
                <select id="cs-publish-mode" className="input" value={form.wp_publish_mode ?? 'scheduled_draft'} onChange={e => set('wp_publish_mode', e.target.value as 'scheduled_draft' | 'draft_only')}>
                  <option value="scheduled_draft">Scheduled Draft</option>
                  <option value="draft_only">Draft Only</option>
                </select>
              </div>
            </div>
            <div>
              <Label id="cs-categories-label" hint="applied to every new post from this client">Default WP Categories</Label>
              {categories.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {effectiveConn ? 'No categories found for this site.' : 'Select a site connection to choose categories.'}
                </p>
              ) : (
                <div role="group" aria-labelledby="cs-categories-label" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {categories.map(c => {
                    const on = categoryIds.includes(c.id)
                    return (
                      <button key={c.id} type="button" onClick={() => toggleCategory(c.id)}
                        aria-pressed={on}
                        style={{
                          fontSize: '0.75rem', padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                          border: `1px solid ${on ? 'var(--blue)' : 'var(--border)'}`,
                          background: on ? 'var(--blue-subtle, rgba(37,99,235,0.1))' : 'transparent',
                          color: on ? 'var(--blue)' : 'var(--text-muted)', fontWeight: on ? 600 : 400,
                        }}>
                        {on ? '✓ ' : ''}{c.name}
                      </button>
                    )
                  })}
                </div>
              )}
              {/* Same as the post editor: a category you need does not exist until someone makes
                  it, and sending people to wp-admin to do that is how defaults stay unset. A name
                  WordPress already has resolves to the existing term rather than erroring. */}
              {effectiveConn && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  <input
                    className="input"
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void createCategory() } }}
                    aria-label="New category name"
                    placeholder="New category…"
                    style={{ maxWidth: 200, fontSize: '0.8125rem', padding: '0.3rem 0.55rem' }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8125rem', padding: '0.3rem 0.7rem' }}
                    onClick={() => void createCategory()}
                    disabled={creatingCategory || newCategory.trim().length < 2}
                  >
                    {creatingCategory ? 'Creating…' : 'Create'}
                  </button>
                  {categoryMsg && (
                    <span className="text-xs" style={{ color: /could|error/i.test(categoryMsg) ? 'var(--red)' : 'var(--text-faint)' }}>
                      {categoryMsg}
                    </span>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        <SaveRow onSave={savePublishing} {...pubSave} />
      </div>
      )}

      {/* ── Schedule & Automation ──────────────────────────────────────────── */}
      {activeSection === 'schedule' && (
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Schedule &amp; Automation</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>When posts publish and how much runs automatically. Each publishing window gets the number of posts set below.</p>
        </div>

        <div>
          <Label htmlFor="cs-cadence">Publishing cadence</Label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select id="cs-cadence" className="input" style={{ width: 200 }} value={form.schedule_frequency ?? ''} onChange={e => set('schedule_frequency', e.target.value || null)}>
              <option value="">Use global default</option>
              {FREQ_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {/* One phrase, so a wrap never strands the "×" on the end of a line. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>×</span>
              <input
                className="input"
                type="number"
                min={1}
                max={10}
                style={{ width: 72 }}
                aria-label="Posts per publishing window"
                value={form.posts_per_run ?? 1}
                // Ceiling on change, floor on blur. Clamping the floor per keystroke made the
                // field impossible to clear — delete it and Number('') || 1 wrote a 1 straight
                // back — while correcting an empty field when focus leaves is expected.
                onChange={e => set('posts_per_run', Math.min(10, Math.max(0, Number(e.target.value) || 0)))}
                onBlur={e => set('posts_per_run', Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {(form.posts_per_run ?? 1) === 1 ? 'post' : 'posts'}
              </span>
            </div>
            {showDayPicker && (<>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{form.schedule_frequency === 'monthly' ? 'on the first' : 'on'}</span>
              <select className="input" aria-label="Publish day" style={{ width: 140 }} value={form.schedule_day_of_week ?? 1} onChange={e => set('schedule_day_of_week', Number(e.target.value))}>
                {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </>)}
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>at</span>
            {/* 120px fits "09:00 AM" but not the clock button Chrome draws inside the field on
                top of it, so the two overlapped. Wide enough for both, and minWidth holds it
                there when the row is tight. */}
            <input className="input" type="time" aria-label="Publish time" style={{ width: 150, minWidth: 150 }} value={form.publish_time ?? '09:00'} onChange={e => set('publish_time', e.target.value || null)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cs-weeks-ahead" hint="how many publish dates to plan ahead">Weeks ahead</Label>
            <input id="cs-weeks-ahead" className="input" type="number" min={1} max={24} value={form.weeks_ahead ?? 6} onChange={e => set('weeks_ahead', Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="cs-start-date" hint="first date the schedule generates from">Start date</Label>
            <input id="cs-start-date" className="input" type="date" value={form.schedule_start_date ?? ''} onChange={e => set('schedule_start_date', e.target.value || null)} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="flex items-center gap-3 cursor-pointer">
            <Toggle label="Auto generate" checked={form.auto_generate ?? false}
              onChange={v => { set('auto_generate', v); set('auto_approve_topics', v); set('auto_push_posts', v) }} />
            {/* The old wording — "generates topics, approves, and publishes automatically" —
                parsed as though POSTS publish themselves. The approving it refers to is
                topics; every post still waits for a person. That sentence was misleading
                enough to send a reader looking for a bug that did not exist, so it now says
                where the human step is. */}
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Topic automation — finds and approves topics and writes the posts. Each post is
              pushed to the site once you approve it.
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <Toggle label="Generate featured image" checked={imageGen} onChange={setImageGen} />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Generate a featured image with AI for each post</span>
          </label>
          {imageGen && (
            <input className="input" value={imagePrompt} onChange={e => setImagePrompt(e.target.value)}
              placeholder="e.g. Outdoor lifestyle photo, warm tones, no text overlays"
              style={{ fontSize: '0.8125rem', marginLeft: '2.25rem' }} />
          )}
        </div>

        <SaveRow onSave={saveSchedule} {...schedSave} />
      </div>
      )}

      {/* ── Writing rules ──────────────────────────────────────────────────── */}
      {activeSection === 'writing' && (
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Writing rules</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>Length, structure, and topics to avoid.</p>
        </div>

        {/* No maxWidth: the control lays itself out across the row. Boxed to 200px it had to
            stack, which is why the band sat under the field with the rest of the card empty. */}
        <div>
          <Label htmlFor="cs-target-length">Target word count</Label>
          {/* The generator holds posts to this band and revises anything past the ceiling, so the
              number is a budget, not a suggestion — posts averaged 135% of target while this was
              a sentence nobody read. Drawn to scale so the band is a shape rather than arithmetic. */}
          <LengthBudget
            id="cs-target-length"
            value={form.target_length ?? 1500}
            onChange={v => set('target_length', v)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cs-writing-instructions">Writing instructions</Label>
            <textarea id="cs-writing-instructions" className="input" rows={5} style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
              value={form.post_structure ?? ''} onChange={e => set('post_structure', e.target.value)}
              placeholder={`e.g.\nAlways link to at least 2 priority pages.\nCite years of experience and named staff expertise.`} />
          </div>
          <div>
            <Label htmlFor="cs-topic-restrictions">Topic restrictions</Label>
            <textarea id="cs-topic-restrictions" className="input" rows={5} style={{ width: '100%', resize: 'vertical' }}
              value={form.topic_guidelines ?? ''} onChange={e => set('topic_guidelines', e.target.value || null)}
              placeholder="e.g. Avoid bad-credit financing, payday loans, or topics with negative brand associations." />
          </div>
        </div>

        <SaveRow onSave={saveWriting} {...writeSave} />
      </div>
      )}

      </div>
    </div>
    </>
  )
}

/**
 * The word-count budget, drawn.
 *
 * The field and the band sit side by side: you set a number on the left and see the band it buys
 * on the right, rather than reading a sentence that does the arithmetic out loud. The three
 * labels under the band used to share one row with a sentence between them, which collided at
 * this width — the sentence is a tooltip now and only the scale's ends are drawn.
 */
function LengthBudget({ id, value, onChange }: { id?: string; value: number; onChange: (v: number) => void }) {
  const MIN = 300, MAX = 5000
  const floor   = Math.round(value * 0.9)
  const ceiling = Math.round(value * 1.15)
  const pct = (n: number) => Math.max(0, Math.min(100, ((n - MIN) / (MAX - MIN)) * 100))

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <input
        id={id}
        className="input"
        type="number" min={MIN} max={MAX} step={100}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        aria-describedby="length-band"
        style={{ width: 100, flexShrink: 0, fontSize: '1rem', fontWeight: 600, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
      />

      {/* The band this target buys, to scale across the whole allowed range. */}
      <div id="length-band" style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 460 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {floor.toLocaleString()}–{ceiling.toLocaleString()}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>words accepted</span>
        </div>
        {/* The fill sits inside the track rather than outlined and overhanging it, and the handle
            is centred on the track's midline instead of a hairline hung a pixel high. */}
        <div
          title="Drafts under the floor are rewritten longer; anything past the ceiling is shortened before it reaches you."
          style={{ position: 'relative', height: 6, borderRadius: 999, background: 'var(--bg-subtle)' }}
        >
          <div
            style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${pct(floor)}%`, width: `${pct(ceiling) - pct(floor)}%`,
              minWidth: 8, borderRadius: 999,
              background: 'var(--blue)', opacity: 0.35,
            }}
          />
          <div
            style={{
              position: 'absolute', top: '50%', left: `${pct(value)}%`,
              width: 12, height: 12, transform: 'translate(-50%, -50%)',
              borderRadius: '50%', background: 'var(--blue)',
              border: '2px solid var(--bg-surface)', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: '0.65rem', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
          <span>{MIN.toLocaleString()}</span>
          <span>{MAX.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
