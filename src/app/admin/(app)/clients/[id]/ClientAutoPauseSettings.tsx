'use client'

// Client → Advanced → Ad Fuel auto-pause. The Section around it (on the client page) names it;
// this is the two switches, the state they left the campaigns in, and the record of what happened.

import { useState } from 'react'
import { CheckCircle, PauseCircle } from '@phosphor-icons/react'
import { SwitchRow } from '@/components/ui/Switch'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'

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

const ACTION: Record<string, { label: string; tone: StatusTone }> = {
  paused:        { label: 'Paused',        tone: 'danger' },
  resumed:       { label: 'Resumed',       tone: 'success' },
  pause_failed:  { label: 'Pause failed',  tone: 'warning' },
  resume_failed: { label: 'Resume failed', tone: 'warning' },
}

/** "Oct 2, 2026, 4:12 PM": the date and clock time, as everything that happened is shown. */
function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
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
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_pause_ads: nextPause, auto_resume_ads: nextResume }),
      })
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Didn’t save. Try again.'); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again.')
    } finally {
      // The switches are disabled while saving; a network failure must not leave them so.
      setSaving(false)
    }
  }

  function handlePauseToggle(checked: boolean) {
    const nextResume = checked ? resumeEnabled : false
    setPauseEnabled(checked)
    setResumeEnabled(nextResume)
    save(checked, nextResume)
  }

  function handleResumeToggle(checked: boolean) {
    setResumeEnabled(checked)
    save(pauseEnabled, checked)
  }

  return (
    <div className="ui-stack">
      {campaignsPausedAt && (
        <div className="ui-notice ui-notice--danger ap-paused" role="status">
          <PauseCircle size={18} weight="fill" aria-hidden />
          <span>
            <strong>Campaigns are paused.</strong> Paused automatically on {when(campaignsPausedAt)}, when the Ad Fuel balance went below zero.
          </span>
        </div>
      )}

      <div>
        <SwitchRow
          title="Pause when the balance goes below zero"
          description="Checked every hour. Pauses every active Google Ads and Meta Ads campaign, and posts to Discord when that's set up. Needs the client's Google Ads or Meta Ads connected."
          checked={pauseEnabled}
          onChange={handlePauseToggle}
          disabled={saving}
        />
        {pauseEnabled && (
          <SwitchRow
            title="Resume when the balance is topped up"
            description="Turns back on exactly the campaigns that were paused. Leave it off to review the budget and resume them by hand."
            checked={resumeEnabled}
            onChange={handleResumeToggle}
            disabled={saving}
          />
        )}
      </div>

      {(saved || error) && (
        <div className="ui-saverow">
          {saved && <span className="ui-saved" role="status"><CheckCircle size={14} weight="fill" aria-hidden />Saved</span>}
          {error && <span className="ui-savefail" role="alert">{error}</span>}
        </div>
      )}

      <div>
        <p className="ap-log-title">Pause and resume log</p>
        {pauseLog.length === 0 ? (
          <p className="ap-empty">Nothing paused or resumed yet.</p>
        ) : (
          <ul className="ap-log">
            {pauseLog.map(entry => {
              const action = ACTION[entry.action] ?? { label: entry.action, tone: 'neutral' as const }
              const total = entry.google_campaigns_affected + entry.meta_campaigns_affected
              const split = [
                entry.google_campaigns_affected > 0 ? `${entry.google_campaigns_affected} Google` : null,
                entry.meta_campaigns_affected   > 0 ? `${entry.meta_campaigns_affected} Meta` : null,
              ].filter(Boolean).join(', ')
              return (
                <li key={entry.id} className="ap-log-row">
                  <StatusBadge tone={action.tone} dot={false}>{action.label}</StatusBadge>
                  <span className="ap-log-text">
                    <span>
                      {total} campaign{total === 1 ? '' : 's'}{split && ` (${split})`}
                      {entry.balance != null && `, balance $${Number(entry.balance).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                    </span>
                    {entry.error && <span className="ap-log-error">{entry.error}</span>}
                  </span>
                  <time className="ap-log-when" dateTime={entry.created_at}>{when(entry.created_at)}, {entry.trigger}</time>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
