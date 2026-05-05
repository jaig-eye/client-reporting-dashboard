'use client'

import { useState } from 'react'

interface PauseLog {
  id:                        string
  action:                    string
  trigger:                   string
  balance:                   number | null
  google_campaigns_affected: number
  meta_campaigns_affected:   number
  error:                     string | null
  created_at:                string
}

export default function ClientAutoPauseSettings({
  clientId,
  autoPauseAds,
  autoResumeAds,
  campaignsPausedAt,
  pauseLog,
}: {
  clientId:          string
  autoPauseAds:      boolean
  autoResumeAds:     boolean
  campaignsPausedAt: string | null
  pauseLog:          PauseLog[]
}) {
  const [pauseEnabled,  setPauseEnabled]  = useState(autoPauseAds)
  const [resumeEnabled, setResumeEnabled] = useState(autoResumeAds)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  async function save(nextPause: boolean, nextResume: boolean) {
    setSaving(true); setError(''); setSaved(false)
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_pause_ads: nextPause, auto_resume_ads: nextResume }),
    })
    setSaving(false)
    if (!res.ok) { setError((await res.json()).error || 'Save failed'); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function handlePauseToggle(checked: boolean) {
    const next = checked
    const nextResume = next ? resumeEnabled : false
    setPauseEnabled(next)
    setResumeEnabled(nextResume)
    save(next, nextResume)
  }

  function handleResumeToggle(checked: boolean) {
    setResumeEnabled(checked)
    save(pauseEnabled, checked)
  }

  function actionLabel(action: string) {
    switch (action) {
      case 'paused':        return { label: 'Paused',        color: '#dc2626', bg: '#fee2e2' }
      case 'resumed':       return { label: 'Resumed',       color: '#16a34a', bg: '#dcfce7' }
      case 'pause_failed':  return { label: 'Pause failed',  color: '#92400e', bg: '#fef3c7' }
      case 'resume_failed': return { label: 'Resume failed', color: '#92400e', bg: '#fef3c7' }
      default:              return { label: action,          color: '#6b7280', bg: '#f3f4f6' }
    }
  }

  return (
    <div className="space-y-5">
      {/* Status banner */}
      {campaignsPausedAt && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 8, background: '#fee2e2', border: '1px solid #fca5a5', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1rem' }}>⏸</span>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: '#dc2626' }}>Campaigns are paused</p>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#b91c1c' }}>
              Auto-paused on {new Date(campaignsPausedAt).toLocaleString()} due to negative Ad Fuel balance.
            </p>
          </div>
        </div>
      )}

      {/* Toggles */}
      <div className="card p-5 space-y-4">
        <h2 className="section-title mb-0">Auto-Pause Settings</h2>
        <p className="section-desc" style={{ marginTop: '0.125rem' }}>
          Automatically pause all active campaigns when the Ad Fuel balance goes negative.
          Requires Google Ads and/or Meta Ads connections to be active.
        </p>

        <div className="space-y-3">
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginTop: 2 }}>
              <input
                type="checkbox" checked={pauseEnabled} onChange={e => handlePauseToggle(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--blue)' }}
              />
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>Auto-pause when balance goes negative</p>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                Checks hourly. Pauses all active Google Ads and Meta Ads campaigns. Sends Discord notification if configured.
              </p>
            </div>
          </label>

          {pauseEnabled && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer', marginLeft: '1.75rem' }}>
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginTop: 2 }}>
                <input
                  type="checkbox" checked={resumeEnabled} onChange={e => handleResumeToggle(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--blue)' }}
                />
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>Auto-resume when balance is topped up</p>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                  Re-enables exactly the campaigns that were paused. Leave off to resume manually after reviewing budget.
                </p>
              </div>
            </label>
          )}
        </div>

        {saving && <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>Saving…</p>}
        {saved  && <p style={{ fontSize: '0.8rem', color: 'var(--green)' }}>Saved ✓</p>}
        {error  && <p style={{ fontSize: '0.8rem', color: 'var(--red)' }}>{error}</p>}
      </div>

      {/* Pause log */}
      {pauseLog.length > 0 && (
        <div className="card p-5">
          <h2 className="section-title mb-3">Pause / Resume Log</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {pauseLog.map(entry => {
              const { label, color, bg } = actionLabel(entry.action)
              const total = entry.google_campaigns_affected + entry.meta_campaigns_affected
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.625rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: bg, color, whiteSpace: 'nowrap', marginTop: 1 }}>
                    {label}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '0.8125rem' }}>
                      {total} campaign{total !== 1 ? 's' : ''} affected
                      {entry.google_campaigns_affected > 0 && ` (${entry.google_campaigns_affected} Google)`}
                      {entry.meta_campaigns_affected   > 0 && ` (${entry.meta_campaigns_affected} Meta)`}
                      {entry.balance != null && ` · Balance: $${Number(entry.balance).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                    </p>
                    {entry.error && <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--red)' }}>{entry.error}</p>}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                    {new Date(entry.created_at).toLocaleDateString()} {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' · '}{entry.trigger}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {pauseLog.length === 0 && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)' }}>No pause events recorded yet.</p>
      )}
    </div>
  )
}
