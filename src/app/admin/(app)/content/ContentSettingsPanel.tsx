'use client'

import { useState, useEffect } from 'react'

interface ClientOption {
  id:   string
  name: string
}

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

interface GlobalSettings {
  post_structure?:       string
  posts_per_run?:        number
  schedule_frequency?:   string
  schedule_day_of_week?: number
}

interface ClientSettings {
  business_background?:  string
  services?:             string
  target_audience?:      string
  geographic_focus?:     string
  brand_voice?:          string
  sitemap_url?:          string
  post_structure?:       string
  auto_generate?:        boolean
  posts_per_run?:        number
  schedule_frequency?:   string | null
  schedule_day_of_week?: number | null
  target_length?:        number
  connection_id?:        string | null
  default_author_id?:    number | null
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const FREQ_OPTIONS = [
  { value: 'daily',    label: 'Daily' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly',  label: 'Monthly' },
]

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
      {children}
      {hint && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — {hint}</span>}
    </label>
  )
}

function SaveStatus({ saving, saved, error }: { saving: boolean; saved: boolean; error: string }) {
  if (saving) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Saving…</span>
  if (error)  return <span className="text-xs" style={{ color: 'var(--red)' }}>{error}</span>
  if (saved)  return <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>
  return null
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

export default function ContentSettingsPanel({
  clients,
  allSites,
}: {
  clients:  ClientOption[]
  allSites: SiteOption[]
}) {
  // ── Global settings ────────────────────────────────────────────────────────
  const [global, setGlobal]             = useState<GlobalSettings>({})
  const [globalSaving, setGlobalSaving] = useState(false)
  const [globalSaved,  setGlobalSaved]  = useState(false)
  const [globalError,  setGlobalError]  = useState('')
  const [testing,      setTesting]      = useState(false)
  const [testResult,   setTestResult]   = useState('')

  useEffect(() => {
    fetch('/api/admin/content/global-settings')
      .then(r => r.json())
      .then((d: GlobalSettings) => setGlobal({
        post_structure:       d.post_structure       ?? '',
        posts_per_run:        d.posts_per_run         ?? 1,
        schedule_frequency:   d.schedule_frequency   ?? 'weekly',
        schedule_day_of_week: d.schedule_day_of_week ?? 1,
      }))
  }, [])

  async function saveGlobal() {
    setGlobalSaving(true); setGlobalError(''); setGlobalSaved(false)
    const res = await fetch('/api/admin/content/global-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(global),
    })
    setGlobalSaving(false)
    if (res.ok) { setGlobalSaved(true); setTimeout(() => setGlobalSaved(false), 2500) }
    else { const d = await res.json(); setGlobalError(d.error || 'Failed to save') }
  }

  async function testGenerate() {
    setTesting(true); setTestResult('')
    const res  = await fetch('/api/admin/content/schedule', { method: 'POST' })
    const data = await res.json()
    setTesting(false)
    if (res.ok) setTestResult(`Generated ${data.generated} post${data.generated !== 1 ? 's' : ''}${data.errors?.length ? ` (${data.errors.length} error${data.errors.length > 1 ? 's' : ''})` : ''}`)
    else        setTestResult(data.error || 'Generation failed')
  }

  function setG<K extends keyof GlobalSettings>(key: K, val: GlobalSettings[K]) {
    setGlobal(p => ({ ...p, [key]: val }))
  }

  const showDayPicker = (freq?: string | null) => freq === 'weekly' || freq === 'biweekly'

  // ── Per-client list + inline editor ────────────────────────────────────────
  const [clientStatuses, setClientStatuses] = useState<Record<string, boolean | null>>({})
  const [expandedId,     setExpandedId]     = useState<string | null>(null)
  const [client,         setClient]         = useState<ClientSettings>({})
  const [authors,        setAuthors]        = useState<Author[]>([])
  const [clientSaving,   setClientSaving]   = useState(false)
  const [clientSaved,    setClientSaved]    = useState(false)
  const [clientError,    setClientError]    = useState('')

  // Load auto_generate status for all clients on mount
  useEffect(() => {
    clients.forEach(c => {
      fetch(`/api/admin/content/client-settings?client_id=${c.id}`)
        .then(r => r.json())
        .then((d: ClientSettings) => {
          setClientStatuses(prev => ({ ...prev, [c.id]: d.auto_generate ?? false }))
        })
    })
  }, [clients])

  function openClient(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id); setClient({}); setAuthors([]); setClientSaved(false); setClientError('')
    fetch(`/api/admin/content/client-settings?client_id=${id}`)
      .then(r => r.json())
      .then((d: ClientSettings) => setClient({
        business_background:  d.business_background  ?? '',
        services:             d.services             ?? '',
        target_audience:      d.target_audience      ?? '',
        geographic_focus:     d.geographic_focus     ?? '',
        brand_voice:          d.brand_voice          ?? '',
        sitemap_url:          d.sitemap_url           ?? '',
        post_structure:       d.post_structure        ?? '',
        auto_generate:        d.auto_generate         ?? false,
        posts_per_run:        d.posts_per_run          ?? 1,
        schedule_frequency:   d.schedule_frequency    ?? null,
        schedule_day_of_week: d.schedule_day_of_week  ?? null,
        target_length:        d.target_length          ?? 1500,
        connection_id:        d.connection_id          ?? null,
        default_author_id:    d.default_author_id      ?? null,
      }))
  }

  useEffect(() => {
    if (!client.connection_id) { setAuthors([]); return }
    fetch(`/api/admin/wordpress/authors?connection_id=${client.connection_id}`)
      .then(r => r.json())
      .then((d: Author[] | { error: string }) => { if (Array.isArray(d)) setAuthors(d) })
  }, [client.connection_id])

  async function saveClient() {
    if (!expandedId) return
    setClientSaving(true); setClientError(''); setClientSaved(false)
    const res = await fetch('/api/admin/content/client-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: expandedId, ...client }),
    })
    setClientSaving(false)
    if (res.ok) {
      setClientSaved(true)
      setClientStatuses(prev => ({ ...prev, [expandedId]: client.auto_generate ?? false }))
      setTimeout(() => setClientSaved(false), 2500)
    } else {
      const d = await res.json(); setClientError(d.error || 'Failed to save')
    }
  }

  function setC<K extends keyof ClientSettings>(key: K, val: ClientSettings[K]) {
    setClient(p => ({ ...p, [key]: val }))
  }

  const clientSites = allSites.filter(s => s.clientId === expandedId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 740 }}>

      {/* ── Global Defaults ── */}
      <div className="card p-6 space-y-4">
        <h2 className="section-title">Global Defaults</h2>

        <div>
          <Label hint="Applied to all AI-generated posts unless overridden per client">Default Post Structure</Label>
          <textarea
            className="input"
            rows={5}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical', width: '100%' }}
            value={global.post_structure ?? ''}
            onChange={e => setG('post_structure', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Default Frequency</Label>
            <select className="input" value={global.schedule_frequency ?? 'weekly'} onChange={e => setG('schedule_frequency', e.target.value)}>
              {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {showDayPicker(global.schedule_frequency) && (
            <div>
              <Label>Day of Week</Label>
              <select className="input" value={global.schedule_day_of_week ?? 1} onChange={e => setG('schedule_day_of_week', Number(e.target.value))}>
                {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
          )}
          <div>
            <Label>Posts per Run</Label>
            <input className="input" type="number" min={1} max={5} value={global.posts_per_run ?? 1} onChange={e => setG('posts_per_run', Number(e.target.value))} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={saveGlobal} disabled={globalSaving}>
            {globalSaving ? 'Saving…' : 'Save Global Settings'}
          </button>
          <button className="btn btn-secondary" onClick={testGenerate} disabled={testing}>
            {testing ? 'Generating…' : '▶ Test Generate Now'}
          </button>
          <SaveStatus saving={false} saved={globalSaved} error={globalError} />
          {testResult && (
            <span className="text-xs" style={{ color: testResult.toLowerCase().includes('error') || testResult.toLowerCase().includes('fail') ? 'var(--red)' : 'var(--green)' }}>
              {testResult}
            </span>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          "Test Generate Now" ignores the schedule and immediately generates for all clients with auto-generate enabled.
        </p>
      </div>

      {/* ── Client List ── */}
      <div className="card p-6">
        <h2 className="section-title mb-4">Client Settings</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {clients.map(c => {
            const isEnabled  = clientStatuses[c.id]
            const isExpanded = expandedId === c.id
            const statusNull = clientStatuses[c.id] === undefined

            return (
              <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {/* Row */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.625rem 0.875rem',
                    background: isExpanded ? 'var(--bg-subtle)' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => openClient(c.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="text-sm" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{c.name}</span>
                    {!statusNull && (
                      <span className={`badge ${isEnabled ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
                        {isEnabled ? 'Auto-generate on' : 'Auto-generate off'}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {isExpanded ? '▲ Close' : '▼ Edit'}
                  </span>
                </div>

                {/* Inline editor */}
                {isExpanded && (
                  <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                    {/* Business Context */}
                    <p className="text-xs font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>Business Context</p>

                    <div>
                      <Label hint="What does this business do?">Business Background</Label>
                      <textarea className="input" rows={3} style={{ width: '100%' }} value={client.business_background ?? ''} onChange={e => setC('business_background', e.target.value)} />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label hint="comma-separated">Services</Label>
                        <textarea className="input" rows={2} style={{ width: '100%' }} value={client.services ?? ''} onChange={e => setC('services', e.target.value)} />
                      </div>
                      <div>
                        <Label>Target Audience</Label>
                        <input className="input" style={{ width: '100%' }} value={client.target_audience ?? ''} onChange={e => setC('target_audience', e.target.value)} />
                      </div>
                      <div>
                        <Label>Geographic Focus</Label>
                        <input className="input" style={{ width: '100%' }} value={client.geographic_focus ?? ''} onChange={e => setC('geographic_focus', e.target.value)} />
                      </div>
                      <div>
                        <Label>Brand Voice</Label>
                        <input className="input" style={{ width: '100%' }} value={client.brand_voice ?? ''} onChange={e => setC('brand_voice', e.target.value)} />
                      </div>
                    </div>

                    <div>
                      <Label hint="optional, helps avoid duplicate topics">Sitemap URL</Label>
                      <input className="input" type="url" style={{ width: '100%' }} value={client.sitemap_url ?? ''} onChange={e => setC('sitemap_url', e.target.value)} />
                    </div>

                    <div>
                      <Label hint="overrides global default">Custom Post Structure</Label>
                      <textarea className="input" rows={3} style={{ fontFamily: 'monospace', fontSize: '0.8125rem', width: '100%' }} value={client.post_structure ?? ''} onChange={e => setC('post_structure', e.target.value)} />
                    </div>

                    <div style={{ maxWidth: 160 }}>
                      <Label>Target Length (words)</Label>
                      <input className="input" type="number" min={300} max={5000} step={100} value={client.target_length ?? 1500} onChange={e => setC('target_length', Number(e.target.value))} />
                    </div>

                    {/* WordPress Publishing */}
                    <p className="text-xs font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>WordPress Publishing</p>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Default WordPress Site</Label>
                        <select className="input" value={client.connection_id ?? ''} onChange={e => setC('connection_id', e.target.value || null)}>
                          <option value="">— Default —</option>
                          {clientSites.map(s => <option key={s.connectionId} value={s.connectionId}>{s.siteName}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label>Default Author</Label>
                        <select className="input" value={client.default_author_id ?? ''} onChange={e => setC('default_author_id', e.target.value ? Number(e.target.value) : null)} disabled={!client.connection_id}>
                          <option value="">— Default —</option>
                          {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Scheduled Generation */}
                    <p className="text-xs font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>Scheduled Generation</p>

                    <label className="flex items-center gap-3 cursor-pointer">
                      <Toggle checked={client.auto_generate ?? false} onChange={v => setC('auto_generate', v)} />
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {client.auto_generate ? 'Auto-generate enabled' : 'Auto-generate disabled'}
                      </span>
                    </label>

                    {client.auto_generate && (
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <Label hint="override or use global">Frequency</Label>
                          <select className="input" value={client.schedule_frequency ?? ''} onChange={e => setC('schedule_frequency', e.target.value || null)}>
                            <option value="">Use global default</option>
                            {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        {showDayPicker(client.schedule_frequency) && (
                          <div>
                            <Label>Day of Week</Label>
                            <select className="input" value={client.schedule_day_of_week ?? 1} onChange={e => setC('schedule_day_of_week', Number(e.target.value))}>
                              {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                            </select>
                          </div>
                        )}
                        <div>
                          <Label>Posts per Run</Label>
                          <input className="input" type="number" min={1} max={5} value={client.posts_per_run ?? 1} onChange={e => setC('posts_per_run', Number(e.target.value))} />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <button className="btn btn-primary" onClick={saveClient} disabled={clientSaving}>
                        {clientSaving ? 'Saving…' : 'Save Client Settings'}
                      </button>
                      <SaveStatus saving={false} saved={clientSaved} error={clientError} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
