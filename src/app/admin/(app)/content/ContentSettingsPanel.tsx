'use client'
// Global content settings — post structure template, schedule defaults, test trigger.
// Per-client settings are now managed in Client Settings → Content tab.

import { useState, useEffect } from 'react'

interface GlobalSettings {
  post_structure?:       string
  auto_generate?:        boolean
  posts_per_run?:        number
  schedule_frequency?:   string
  schedule_day_of_week?: number
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
  clients: _clients,
  allSites: _allSites,
}: {
  clients:  { id: string; name: string }[]
  allSites: { connectionId: string; siteUrl: string; siteName: string; clientId: string }[]
}) {
  const [global, setGlobal]             = useState<GlobalSettings>({})
  const [globalSaving, setGlobalSaving] = useState(false)
  const [globalSaved,  setGlobalSaved]  = useState(false)
  const [globalError,  setGlobalError]  = useState('')

  useEffect(() => {
    fetch('/api/admin/content/global-settings')
      .then(r => r.json())
      .then((d: GlobalSettings) => setGlobal({
        post_structure:       d.post_structure       ?? '',
        auto_generate:        d.auto_generate        ?? false,
        posts_per_run:        d.posts_per_run         ?? 1,
        schedule_frequency:   d.schedule_frequency   ?? 'weekly',
        schedule_day_of_week: d.schedule_day_of_week ?? 1,
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

  function setG<K extends keyof GlobalSettings>(key: K, val: GlobalSettings[K]) {
    setGlobal(p => ({ ...p, [key]: val }))
  }

  const showDayPicker = (freq?: string | null) => freq === 'weekly' || freq === 'biweekly'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 740 }}>

      {/* Global Defaults */}
      <div className="card p-6 space-y-4">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h2 className="section-title" style={{ marginBottom: 0 }}>Global Defaults</h2>
            <p className="section-desc" style={{ marginTop: '0.125rem' }}>
              Applied to all clients unless overridden in their individual Content settings.
              Per-client settings: <a href="/admin/clients" style={{ color: 'var(--blue)' }}>Client Settings → Content</a>.
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer flex-shrink-0" style={{ paddingTop: '0.25rem' }}>
            <Toggle checked={global.auto_generate ?? false} onChange={v => setG('auto_generate', v)} />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {global.auto_generate ? 'Auto-gen on' : 'Auto-gen off'}
            </span>
          </label>
        </div>

        {/* Default post structure */}
        <div>
          <Label hint="base template applied to all AI-generated posts">Default Post Structure</Label>
          <textarea
            className="input"
            rows={5}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical', width: '100%' }}
            value={global.post_structure ?? ''}
            onChange={e => setG('post_structure', e.target.value)}
            placeholder="e.g. H2: Introduction&#10;H2: Main body (3–4 sections)&#10;H2: FAQ&#10;H2: Conclusion + CTA"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            This is the base template. Client-specific post structures add on top — they are appended, not replaced.
          </p>
        </div>

        {/* Schedule defaults */}
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
            <Label hint="topic ideas per cycle">Topics per Run</Label>
            <input className="input" type="number" min={1} max={20} value={global.topics_per_run ?? 5} onChange={e => setG('topics_per_run', Number(e.target.value))} />
          </div>
          <div>
            <Label hint="posts needed per cycle">Posts per Run</Label>
            <input className="input" type="number" min={1} max={5} value={global.posts_per_run ?? 1} onChange={e => setG('posts_per_run', Number(e.target.value))} />
          </div>
          <div>
            <Label hint="how far ahead to schedule">Weeks Ahead</Label>
            <input className="input" type="number" min={1} max={12} value={global.weeks_ahead ?? 4} onChange={e => setG('weeks_ahead', Number(e.target.value))} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={saveGlobal} disabled={globalSaving}>
            {globalSaving ? 'Saving…' : 'Save Global Settings'}
          </button>
          {globalSaved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {globalError && <span className="text-xs" style={{ color: 'var(--red)' }}>{globalError}</span>}
        </div>
      </div>
    </div>
  )
}
