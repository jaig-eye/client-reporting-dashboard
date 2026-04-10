'use client'

import { useState, useEffect, useCallback } from 'react'

interface Site {
  connectionId: string
  siteName:     string
  siteUrl:      string
}

interface Author {
  id:   number
  name: string
}

interface Props {
  clientId: string
  sites:    Site[]
}

interface ContentSettings {
  business_background: string
  services:            string
  target_audience:     string
  geographic_focus:    string
  brand_voice:         string
  sitemap_url:         string
  post_structure:      string
  auto_generate:       boolean
  posts_per_run:       number
  connection_id:       string
  default_author_id:   number | null
}

const EMPTY: ContentSettings = {
  business_background: '',
  services:            '',
  target_audience:     '',
  geographic_focus:    '',
  brand_voice:         '',
  sitemap_url:         '',
  post_structure:      '',
  auto_generate:       false,
  posts_per_run:       1,
  connection_id:       '',
  default_author_id:   null,
}

const inputStyle = {
  width:        '100%',
  padding:      '0.4rem 0.6rem',
  fontSize:     '0.875rem',
  border:       '1px solid var(--border)',
  borderRadius: 6,
  background:   'var(--bg-surface)',
  color:        'var(--text-primary)',
  boxSizing:    'border-box' as const,
}

const labelStyle: React.CSSProperties = {
  display:      'block',
  fontSize:     '0.75rem',
  fontWeight:   600,
  color:        'var(--text-muted)',
  marginBottom: '0.25rem',
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {hint && <span style={{ fontWeight: 400, color: 'var(--text-faint)', marginLeft: 4 }}>— {hint}</span>}
      </label>
      {children}
    </div>
  )
}

export default function ClientContentSettings({ clientId, sites }: Props) {
  const [form,    setForm]    = useState<ContentSettings>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')
  const [authors, setAuthors] = useState<Author[]>([])

  useEffect(() => {
    fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      .then(r => r.json())
      .then(d => {
        setForm({
          ...EMPTY,
          business_background: d.business_background ?? '',
          services:            d.services ?? '',
          target_audience:     d.target_audience ?? '',
          geographic_focus:    d.geographic_focus ?? '',
          brand_voice:         d.brand_voice ?? '',
          sitemap_url:         d.sitemap_url ?? '',
          post_structure:      d.post_structure ?? '',
          auto_generate:       d.auto_generate ?? false,
          posts_per_run:       d.posts_per_run ?? 1,
          connection_id:       d.connection_id ?? '',
          default_author_id:   d.default_author_id ?? null,
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clientId])

  const loadAuthors = useCallback(async (connId: string) => {
    if (!connId) { setAuthors([]); return }
    try {
      const res = await fetch(`/api/admin/wordpress/authors?connection_id=${connId}`)
      if (res.ok) {
        const data = await res.json()
        setAuthors(data.authors ?? [])
      }
    } catch {
      setAuthors([])
    }
  }, [])

  useEffect(() => {
    if (form.connection_id) loadAuthors(form.connection_id)
  }, [form.connection_id, loadAuthors])

  function field<K extends keyof ContentSettings>(key: K, value: ContentSettings[K]) {
    setSaved(false)
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/content/client-settings', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ client_id: clientId, ...form }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-xs" style={{ color: 'var(--red)', padding: '0.4rem 0.6rem', background: 'rgba(220,38,38,0.06)', borderRadius: 6 }}>
          {error}
        </p>
      )}

      {/* Business context */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Business Background" hint="What does this business do?">
            <textarea
              value={form.business_background}
              onChange={e => field('business_background', e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="e.g. We are a plumbing company in Toronto serving residential and commercial clients since 1998."
            />
          </Field>
        </div>

        <Field label="Services" hint="comma-separated">
          <textarea
            value={form.services}
            onChange={e => field('services', e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
            placeholder="e.g. Emergency plumbing, drain cleaning, pipe repair, water heater installation"
          />
        </Field>

        <Field label="Target Audience">
          <input
            type="text"
            value={form.target_audience}
            onChange={e => field('target_audience', e.target.value)}
            style={inputStyle}
            placeholder="e.g. Homeowners and property managers in the GTA"
          />
        </Field>

        <Field label="Geographic Focus">
          <input
            type="text"
            value={form.geographic_focus}
            onChange={e => field('geographic_focus', e.target.value)}
            style={inputStyle}
            placeholder="e.g. Toronto, ON and surrounding areas"
          />
        </Field>

        <Field label="Brand Voice">
          <input
            type="text"
            value={form.brand_voice}
            onChange={e => field('brand_voice', e.target.value)}
            style={inputStyle}
            placeholder="e.g. Professional, trustworthy, approachable"
          />
        </Field>

        <Field label="Sitemap URL" hint="optional, helps avoid duplicate topics">
          <input
            type="url"
            value={form.sitemap_url}
            onChange={e => field('sitemap_url', e.target.value)}
            style={inputStyle}
            placeholder="https://example.com/sitemap.xml"
          />
        </Field>

        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Custom Post Structure" hint="overrides global default">
            <textarea
              value={form.post_structure}
              onChange={e => field('post_structure', e.target.value)}
              rows={4}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
              placeholder="Leave blank to use global default"
            />
          </Field>
        </div>
      </div>

      {/* WordPress connection */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
        <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: '0.75rem' }}>
          WordPress Publishing
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <Field label="Default WordPress Site">
            <select
              value={form.connection_id}
              onChange={e => field('connection_id', e.target.value)}
              style={inputStyle}
            >
              <option value="">— None —</option>
              {sites.map(s => (
                <option key={s.connectionId} value={s.connectionId}>{s.siteName}</option>
              ))}
            </select>
          </Field>

          <Field label="Default Author">
            <select
              value={form.default_author_id ?? ''}
              onChange={e => field('default_author_id', e.target.value ? Number(e.target.value) : null)}
              style={inputStyle}
              disabled={!form.connection_id}
            >
              <option value="">— Default —</option>
              {authors.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {/* Auto-generate */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
        <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: '0.75rem' }}>
          Scheduled Generation
        </p>

        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.auto_generate}
            onClick={() => field('auto_generate', !form.auto_generate)}
            className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors"
            style={{ background: form.auto_generate ? 'var(--blue)' : 'var(--bg-muted)' }}
          >
            <span
              className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: form.auto_generate ? 'translateX(1rem)' : 'translateX(0)' }}
            />
          </button>
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Auto-generate posts (weekly, every Monday 6am UTC)
          </span>
        </div>

        {form.auto_generate && (
          <Field label="Posts per run" hint="1–5">
            <input
              type="number"
              min={1}
              max={5}
              value={form.posts_per_run}
              onChange={e => field('posts_per_run', Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{ ...inputStyle, width: 80 }}
            />
          </Field>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary"
          style={{ fontSize: '0.8125rem' }}
        >
          {saving ? 'Saving…' : 'Save Content Settings'}
        </button>
        {saved && <span className="text-sm" style={{ color: 'var(--green)' }}>Saved ✓</span>}
      </div>
    </div>
  )
}
