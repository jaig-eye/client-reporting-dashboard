'use client'
// Global content settings — post structure template, schedule defaults, test trigger.
// Per-client settings are now managed in Client Settings → Content tab.

import { useState, useEffect } from 'react'

interface SiteOption {
  connectionId: string
  siteUrl:      string
  siteName:     string
  clientId:     string
}

interface GlobalSettings {
  post_structure?:       string
  posts_per_run?:        number
  schedule_frequency?:   string
  schedule_day_of_week?: number
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

export default function ContentSettingsPanel({
  clients: _clients,
  allSites: _allSites,
}: {
  clients:  { id: string; name: string }[]
  allSites: SiteOption[]
}) {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 740 }}>

      <div className="card p-6 space-y-4">
        <h2 className="section-title">Global Defaults</h2>
        <p className="section-desc">
          These apply to all clients unless overridden in their individual Content settings.
          Per-client settings are configured in <a href="/admin/clients" style={{ color: 'var(--blue)' }}>Client Settings → Content</a>.
        </p>

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
          {globalSaved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {globalError && <span className="text-xs" style={{ color: 'var(--red)' }}>{globalError}</span>}
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
    </div>
  )
}
