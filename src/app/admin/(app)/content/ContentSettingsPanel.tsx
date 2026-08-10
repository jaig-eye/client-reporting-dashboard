'use client'
// Global content settings — default post structure template only.
// Per-client schedule, frequency, and auto-generate are managed in Client Settings → Content tab.

import { useState, useEffect } from 'react'
import { SHOW_NON_BLOG_CONTENT_TYPES } from '@/lib/content/featureFlags'

interface GlobalSettings {
  post_structure?: string
}

interface AgencyWritingPrompt {
  master_writing_prompt?: string
  service_area_master_prompt?: string
  service_page_master_prompt?: string
  regular_page_master_prompt?: string
  discord_ops_channel_id?: string | null
  consolidated_email_notifications?: boolean
  monthly_review_schedule?: string
}

const REVIEW_SCHEDULE_OPTIONS: { value: string; label: string }[] = [
  { value: 'first_monday',    label: 'First Monday of the month' },
  { value: 'first_tuesday',   label: 'First Tuesday of the month' },
  { value: 'first_wednesday', label: 'First Wednesday of the month' },
  { value: 'first_thursday',  label: 'First Thursday of the month' },
  { value: 'first_friday',    label: 'First Friday of the month' },
  { value: 'first_weekday',   label: 'First weekday of the month' },
  { value: 'day_1',           label: '1st of the month' },
  { value: 'day_5',           label: '5th of the month' },
  { value: 'day_15',          label: '15th of the month' },
]

function nextReviewDate(schedule: string): string {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth()

  function firstDayOfWeek(y: number, m: number, dow: number): Date {
    const d = new Date(y, m, 1)
    while (d.getDay() !== dow) d.setDate(d.getDate() + 1)
    return d
  }

  function firstWeekday(y: number, m: number): Date {
    const d = new Date(y, m, 1)
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
    return d
  }

  const DAY_MAP: Record<string, number> = {
    first_monday: 1, first_tuesday: 2, first_wednesday: 3, first_thursday: 4, first_friday: 5,
  }

  let candidate: Date
  if (schedule in DAY_MAP) {
    candidate = firstDayOfWeek(year, month, DAY_MAP[schedule])
    if (candidate <= now) candidate = firstDayOfWeek(year, month + 1, DAY_MAP[schedule])
  } else if (schedule === 'first_weekday') {
    candidate = firstWeekday(year, month)
    if (candidate <= now) candidate = firstWeekday(year, month + 1)
  } else {
    const dayNum = parseInt(schedule.replace('day_', ''), 10)
    candidate = new Date(year, month, dayNum)
    if (candidate <= now) candidate = new Date(year, month + 1, dayNum)
  }

  return candidate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

  const [spPrompt,        setSpPrompt]        = useState('')
  const [spPromptSaving,  setSpPromptSaving]  = useState(false)
  const [spPromptSaved,   setSpPromptSaved]   = useState(false)
  const [spPromptError,   setSpPromptError]   = useState('')

  const [rpPrompt,        setRpPrompt]        = useState('')
  const [rpPromptSaving,  setRpPromptSaving]  = useState(false)
  const [rpPromptSaved,   setRpPromptSaved]   = useState(false)
  const [rpPromptError,   setRpPromptError]   = useState('')

  const [opsChannelId,     setOpsChannelId]     = useState('')
  const [consolidatedEmail, setConsolidatedEmail] = useState(true)
  const [reviewSchedule,   setReviewSchedule]   = useState('first_monday')
  const [notifSaving,      setNotifSaving]      = useState(false)
  const [notifSaved,       setNotifSaved]       = useState(false)
  const [notifError,       setNotifError]       = useState('')

  useEffect(() => {
    fetch('/api/admin/content/global-settings')
      .then(r => r.json())
      .then((d: GlobalSettings) => setGlobal({ post_structure: d.post_structure ?? '' }))
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then((d: AgencyWritingPrompt) => {
        setWritingPrompt(d.master_writing_prompt ?? '')
        setSaPrompt(d.service_area_master_prompt ?? '')
        setSpPrompt(d.service_page_master_prompt ?? '')
        setRpPrompt(d.regular_page_master_prompt ?? '')
        setOpsChannelId(d.discord_ops_channel_id ?? '')
        setConsolidatedEmail(d.consolidated_email_notifications ?? true)
        setReviewSchedule(d.monthly_review_schedule ?? 'first_monday')
      })
  }, [])

  async function saveNotifications() {
    setNotifSaving(true); setNotifError(''); setNotifSaved(false)
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discord_ops_channel_id:           opsChannelId.trim() || null,
        consolidated_email_notifications: consolidatedEmail,
        monthly_review_schedule:          reviewSchedule,
      }),
    })
    setNotifSaving(false)
    if (res.ok) { setNotifSaved(true); setTimeout(() => setNotifSaved(false), 2500) }
    else { const d = await res.json(); setNotifError(d.error || 'Failed to save') }
  }

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

  async function saveSpPrompt() {
    setSpPromptSaving(true); setSpPromptError(''); setSpPromptSaved(false)
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_page_master_prompt: spPrompt }),
    })
    setSpPromptSaving(false)
    if (res.ok) { setSpPromptSaved(true); setTimeout(() => setSpPromptSaved(false), 2500) }
    else { const d = await res.json(); setSpPromptError(d.error || 'Failed to save') }
  }

  async function saveRpPrompt() {
    setRpPromptSaving(true); setRpPromptError(''); setRpPromptSaved(false)
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regular_page_master_prompt: rpPrompt }),
    })
    setRpPromptSaving(false)
    if (res.ok) { setRpPromptSaved(true); setTimeout(() => setRpPromptSaved(false), 2500) }
    else { const d = await res.json(); setRpPromptError(d.error || 'Failed to save') }
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

      {/* Non-blog master prompts — hidden while page types are sunset (see featureFlags) */}
      {SHOW_NON_BLOG_CONTENT_TYPES && <>
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

      {/* Service Pages Prompt */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Service Pages Prompt</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>
            System prompt used for AI-generated service pages (e.g. &ldquo;Residential Plumbing Services&rdquo;).
            Leave blank to use the built-in blog prompt.
          </p>
        </div>
        <div>
          <textarea
            className="input"
            rows={20}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical', width: '100%' }}
            value={spPrompt}
            onChange={e => setSpPrompt(e.target.value)}
            placeholder="Paste your service page writing prompt here…"
          />
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={saveSpPrompt} disabled={spPromptSaving}>
            {spPromptSaving ? 'Saving…' : 'Save Prompt'}
          </button>
          {spPromptSaved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {spPromptError && <span className="text-xs" style={{ color: 'var(--red)' }}>{spPromptError}</span>}
        </div>
      </div>

      {/* Regular Pages Prompt */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Regular Pages Prompt</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>
            System prompt used for AI-generated regular pages (About, FAQ, custom content, etc.).
            Leave blank to use the built-in blog prompt.
          </p>
        </div>
        <div>
          <textarea
            className="input"
            rows={20}
            style={{ fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical', width: '100%' }}
            value={rpPrompt}
            onChange={e => setRpPrompt(e.target.value)}
            placeholder="Paste your regular page writing prompt here…"
          />
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={saveRpPrompt} disabled={rpPromptSaving}>
            {rpPromptSaving ? 'Saving…' : 'Save Prompt'}
          </button>
          {rpPromptSaved && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {rpPromptError && <span className="text-xs" style={{ color: 'var(--red)' }}>{rpPromptError}</span>}
        </div>
      </div>
      </>}

      {/* Content Notifications */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Content Notifications</h2>
          <p className="section-desc" style={{ marginTop: '0.125rem' }}>
            Configure how topic and post alerts are delivered. Discord bot token is set in{' '}
            <a href="/admin/settings" style={{ color: 'var(--blue)' }}>Agency Settings</a>.
          </p>
        </div>

        <div>
          <Label hint="Discord channel ID where all content events are posted">Discord Ops Channel ID</Label>
          <input
            type="text"
            className="input"
            value={opsChannelId}
            onChange={e => setOpsChannelId(e.target.value)}
            placeholder="e.g. 1234567890123456789"
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8125rem' }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)', lineHeight: 1.5 }}>
            All content Discord alerts (topics generated, posts ready, review reminders, BC spot-checks) post to this single channel.
            Leave blank to silence Discord notifications.
          </p>
        </div>

        <div>
          <Label hint="when the monthly content review session is triggered">Monthly Review Schedule</Label>
          <select
            className="input"
            value={reviewSchedule}
            onChange={e => setReviewSchedule(e.target.value)}
            style={{ width: '100%', fontSize: '0.875rem' }}
          >
            {REVIEW_SCHEDULE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)', lineHeight: 1.5 }}>
            Next review: <strong>{nextReviewDate(reviewSchedule)}</strong> — posts auto-approve 35 days before publish so they&rsquo;re ready for this session.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            id="consolidated-email"
            checked={consolidatedEmail}
            onChange={e => setConsolidatedEmail(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <label htmlFor="consolidated-email" style={{ fontSize: '0.875rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            Send consolidated email digest (all clients in one email per run)
          </label>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-faint)', marginTop: -8, lineHeight: 1.5 }}>
          Uncheck to send one email per client (legacy behaviour). Notification email address is set in Agency Settings.
        </p>

        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={saveNotifications} disabled={notifSaving}>
            {notifSaving ? 'Saving…' : 'Save'}
          </button>
          {notifSaved  && <span className="text-xs" style={{ color: 'var(--green)' }}>Saved ✓</span>}
          {notifError  && <span className="text-xs" style={{ color: 'var(--red)' }}>{notifError}</span>}
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
