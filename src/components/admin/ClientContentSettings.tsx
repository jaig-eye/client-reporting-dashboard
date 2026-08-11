'use client'

// Per-client content Settings sub-tab — a clean, grouped-card layout that pairs
// with the global content settings panel. Composes the existing Brand DNA form
// and adds Publishing / Schedule & Automation / Writing cards. Every card saves
// independently through the partial-update PUT /api/admin/content/client-settings
// (only the keys a card sends are written), so sections never clobber each other.

import { useState, useEffect, useCallback } from 'react'
import type { ClientScheduleSettings, SiteOption } from '@/lib/content/types'
import ClientContentSettingsForm from '@/components/admin/ClientContentSettingsForm'

interface Author   { id: number; name: string }
interface WpCategory { id: number; name: string }

interface Props {
  clientId:     string
  clientName:   string
  sites:        SiteOption[]
  aiConfigured: boolean
}

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

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
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
function SaveRow({ onSave, saving, saved, error }: { onSave: () => void; saving: boolean; saved: boolean; error: string }) {
  return (
    <div className="flex items-center gap-3">
      <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      {saved && <span className="text-xs" style={{ color: 'var(--green)' }} role="status">Saved ✓</span>}
      {error && <span className="text-xs" style={{ color: 'var(--red)' }} role="alert">{error}</span>}
    </div>
  )
}

type SaveState = { saving: boolean; saved: boolean; error: string }
const IDLE: SaveState = { saving: false, saved: false, error: '' }

export default function ClientContentSettings({ clientId, clientName, sites }: Props) {
  const clientSites = sites.filter(s => s.clientId === clientId)
  const firstConnectionId = clientSites[0]?.connectionId ?? null

  const [form,    setForm]    = useState<Partial<ClientScheduleSettings>>({})
  const [imageGen, setImageGen] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  const [bcAuthor, setBcAuthor] = useState('')
  const [blogUrlPrefix, setBlogUrlPrefix] = useState('')
  const [categoryIds, setCategoryIds] = useState<number[]>([])
  const [authors,    setAuthors]    = useState<Author[]>([])
  const [categories, setCategories] = useState<WpCategory[]>([])
  const [loading,    setLoading]    = useState(true)

  const [pubSave,   setPubSave]   = useState<SaveState>(IDLE)
  const [schedSave, setSchedSave] = useState<SaveState>(IDLE)
  const [writeSave, setWriteSave] = useState<SaveState>(IDLE)

  const set = useCallback(<K extends keyof ClientScheduleSettings>(key: K, val: ClientScheduleSettings[K]) => {
    setForm(p => ({ ...p, [key]: val }))
  }, [])

  // ── Load settings ──────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        const autoGen = (d.auto_generate as boolean) ?? false
        setForm({
          schedule_frequency:   (d.schedule_frequency   as string | null) ?? null,
          schedule_day_of_week: (d.schedule_day_of_week as number | null) ?? null,
          weeks_ahead:          (d.weeks_ahead          as number)        ?? 6,
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
      .catch(() => setLoading(false))
  }, [clientId])

  // ── Auto-default the connection when one exists but none is saved ───────────
  useEffect(() => {
    if (loading) return
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
  const showDayPicker = form.schedule_frequency === 'weekly' || form.schedule_frequency === 'biweekly'

  // ── Saves (each PUTs only its disjoint keys) ────────────────────────────────
  async function putFields(fields: Record<string, unknown>, setState: (s: SaveState) => void) {
    setState({ saving: true, saved: false, error: '' })
    try {
      const res = await fetch('/api/admin/content/client-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, ...fields }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save')
      setState({ saving: false, saved: true, error: '' })
      setTimeout(() => setState({ saving: false, saved: false, error: '' }), 2500)
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

  function toggleCategory(id: number) {
    setCategoryIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>Loading settings…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 760 }}>

      {/* Brand DNA — reused as-is (own save + AI auto-fill) */}
      <ClientContentSettingsForm clientId={clientId} sites={sites} />

      {/* ── Publishing ─────────────────────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Publishing</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>Where {clientName}&apos;s posts publish, and how they&apos;re attributed.</p>
        </div>

        <div>
          <Label>Site Connection</Label>
          <select
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
              <Label hint="shown as author on BigCommerce blog posts">BC Author Name</Label>
              <input className="input" type="text" value={bcAuthor} onChange={e => setBcAuthor(e.target.value)} placeholder="e.g. Admin" />
            </div>
            <div>
              <Label hint="URL prefix for BigCommerce blog posts">Blog URL Prefix</Label>
              <input className="input" type="text" value={blogUrlPrefix} onChange={e => setBlogUrlPrefix(e.target.value)} placeholder="/blog/" />
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Default Author</Label>
                <select className="input" value={form.default_author_id ?? ''} onChange={e => set('default_author_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Default —</option>
                  {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <Label>WP Publish Mode</Label>
                <select className="input" value={form.wp_publish_mode ?? 'scheduled_draft'} onChange={e => set('wp_publish_mode', e.target.value as 'scheduled_draft' | 'draft_only')}>
                  <option value="scheduled_draft">Scheduled Draft</option>
                  <option value="draft_only">Draft Only</option>
                </select>
              </div>
            </div>
            <div>
              <Label hint="applied to every new post from this client">Default WP Categories</Label>
              {categories.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {effectiveConn ? 'No categories found for this site.' : 'Select a site connection to choose categories.'}
                </p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
            </div>
          </>
        )}

        <SaveRow onSave={savePublishing} {...pubSave} />
      </div>

      {/* ── Schedule & Automation ──────────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Schedule &amp; Automation</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>When posts publish and how much runs automatically.</p>
        </div>

        <div>
          <Label>Publishing cadence</Label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select className="input" style={{ width: 200 }} value={form.schedule_frequency ?? ''} onChange={e => set('schedule_frequency', e.target.value || null)}>
              <option value="">Use global default</option>
              {FREQ_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {showDayPicker && (<>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>on</span>
              <select className="input" style={{ width: 140 }} value={form.schedule_day_of_week ?? 1} onChange={e => set('schedule_day_of_week', Number(e.target.value))}>
                {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </>)}
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>at</span>
            <input className="input" type="time" style={{ width: 120 }} value={form.publish_time ?? '09:00'} onChange={e => set('publish_time', e.target.value || null)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label hint="how many publish dates to plan ahead">Weeks ahead</Label>
            <input className="input" type="number" min={1} max={24} value={form.weeks_ahead ?? 6} onChange={e => set('weeks_ahead', Number(e.target.value))} />
          </div>
          <div>
            <Label hint="first date the schedule generates from">Start date</Label>
            <input className="input" type="date" value={form.schedule_start_date ?? ''} onChange={e => set('schedule_start_date', e.target.value || null)} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="flex items-center gap-3 cursor-pointer">
            <Toggle label="Auto generate" checked={form.auto_generate ?? false}
              onChange={v => { set('auto_generate', v); set('auto_approve_topics', v); set('auto_push_posts', v) }} />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Auto-generate — generates topics, approves, and publishes automatically</span>
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

      {/* ── Writing rules ──────────────────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Writing rules</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>Length, structure, and topics to avoid.</p>
        </div>

        <div style={{ maxWidth: 200 }}>
          <Label>Target word count</Label>
          <input className="input" type="number" min={300} max={5000} step={100} value={form.target_length ?? 1500} onChange={e => set('target_length', Number(e.target.value))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Writing instructions</Label>
            <textarea className="input" rows={5} style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
              value={form.post_structure ?? ''} onChange={e => set('post_structure', e.target.value)}
              placeholder={`e.g.\nAlways link to at least 2 priority pages.\nCite years of experience and named staff expertise.`} />
          </div>
          <div>
            <Label>Topic restrictions</Label>
            <textarea className="input" rows={5} style={{ width: '100%', resize: 'vertical' }}
              value={form.topic_guidelines ?? ''} onChange={e => set('topic_guidelines', e.target.value || null)}
              placeholder="e.g. Avoid bad-credit financing, payday loans, or topics with negative brand associations." />
          </div>
        </div>

        <SaveRow onSave={saveWriting} {...writeSave} />
      </div>
    </div>
  )
}
