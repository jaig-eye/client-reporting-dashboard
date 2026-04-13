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

function SaveStatus({ saving, saved, error }: { saving: boolean; saved: boolean; error: string }) {
  if (saving) return <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Saving…</span>
  if (error)  return <span style={{ fontSize: '0.8125rem', color: 'var(--red)' }}>{error}</span>
  if (saved)  return <span style={{ fontSize: '0.8125rem', color: 'var(--green)' }}>Saved</span>
  return null
}

export default function ContentSettingsPanel({
  clients,
  allSites,
}: {
  clients:  ClientOption[]
  allSites: SiteOption[]
}) {
  // ── Global settings ────────────────────────────────────────────────────────
  const [global, setGlobal]         = useState<GlobalSettings>({})
  const [globalSaving, setGlobalSaving] = useState(false)
  const [globalSaved,  setGlobalSaved]  = useState(false)
  const [globalError,  setGlobalError]  = useState('')
  const [testing,      setTesting]      = useState(false)
  const [testResult,   setTestResult]   = useState('')

  useEffect(() => {
    fetch('/api/admin/content/global-settings')
      .then(r => r.json())
      .then((d: GlobalSettings) => setGlobal({
        post_structure:       d.post_structure ?? '',
        posts_per_run:        d.posts_per_run  ?? 1,
        schedule_frequency:   d.schedule_frequency   ?? 'weekly',
        schedule_day_of_week: d.schedule_day_of_week ?? 1,
      }))
  }, [])

  async function saveGlobal() {
    setGlobalSaving(true)
    setGlobalError('')
    setGlobalSaved(false)
    const res = await fetch('/api/admin/content/global-settings', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(global),
    })
    setGlobalSaving(false)
    if (res.ok) { setGlobalSaved(true); setTimeout(() => setGlobalSaved(false), 2500) }
    else         { const d = await res.json(); setGlobalError(d.error || 'Failed to save') }
  }

  async function testGenerate() {
    setTesting(true)
    setTestResult('')
    const res  = await fetch('/api/admin/content/schedule', { method: 'POST' })
    const data = await res.json()
    setTesting(false)
    if (res.ok) setTestResult(`Generated ${data.generated} post${data.generated !== 1 ? 's' : ''}${data.errors?.length ? ` (${data.errors.length} error${data.errors.length > 1 ? 's' : ''})` : ''}`)
    else         setTestResult(data.error || 'Generation failed')
  }

  // ── Per-client settings ────────────────────────────────────────────────────
  const [selectedClientId, setSelectedClientId] = useState('')
  const [client,  setClient]       = useState<ClientSettings>({})
  const [authors, setAuthors]      = useState<Author[]>([])
  const [clientSaving, setClientSaving] = useState(false)
  const [clientSaved,  setClientSaved]  = useState(false)
  const [clientError,  setClientError]  = useState('')

  const clientSites = allSites.filter(s => s.clientId === selectedClientId)

  useEffect(() => {
    if (!selectedClientId) return
    setClient({})
    setAuthors([])
    fetch(`/api/admin/content/client-settings?client_id=${selectedClientId}`)
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
  }, [selectedClientId])

  useEffect(() => {
    if (!client.connection_id) { setAuthors([]); return }
    fetch(`/api/admin/wordpress/authors?connection_id=${client.connection_id}`)
      .then(r => r.json())
      .then((d: Author[] | { error: string }) => { if (Array.isArray(d)) setAuthors(d) })
  }, [client.connection_id])

  async function saveClient() {
    if (!selectedClientId) return
    setClientSaving(true)
    setClientError('')
    setClientSaved(false)
    const res = await fetch('/api/admin/content/client-settings', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ client_id: selectedClientId, ...client }),
    })
    setClientSaving(false)
    if (res.ok) { setClientSaved(true); setTimeout(() => setClientSaved(false), 2500) }
    else         { const d = await res.json(); setClientError(d.error || 'Failed to save') }
  }

  function setG<K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) {
    setGlobal(prev => ({ ...prev, [key]: value }))
  }
  function setC<K extends keyof ClientSettings>(key: K, value: ClientSettings[K]) {
    setClient(prev => ({ ...prev, [key]: value }))
  }

  const showDayPicker = (freq: string | null | undefined) => freq === 'weekly' || freq === 'biweekly'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 720 }}>

      {/* ── Global Defaults ── */}
      <div className="card p-5">
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 650, marginBottom: '1.25rem' }}>Global Defaults</h2>

        <div className="form-group">
          <label className="form-label">Default Post Structure</label>
          <p className="text-xs" style={{ color: 'var(--text-faint)', marginBottom: 6 }}>Applied to all AI-generated posts unless overridden per client.</p>
          <textarea
            className="form-input"
            rows={5}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
            value={global.post_structure ?? ''}
            onChange={e => setG('post_structure', e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Default Frequency</label>
            <select className="form-input" value={global.schedule_frequency ?? 'weekly'} onChange={e => setG('schedule_frequency', e.target.value)}>
              {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {showDayPicker(global.schedule_frequency) && (
            <div className="form-group">
              <label className="form-label">Day of Week</label>
              <select className="form-input" value={global.schedule_day_of_week ?? 1} onChange={e => setG('schedule_day_of_week', Number(e.target.value))}>
                {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Posts per Run</label>
            <input className="form-input" type="number" min={1} max={5} value={global.posts_per_run ?? 1} onChange={e => setG('posts_per_run', Number(e.target.value))} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: '1.25rem' }}>
          <button className="btn btn-primary" onClick={saveGlobal} disabled={globalSaving}>Save Global Settings</button>
          <button
            className="btn btn-secondary"
            onClick={testGenerate}
            disabled={testing}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {testing ? 'Generating…' : '▶ Test Generate Now'}
          </button>
          <SaveStatus saving={globalSaving} saved={globalSaved} error={globalError} />
          {testResult && (
            <span style={{ fontSize: '0.8125rem', color: testResult.includes('error') || testResult.includes('failed') ? 'var(--red)' : 'var(--green)' }}>
              {testResult}
            </span>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--text-faint)', marginTop: 8 }}>
          "Test Generate Now" ignores the schedule and immediately generates posts for all clients with auto-generate enabled.
        </p>
      </div>

      {/* ── Client Settings ── */}
      <div className="card p-5">
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 650, marginBottom: '1.25rem' }}>Client Settings</h2>

        <div className="form-group" style={{ marginBottom: '1.5rem' }}>
          <label className="form-label">Client</label>
          <select className="form-input" value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">— Select a client —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {selectedClientId && (
          <>
            {/* Business Context */}
            <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: '0.75rem' }}>
              Business Context
            </p>

            <div className="form-group">
              <label className="form-label">Business Background <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— What does this business do?</span></label>
              <textarea className="form-input" rows={3} value={client.business_background ?? ''} onChange={e => setC('business_background', e.target.value)} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Services <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— comma-separated</span></label>
                <textarea className="form-input" rows={2} value={client.services ?? ''} onChange={e => setC('services', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Target Audience</label>
                <input className="form-input" value={client.target_audience ?? ''} onChange={e => setC('target_audience', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Geographic Focus</label>
                <input className="form-input" value={client.geographic_focus ?? ''} onChange={e => setC('geographic_focus', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Brand Voice</label>
                <input className="form-input" value={client.brand_voice ?? ''} onChange={e => setC('brand_voice', e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Sitemap URL <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— optional, helps avoid duplicate topics</span></label>
              <input className="form-input" type="url" value={client.sitemap_url ?? ''} onChange={e => setC('sitemap_url', e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">Custom Post Structure <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— overrides global default</span></label>
              <textarea className="form-input" rows={4} style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }} value={client.post_structure ?? ''} onChange={e => setC('post_structure', e.target.value)} />
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label">Target Length (words)</label>
              <input className="form-input" type="number" min={300} max={5000} step={100} value={client.target_length ?? 1500} onChange={e => setC('target_length', Number(e.target.value))} style={{ maxWidth: 140 }} />
            </div>

            {/* WordPress Publishing */}
            <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: '0.75rem' }}>
              WordPress Publishing
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Default WordPress Site</label>
                <select className="form-input" value={client.connection_id ?? ''} onChange={e => setC('connection_id', e.target.value || null)}>
                  <option value="">— Default —</option>
                  {clientSites.map(s => <option key={s.connectionId} value={s.connectionId}>{s.siteName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Default Author</label>
                <select className="form-input" value={client.default_author_id ?? ''} onChange={e => setC('default_author_id', e.target.value ? Number(e.target.value) : null)} disabled={!client.connection_id}>
                  <option value="">— Default —</option>
                  {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            {/* Scheduled Generation */}
            <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: '0.75rem' }}>
              Scheduled Generation
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={client.auto_generate ?? false}
                  onChange={e => setC('auto_generate', e.target.checked)}
                />
                <span style={{ fontSize: '0.875rem' }}>Auto-generate posts</span>
              </label>
            </div>

            {client.auto_generate && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Frequency <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>— override (or use global)</span></label>
                  <select className="form-input" value={client.schedule_frequency ?? ''} onChange={e => setC('schedule_frequency', e.target.value || null)}>
                    <option value="">Use global default</option>
                    {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                {showDayPicker(client.schedule_frequency) && (
                  <div className="form-group">
                    <label className="form-label">Day of Week</label>
                    <select className="form-input" value={client.schedule_day_of_week ?? 1} onChange={e => setC('schedule_day_of_week', Number(e.target.value))}>
                      {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Posts per Run</label>
                  <input className="form-input" type="number" min={1} max={5} value={client.posts_per_run ?? 1} onChange={e => setC('posts_per_run', Number(e.target.value))} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: '0.5rem' }}>
              <button className="btn btn-primary" onClick={saveClient} disabled={clientSaving}>Save Client Settings</button>
              <SaveStatus saving={clientSaving} saved={clientSaved} error={clientError} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
