'use client'
// Global content settings — default post structure template only.
// Per-client schedule, frequency, and auto-generate are managed in Client Settings → Content tab.

import { useState, useEffect } from 'react'

interface GlobalSettings {
  post_structure?: string
}

interface AgencyWritingPrompt {
  master_writing_prompt?: string
  service_area_master_prompt?: string
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
      {children}
      {hint && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> — {hint}</span>}
    </label>
  )
}

function PurgeConfirmModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const [text, setText] = useState('')
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-surface, #fff)', borderRadius: 12, padding: '1.5rem', maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
      >
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: 'var(--red, #dc2626)' }}>Purge All Content</h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
          This will permanently delete <strong>all topics and posts</strong>. This cannot be undone.
          Type <strong>PURGE</strong> to confirm.
        </p>
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type PURGE"
          autoFocus
          style={{ width: '100%', padding: '0.5rem 0.625rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem', marginBottom: '1rem', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={text !== 'PURGE'}
            className="btn btn-danger"
            style={{ fontSize: '0.8125rem', opacity: text !== 'PURGE' ? 0.5 : 1 }}
          >
            Purge All
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ContentSettingsPanel({
  clients: _clients,
}: {
  clients: { id: string; name: string }[]
}) {
  const [global, setGlobal]             = useState<GlobalSettings>({})
  const [globalSaving, setGlobalSaving] = useState(false)
  const [globalSaved,  setGlobalSaved]  = useState(false)
  const [globalError,  setGlobalError]  = useState('')
  const [showPurge,    setShowPurge]    = useState(false)
  const [purging,      setPurging]      = useState(false)
  const [purgeError,   setPurgeError]   = useState('')

  const [writingPrompt,        setWritingPrompt]        = useState('')
  const [writingPromptSaving,  setWritingPromptSaving]  = useState(false)
  const [writingPromptSaved,   setWritingPromptSaved]   = useState(false)
  const [writingPromptError,   setWritingPromptError]   = useState('')

  const [saPrompt,        setSaPrompt]        = useState('')
  const [saPromptSaving,  setSaPromptSaving]  = useState(false)
  const [saPromptSaved,   setSaPromptSaved]   = useState(false)
  const [saPromptError,   setSaPromptError]   = useState('')

  useEffect(() => {
    fetch('/api/admin/content/global-settings')
      .then(r => r.json())
      .then((d: GlobalSettings) => setGlobal({ post_structure: d.post_structure ?? '' }))
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then((d: AgencyWritingPrompt) => {
        setWritingPrompt(d.master_writing_prompt ?? '')
        setSaPrompt(d.service_area_master_prompt ?? '')
      })
  }, [])

  async function purgeAll() {
    setShowPurge(false)
    setPurging(true)
    setPurgeError('')
    try {
      const res = await fetch('/api/admin/content/topics/bulk-delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purge_all: true }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Purge failed')
    } catch (err) {
      setPurgeError(err instanceof Error ? err.message : 'Failed to purge')
    } finally {
      setPurging(false)
    }
  }

  async function saveGlobal() {
    setGlobalSaving(true); setGlobalError(''); setGlobalSaved(false)
    const res = await fetch('/api/admin/content/global-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(global),
    })
    setGlobalSaving(false)
    if (res.ok) { setGlobalSaved(true); setTimeout(() => setGlobalSaved(false), 2500) }
    else { const d = await res.json(); setGlobalError(d.error || 'Failed to save') }
  }

  async function saveWritingPrompt() {
    setWritingPromptSaving(true); setWritingPromptError(''); setWritingPromptSaved(false)
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ master_writing_prompt: writingPrompt }),
    })
    setWritingPromptSaving(false)
    if (res.ok) { setWritingPromptSaved(true); setTimeout(() => setWritingPromptSaved(false), 2500) }
    else { const d = await res.json(); setWritingPromptError(d.error || 'Failed to save') }
  }

  async function saveSaPrompt() {
    setSaPromptSaving(true); setSaPromptError(''); setSaPromptSaved(false)
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_area_master_prompt: saPrompt }),
    })
    setSaPromptSaving(false)
    if (res.ok) { setSaPromptSaved(true); setTimeout(() => setSaPromptSaved(false), 2500) }
    else { const d = await res.json(); setSaPromptError(d.error || 'Failed to save') }
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
          <Label hint="appended to the AI system prompt on every generation">Default Post Structure</Label>
          <textarea
            className="input"
            rows={6}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical', width: '100%' }}
            value={global.post_structure ?? ''}
            onChange={e => setGlobal({ post_structure: e.target.value })}
            placeholder={`e.g.\nH2: Introduction\nH2: Main body (3–4 sections)\nH2: FAQ\nH2: Conclusion + CTA\n\nAlways link to at least 2 priority pages.\nInclude E-E-A-T signals: cite experience, credentials, or named expertise naturally.`}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)', lineHeight: 1.5 }}>
            This text is appended to the master writing prompt on every generation — for all clients.
            Per-client overrides are added on top. Priority pages, excluded pages, and always-included links from each client's Brand DNA are auto-injected as context; use this field to give the AI agency-wide instructions for how to use them.
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

      {/* Master Writing Prompt */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Master Writing Prompt</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>
            Override the default AI writing system prompt for all content generation. Leave blank to use the built-in prompt.
          </p>
        </div>
        <div>
          <textarea
            className="input"
            rows={20}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical', width: '100%' }}
            value={writingPrompt}
            onChange={e => setWritingPrompt(e.target.value)}
            placeholder="Paste your master blog writing prompt here…"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            Template variables substituted automatically:{' '}
            {['[BRAND_NAME]','[BRAND_DESCRIPTION]','[TARGET_AUDIENCE]','[VOICE_NOTES]','[WORD_COUNT]','[PRIMARY_KEYWORD]','[WORKING_TITLE]','[SECONDARY_KEYWORDS]','[SEARCH_INTENT]','[URLS_AND_ANCHORS]','[CTA]'].map(v => (
              <code key={v} style={{ fontFamily: 'monospace', background: 'var(--bg-muted)', padding: '1px 4px', borderRadius: 3, marginRight: 4 }}>{v}</code>
            ))}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={saveWritingPrompt} disabled={writingPromptSaving}>
            {writingPromptSaving ? 'Saving…' : 'Save Prompt'}
          </button>
          {writingPromptSaved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {writingPromptError && <span className="text-xs" style={{ color: 'var(--red)' }}>{writingPromptError}</span>}
        </div>
      </div>

      {/* Service Area Pages Prompt */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Service Area Pages Prompt</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>
            System prompt used for AI-generated service area landing pages (e.g. &ldquo;Tree Service in Palm Bay, FL&rdquo;).
            Leave blank to use the built-in default.
          </p>
        </div>
        <div>
          <textarea
            className="input"
            rows={20}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical', width: '100%' }}
            value={saPrompt}
            onChange={e => setSaPrompt(e.target.value)}
            placeholder="Paste your service area page prompt here…"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            Template variables substituted automatically:{' '}
            {['[BRAND_NAME]','[PRIMARY_SERVICE]','[CITY]','[STATE]','[SERVICE_LIST]','[NEARBY_AREAS]','[NEARBY_REGION]','[PHONE]','[PHONE_RAW]','[RESPONSE_TIME]','[COUNTY_OR_REGION]','[CATEGORY_TAGLINE]','[EEAT]','[CLIENT_CONTEXT]'].map(v => (
              <code key={v} style={{ fontFamily: 'monospace', background: 'var(--bg-muted)', padding: '1px 4px', borderRadius: 3, marginRight: 4 }}>{v}</code>
            ))}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={saveSaPrompt} disabled={saPromptSaving}>
            {saPromptSaving ? 'Saving…' : 'Save Prompt'}
          </button>
          {saPromptSaved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {saPromptError && <span className="text-xs" style={{ color: 'var(--red)' }}>{saPromptError}</span>}
        </div>
      </div>

      {/* Danger zone */}
      <div className="card p-6" style={{ borderColor: '#fca5a5' }}>
        <h2 className="section-title" style={{ marginBottom: '0.25rem', color: 'var(--red, #dc2626)' }}>Danger Zone</h2>
        <p className="section-desc" style={{ marginTop: 0, marginBottom: '1rem' }}>
          Permanently delete all generated topics and posts. This cannot be undone.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn btn-danger" onClick={() => setShowPurge(true)} disabled={purging}>
            {purging ? 'Purging…' : 'Purge All Topics & Posts'}
          </button>
          {purgeError && <span className="text-xs" style={{ color: 'var(--red)' }}>{purgeError}</span>}
        </div>
      </div>

      {showPurge && <PurgeConfirmModal onConfirm={purgeAll} onClose={() => setShowPurge(false)} />}
    </div>
  )
}
