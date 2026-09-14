'use client'

import { useState } from 'react'
import SaveStatus, { useSaveStatus, requestJson } from '@/components/ui/SaveStatus'

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
  const status = useSaveStatus()

  function save(nextPause: boolean, nextResume: boolean) {
    const prevPause  = pauseEnabled
    const prevResume = resumeEnabled
    void status.run(async () => {
      setPauseEnabled(nextPause)
      setResumeEnabled(nextResume)
      try {
        await requestJson(`/api/admin/clients/${clientId}`, {
          method: 'PATCH',
          json:   { auto_pause_ads: nextPause, auto_resume_ads: nextResume },
        })
      } catch (err) {
        setPauseEnabled(prevPause)
        setResumeEnabled(prevResume)
        throw err
      }
    })
  }

  function handlePauseToggle(checked: boolean) {
    save(checked, checked ? resumeEnabled : false)
  }

  function handleResumeToggle(checked: boolean) {
    save(pauseEnabled, checked)
  }

  function actionLabel(action: string) {
    switch (action) {
      case 'paused':        return { label: 'Paused',        color: 'var(--red)', bg: 'var(--red-subtle)' }
      case 'resumed':       return { label: 'Resumed',       color: 'var(--green)', bg: 'var(--green-subtle)' }
      case 'pause_failed':  return { label: 'Pause failed',  color: 'var(--amber)', bg: 'var(--amber-subtle)' }
      case 'resume_failed': return { label: 'Resume failed', color: 'var(--amber)', bg: 'var(--amber-subtle)' }
      default:              return { label: action,          color: 'var(--text-muted)', bg: 'var(--bg-subtle)' }
    }
  }

  return (
    <div className="space-y-5">
      {/* Status banner */}
      {campaignsPausedAt && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--red-subtle)', border: '1px solid var(--red)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1rem' }}>⏸</span>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: 'var(--red)' }}>Campaigns are paused</p>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--red)' }}>
              Auto-paused on {new Date(campaignsPausedAt).toLocaleString()} due to negative Ad Fuel balance.
            </p>
          </div>
        </div>
      )}

      {/* Toggles */}
      <div className="card p-5 space-y-4">
        <div className="card-head">
          <h2 className="section-title">Auto-Pause Settings</h2>
          <SaveStatus state={status.state} error={status.error} retry={status.retry} />
        </div>
        <p className="section-desc" style={{ marginTop: '0.125rem' }}>
          Automatically pause all active campaigns when the Ad Fuel balance goes negative.
          Requires Google Ads and/or Meta Ads connections to be active.
        </p>

        <div className="space-y-3">
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginTop: 2 }}>
              <input
                type="checkbox" checked={pauseEnabled} onChange={e => handlePauseToggle(e.target.checked)} disabled={status.saving}
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
                  type="checkbox" checked={resumeEnabled} onChange={e => handleResumeToggle(e.target.checked)} disabled={status.saving}
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
