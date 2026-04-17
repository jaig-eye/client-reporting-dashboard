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
  monthly_publish_day?:  number | null
  topics_per_run?:       number
  weeks_ahead?:          number
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const FREQ_OPTIONS = [
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
        monthly_publish_day:  d.monthly_publish_day  ?? null,
        topics_per_run:       d.topics_per_run        ?? 5,
        weeks_ahead:          d.weeks_ahead           ?? 4,
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

  const showDayPicker      = (freq?: string | null) => freq === 'weekly' || freq === 'biweekly'
  const isMonthlyFrequency = (freq?: string | null) =>
    freq === 'monthly' || freq === 'monthly_first' || freq === 'monthly_mid' || freq === 'monthly_end'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 740 }}>

      {/* Global Defaults */}
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

      {/* Monthly Content Schedule */}
      <div className="card p-6 space-y-4">
        <h2 className="section-title">Monthly Content Schedule</h2>
        <p className="section-desc">
          Configure agency-wide monthly scheduling for clients using a monthly frequency.
          Individual clients can override these in their Content settings.
        </p>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label hint="Day of month to publish (1–28)">Publish Day of Month</Label>
            <input
              className="input"
              type="number"
              min={1}
              max={28}
              placeholder="e.g. 1, 15, 28"
              value={global.monthly_publish_day ?? ''}
              onChange={e => setG('monthly_publish_day', e.target.value ? Math.min(28, Math.max(1, parseInt(e.target.value))) : null)}
            />
          </div>
          <div>
            <Label hint="Topics to generate per monthly run">Topics per Run</Label>
            <input
              className="input"
              type="number"
              min={1}
              max={20}
              value={global.topics_per_run ?? 5}
              onChange={e => setG('topics_per_run', Number(e.target.value))}
            />
          </div>
          <div>
            <Label hint="How far ahead to schedule topics">Weeks Ahead</Label>
            <input
              className="input"
              type="number"
              min={1}
              max={12}
              value={global.weeks_ahead ?? 4}
              onChange={e => setG('weeks_ahead', Number(e.target.value))}
            />
          </div>
        </div>

        {global.monthly_publish_day && (
          <div className="rounded p-3 text-xs" style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Auto-generation will run on the <strong>{global.monthly_publish_day}{ordinal(global.monthly_publish_day)}</strong> of each month,
            creating <strong>{global.topics_per_run ?? 5}</strong> topic suggestion{(global.topics_per_run ?? 5) !== 1 ? 's' : ''} scheduled
            up to <strong>{global.weeks_ahead ?? 4}</strong> weeks in advance. Topics require approval before posts are generated.
          </div>
        )}

        {isMonthlyFrequency(global.schedule_frequency) && !global.monthly_publish_day && (
          <div className="rounded p-3 text-xs" style={{ background: 'var(--bg-subtle)', color: '#d97706', lineHeight: 1.6 }}>
            A monthly frequency is selected but no publish day is set. The schedule will use the rolling 28-day fallback until a day is configured.
          </div>
        )}

        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={saveGlobal} disabled={globalSaving}>
            {globalSaving ? 'Saving…' : 'Save Monthly Schedule'}
          </button>
          {globalSaved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {globalError && <span className="text-xs" style={{ color: 'var(--red)' }}>{globalError}</span>}
        </div>
      </div>
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] || s[v] || s[0]
}
