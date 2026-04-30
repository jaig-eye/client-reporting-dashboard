'use client'
// Global content settings — default post structure template only.
// Per-client schedule, frequency, and auto-generate are managed in Client Settings → Content tab.

import { useState, useEffect } from 'react'

interface GlobalSettings {
  post_structure?: string
}

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
  allSites: { connectionId: string; siteUrl: string; siteName: string; clientId: string }[]
}) {
  const [global, setGlobal]             = useState<GlobalSettings>({})
  const [globalSaving, setGlobalSaving] = useState(false)
  const [globalSaved,  setGlobalSaved]  = useState(false)
  const [globalError,  setGlobalError]  = useState('')

  useEffect(() => {
    fetch('/api/admin/content/global-settings')
      .then(r => r.json())
      .then((d: GlobalSettings) => setGlobal({ post_structure: d.post_structure ?? '' }))
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 740 }}>
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Global Post Structure</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>
            Base template applied to all AI-generated posts. Per-client schedule and frequency are set in{' '}
            <a href="/admin/clients" style={{ color: 'var(--blue)' }}>Client Settings → Content</a>.
          </p>
        </div>

        <div>
          <Label hint="base template applied to all AI-generated posts">Default Post Structure</Label>
          <textarea
            className="input"
            rows={6}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical', width: '100%' }}
            value={global.post_structure ?? ''}
            onChange={e => setGlobal({ post_structure: e.target.value })}
            placeholder="e.g. H2: Introduction&#10;H2: Main body (3–4 sections)&#10;H2: FAQ&#10;H2: Conclusion + CTA"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            Client-specific post structures are appended on top of this template, not replaced.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={saveGlobal} disabled={globalSaving}>
            {globalSaving ? 'Saving…' : 'Save'}
          </button>
          {globalSaved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {globalError && <span className="text-xs" style={{ color: 'var(--red)' }}>{globalError}</span>}
        </div>
      </div>
    </div>
  )
}
