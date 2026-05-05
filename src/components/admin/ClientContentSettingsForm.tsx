'use client'

import { useState, useEffect } from 'react'

interface SiteOption {
  connectionId: string
  siteUrl:      string
  siteName:     string
  clientId:     string
}

interface Author {
  id:   number
  name: string
}

interface ManualLink {
  url:   string
  label: string
}

interface ClientSettings {
  business_background?:  string
  services?:             string
  target_audience?:      string
  geographic_focus?:     string
  brand_voice?:          string
  phone_number?:         string
  post_structure?:       string
  auto_generate?:        boolean
  posts_per_run?:        number
  schedule_frequency?:   string | null
  schedule_day_of_week?: number | null
  target_length?:        number
  connection_id?:        string | null
  default_author_id?:    number | null
  monthly_publish_day?:  number | null
  topics_per_run?:       number
  weeks_ahead?:          number
  cta_list?:             string
}

const DAY_NAMES  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const FREQ_OPTS  = [
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

export default function ClientContentSettingsForm({
  clientId,
  sites,
}: {
  clientId: string
  sites:    SiteOption[]
}) {
  const [form,         setForm]         = useState<ClientSettings>({})
  const [sitemapUrls,  setSitemapUrls]  = useState<string[]>([])
  const [manualLinks,  setManualLinks]  = useState<ManualLink[]>([])
  const [authors,      setAuthors]      = useState<Author[]>([])
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(true)
  const [running,      setRunning]      = useState(false)
  const [runResult,    setRunResult]    = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/content/client-settings?client_id=${clientId}`)
      .then(r => r.json())
      .then((d: ClientSettings & { sitemap_url?: string; sitemap_urls?: string[]; manual_link_urls?: string[] }) => {
        setForm({
          business_background:  d.business_background  ?? '',
          services:             d.services             ?? '',
          target_audience:      d.target_audience      ?? '',
          geographic_focus:     d.geographic_focus     ?? '',
          brand_voice:          d.brand_voice          ?? '',
          phone_number:         d.phone_number          ?? '',
          post_structure:       d.post_structure        ?? '',
          auto_generate:        d.auto_generate         ?? false,
          posts_per_run:        d.posts_per_run          ?? 1,
          schedule_frequency:   d.schedule_frequency    ?? null,
          schedule_day_of_week: d.schedule_day_of_week  ?? null,
          target_length:        d.target_length          ?? 1500,
          connection_id:        d.connection_id          ?? null,
          default_author_id:    d.default_author_id      ?? null,
          monthly_publish_day:  d.monthly_publish_day    ?? null,
          topics_per_run:       d.topics_per_run         ?? 5,
          weeks_ahead:          d.weeks_ahead            ?? 4,
          cta_list:             (d as Record<string, unknown>).cta_list ? String((d as Record<string, unknown>).cta_list) : '',
        })
        // Multi-sitemap: use sitemap_urls if populated, fall back to legacy sitemap_url
        const urls: string[] = Array.isArray(d.sitemap_urls) && d.sitemap_urls.length > 0
          ? d.sitemap_urls
          : (d.sitemap_url ? [d.sitemap_url] : [])
        setSitemapUrls(urls)
        // Manual links: each entry is a JSON string { url, label }
        const links: ManualLink[] = (d.manual_link_urls ?? []).map(s => {
          try {
            const p = JSON.parse(s)
            if (p && typeof p === 'object' && p.url) return { url: String(p.url), label: String(p.label ?? '') }
          } catch { /* ignore */ }
          if (typeof s === 'string' && s.startsWith('http')) return { url: s, label: '' }
          return null
        }).filter(Boolean) as ManualLink[]
        setManualLinks(links)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clientId])

  useEffect(() => {
    if (!form.connection_id) { setAuthors([]); return }
    fetch(`/api/admin/wordpress/authors?connection_id=${form.connection_id}`)
      .then(r => r.json())
      .then((d: Author[] | { error: string }) => { if (Array.isArray(d)) setAuthors(d) })
  }, [form.connection_id])

  function set<K extends keyof ClientSettings>(key: K, val: ClientSettings[K]) {
    setForm(p => ({ ...p, [key]: val }))
  }

  // ── Sitemap helpers ────────────────────────────────────────────────────────
  function addSitemap() { setSitemapUrls(p => [...p, '']) }
  function updateSitemap(i: number, val: string) {
    setSitemapUrls(p => p.map((u, idx) => idx === i ? val : u))
  }
  function removeSitemap(i: number) {
    setSitemapUrls(p => p.filter((_, idx) => idx !== i))
  }

  // ── Manual link helpers ────────────────────────────────────────────────────
  function addManualLink() { setManualLinks(p => [...p, { url: '', label: '' }]) }
  function updateManualLink(i: number, field: 'url' | 'label', val: string) {
    setManualLinks(p => p.map((l, idx) => idx === i ? { ...l, [field]: val } : l))
  }
  function removeManualLink(i: number) {
    setManualLinks(p => p.filter((_, idx) => idx !== i))
  }

  async function runNow() {
    setRunning(true); setRunResult('')
    const res = await fetch('/api/admin/content/topics/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, count: form.topics_per_run ?? 5 }),
    })
    const data = await res.json()
    setRunning(false)
    setRunResult(res.ok
      ? `${data.count ?? 0} topic${data.count === 1 ? '' : 's'} generated`
      : data.error || 'Generation failed')
  }

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        ...form,
        sitemap_urls:     sitemapUrls.filter(u => u.trim()),
        manual_link_urls: manualLinks
          .filter(l => l.url.trim())
          .map(l => JSON.stringify({ url: l.url.trim(), label: l.label.trim() })),
      }),
    })
    setSaving(false)
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    else { const d = await res.json(); setError(d.error || 'Failed to save') }
  }

  const clientSites  = sites.filter(s => s.clientId === clientId)
  const showDayPicker = (freq?: string | null) => freq === 'weekly' || freq === 'biweekly'

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 700 }}>

      {/* ── Business Context ─────────────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <h3 className="section-title">Business Context</h3>
        <p className="section-desc">Used to give the AI background on this client's business for content generation.</p>

        <div>
          <Label hint="What does this business do?">Business Background</Label>
          <textarea className="input" rows={4} style={{ width: '100%' }} value={form.business_background ?? ''} onChange={e => set('business_background', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label hint="comma-separated">Services Offered</Label>
            <textarea className="input" rows={2} style={{ width: '100%' }} value={form.services ?? ''} onChange={e => set('services', e.target.value)} />
          </div>
          <div>
            <Label>Target Audience</Label>
            <input className="input" style={{ width: '100%' }} value={form.target_audience ?? ''} onChange={e => set('target_audience', e.target.value)} />
          </div>
          <div>
            <Label>Geographic Focus</Label>
            <input className="input" style={{ width: '100%' }} value={form.geographic_focus ?? ''} onChange={e => set('geographic_focus', e.target.value)} />
          </div>
          <div>
            <Label>Brand Voice</Label>
            <input className="input" style={{ width: '100%' }} value={form.brand_voice ?? ''} onChange={e => set('brand_voice', e.target.value)} />
          </div>
        </div>

        <div>
          <Label hint="used when referencing phone in content">Phone Number</Label>
          <input className="input" type="tel" style={{ width: '50%' }} value={form.phone_number ?? ''} onChange={e => set('phone_number', e.target.value)} placeholder="(321) 555-5555" />
        </div>

        <div>
          <Label hint="list the CTAs you want the AI to use at the end of posts">Call-to-Action Options</Label>
          <textarea
            className="input"
            rows={3}
            style={{ width: '100%' }}
            value={form.cta_list ?? ''}
            onChange={e => set('cta_list', e.target.value)}
            placeholder={`e.g.\nCall us at (321) 555-5555 for a free quote.\nBook online at https://example.com/book\nVisit our showroom at 123 Main St, Orlando FL`}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            One CTA per line. The AI will choose the most appropriate one for each post's awareness stage.
          </p>
        </div>
      </div>

      {/* ── Sitemaps & Internal Links ─────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <h3 className="section-title">Sitemaps &amp; Internal Links</h3>
        <p className="section-desc">
          Sitemaps give the AI page context for internal linking. Always-include links are injected into every generated post.
        </p>

        {/* Multi-sitemap */}
        <div>
          <Label hint="for internal link suggestions">Sitemap URLs</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {sitemapUrls.map((url, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  className="input"
                  type="url"
                  style={{ flex: 1 }}
                  value={url}
                  onChange={e => updateSitemap(i, e.target.value)}
                  placeholder="https://example.com/sitemap.xml"
                />
                <button
                  type="button"
                  onClick={() => removeSitemap(i)}
                  style={{ flexShrink: 0, fontSize: '0.75rem', color: 'var(--text-faint)', padding: '0.25rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addSitemap}
              className="btn btn-secondary"
              style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
            >
              + Add Sitemap
            </button>
          </div>
        </div>

        {/* Always-include links */}
        <div>
          <Label hint="included as internal links in every generated post">Always-Include Links</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {manualLinks.map((link, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  className="input"
                  type="url"
                  style={{ flex: 2 }}
                  value={link.url}
                  onChange={e => updateManualLink(i, 'url', e.target.value)}
                  placeholder="https://example.com/services"
                />
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={link.label}
                  onChange={e => updateManualLink(i, 'label', e.target.value)}
                  placeholder="Label (e.g. Services)"
                />
                <button
                  type="button"
                  onClick={() => removeManualLink(i)}
                  style={{ flexShrink: 0, fontSize: '0.75rem', color: 'var(--text-faint)', padding: '0.25rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addManualLink}
              className="btn btn-secondary"
              style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
            >
              + Add Link
            </button>
          </div>
        </div>
      </div>

      {/* ── Content Generation Settings ──────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <h3 className="section-title">Content Generation</h3>

        <div>
          <Label hint="adds on top of the global post structure">Custom Post Structure</Label>
          <textarea
            className="input"
            rows={4}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem', width: '100%', resize: 'vertical' }}
            value={form.post_structure ?? ''}
            onChange={e => set('post_structure', e.target.value)}
            placeholder="Leave blank to use global default"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            The global post structure is the base template. Anything entered here is appended as client-specific additions.
          </p>
        </div>

        <div style={{ maxWidth: 160 }}>
          <Label>Target Length (words)</Label>
          <input className="input" type="number" min={300} max={5000} step={100} value={form.target_length ?? 1500} onChange={e => set('target_length', Number(e.target.value))} />
        </div>
      </div>

      {/* ── WordPress Publishing ─────────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <h3 className="section-title">WordPress Publishing</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Default WordPress Site</Label>
            <select className="input" value={form.connection_id ?? ''} onChange={e => set('connection_id', e.target.value || null)}>
              <option value="">— Default —</option>
              {clientSites.map(s => <option key={s.connectionId} value={s.connectionId}>{s.siteName}</option>)}
            </select>
            {clientSites.length === 0 && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>No WordPress connection yet — add one in Data Sources.</p>
            )}
          </div>
          <div>
            <Label>Default Author</Label>
            <select className="input" value={form.default_author_id ?? ''} onChange={e => set('default_author_id', e.target.value ? Number(e.target.value) : null)} disabled={!form.connection_id}>
              <option value="">— Default —</option>
              {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Content Schedule ─────────────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h3 className="section-title" style={{ marginBottom: 0 }}>Content Schedule</h3>
            <p className="section-desc" style={{ marginTop: '0.125rem' }}>Automate topic generation and post creation on a recurring schedule.</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
            <Toggle checked={form.auto_generate ?? false} onChange={v => set('auto_generate', v)} />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {form.auto_generate ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>

        {form.auto_generate && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Frequency</Label>
                <select className="input" value={form.schedule_frequency ?? ''} onChange={e => set('schedule_frequency', e.target.value || null)}>
                  <option value="">Use global default</option>
                  {FREQ_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {showDayPicker(form.schedule_frequency) && (
                <div>
                  <Label>Day of Week</Label>
                  <select className="input" value={form.schedule_day_of_week ?? 1} onChange={e => set('schedule_day_of_week', Number(e.target.value))}>
                    {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}
              <div>
                <Label hint="topic ideas generated per cycle">Topics per Run</Label>
                <input className="input" type="number" min={1} max={20} value={form.topics_per_run ?? 5} onChange={e => set('topics_per_run', Number(e.target.value))} />
              </div>
              <div>
                <Label hint="topics that must be approved to proceed">Posts per Run</Label>
                <input className="input" type="number" min={1} max={5} value={form.posts_per_run ?? 1} onChange={e => set('posts_per_run', Number(e.target.value))} />
              </div>
              <div>
                <Label hint="how far ahead to schedule topics">Weeks Ahead</Label>
                <input className="input" type="number" min={1} max={12} value={form.weeks_ahead ?? 4} onChange={e => set('weeks_ahead', Number(e.target.value))} />
              </div>
            </div>

            <div className="rounded-xl px-4 py-3"
              style={{ background: 'var(--blue-subtle)', border: '1px solid var(--blue-border)', color: 'var(--blue)' }}>
              <div className="text-xs space-y-1" style={{ marginBottom: '0.75rem' }}>
                <p><strong>Auto-flow:</strong> 30 days before publish — topics generated and sent for approval.</p>
                <p>7 days before publish — approved topics get a post generated automatically using fresh GSC data.</p>
                <p>Approving a topic past the 7-day deadline generates the post immediately.</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.8125rem', padding: '0.3rem 0.875rem' }}
                  onClick={runNow}
                  disabled={running}
                >
                  {running ? 'Generating…' : '▶ Generate Topics'}
                </button>
                {runResult && (
                  <span className="text-xs" style={{ color: runResult.toLowerCase().includes('fail') || runResult.toLowerCase().includes('error') ? 'var(--red)' : 'var(--green)' }}>
                    {runResult}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Content Settings'}
        </button>
        {saved  && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
        {error  && <span className="text-xs" style={{ color: 'var(--red)' }}>{error}</span>}
      </div>
    </div>
  )
}
