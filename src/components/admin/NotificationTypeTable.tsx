'use client'

// Who hears about what: one row per event, one column per channel (agency Discord, the team email,
// the account manager, the client's Discord). A table on a desktop; on a phone each event stacks
// and its channels become labelled switches. Styles: styles/admin/settings.css (.nt-*).

import { useCallback, useEffect, useState } from 'react'
import Switch from '@/components/ui/Switch'
import { Sk } from '@/components/ui/Skeleton'
import type { NotifConfig, NotifSettings } from '@/lib/notificationConfig'

type Channel = 'agency' | 'email' | 'manager' | 'client'

interface NotifRow {
  key:         string
  linkedKeys?: string[]  // extra DB keys to keep in sync with this row's toggles
  label:       string
  description: string
  hasAgency:   boolean  // agency Discord ops channel
  hasEmail:    boolean  // global team email
  hasManager:  boolean  // account manager email
  hasClient:   boolean  // per-client Discord
  isBc?:       boolean  // BigCommerce only (the label says so)
}

const CHANNELS: { id: Channel; label: string; has: (r: NotifRow) => boolean }[] = [
  { id: 'agency',  label: 'Agency Discord',  has: r => r.hasAgency  },
  { id: 'email',   label: 'Team email',      has: r => r.hasEmail   },
  { id: 'manager', label: 'Account manager', has: r => r.hasManager },
  { id: 'client',  label: 'Client Discord',  has: r => r.hasClient  },
]

// Each row exposes ONLY the channels that actually have a send wired (verified against
// every getNotif(...) gate in the codebase) so there are no dead toggles.
const GROUPS: { title: string; rows: NotifRow[] }[] = [
  {
    title: 'Uptime and SSL',
    rows: [
      { key: 'uptime_down',      label: 'Site down',               description: 'A monitored site fails enough checks in a row to count as down', hasAgency: true,  hasEmail: true,  hasManager: false, hasClient: true  },
      { key: 'uptime_recovered', label: 'Site recovered',          description: 'A site that was down is answering again',                         hasAgency: true,  hasEmail: true,  hasManager: false, hasClient: true  },
      { key: 'ssl_expiry',       label: 'SSL expiring or expired', description: 'A certificate is within 30 days of expiring',                     hasAgency: true,  hasEmail: true,  hasManager: false, hasClient: false },
    ],
  },
  {
    title: 'Content',
    rows: [
      { key: 'content_monthly_review',  label: 'Monthly review ready',       description: 'Once a month, when posts are generated and ready to approve',  hasAgency: true,  hasEmail: false, hasManager: false, hasClient: false },
      { key: 'content_mid_month_check', label: 'Posts still waiting',        description: 'After the 10th, if posts are still unapproved',                hasAgency: true,  hasEmail: false, hasManager: false, hasClient: false },
      { key: 'content_bc_post_due',     label: 'BigCommerce post due tomorrow', description: 'Due within 24 hours and not published yet',                 hasAgency: true,  hasEmail: false, hasManager: false, hasClient: false, isBc: true },
      { key: 'content_sa_auto_pushed',  label: 'Service area pages pushed',  description: 'Service area pages went to WordPress or BigCommerce on their own', hasAgency: true,  hasEmail: false, hasManager: false, hasClient: false },
      { key: 'content_bc_sa_due',       label: 'BigCommerce service area page due', description: 'Due tomorrow and not published yet',                    hasAgency: true,  hasEmail: false, hasManager: false, hasClient: false, isBc: true },
      { key: 'content_topics_generated', label: 'Topics generated',          description: 'New topic ideas are ready to approve (email at most once a day)', hasAgency: false, hasEmail: true, hasManager: false, hasClient: false },
      { key: 'content_post_generated', linkedKeys: ['content_sa_generated'], label: 'Post or service area page generated', description: 'Ready for review (email at most once a day; client Discord for each one)', hasAgency: false, hasEmail: true, hasManager: false, hasClient: true },
      { key: 'content_post_published',  label: 'Content published',          description: 'A post or service area page was approved and uploaded',       hasAgency: false, hasEmail: false, hasManager: false, hasClient: true  },
    ],
  },
  {
    title: 'Ads',
    rows: [
      { key: 'ad_fuel_low',     label: 'Ad Fuel low or empty',    description: 'The balance dropped below its threshold or hit zero', hasAgency: true,  hasEmail: false, hasManager: false, hasClient: true },
      { key: 'ad_fuel_paused',  label: 'Campaigns paused',        description: 'The balance went negative, so campaigns were paused', hasAgency: true,  hasEmail: false, hasManager: false, hasClient: true },
      { key: 'ad_fuel_resumed', label: 'Campaigns resumed',       description: 'The balance was topped up and campaigns restarted',   hasAgency: true,  hasEmail: false, hasManager: false, hasClient: true },
      { key: 'bc_daily_sales',  label: 'BigCommerce daily sales', description: 'A daily sales summary for the client',                hasAgency: false, hasEmail: false, hasManager: false, hasClient: true, isBc: true },
    ],
  },
  {
    title: 'Email workflow',
    rows: [
      { key: 'email_submitted', label: 'Email submitted',       description: 'An email campaign was submitted for review',            hasAgency: true, hasEmail: false, hasManager: false, hasClient: true },
      { key: 'email_approved',  label: 'Email approved',        description: 'An email campaign was approved, with who approved it',  hasAgency: true, hasEmail: false, hasManager: false, hasClient: true },
      { key: 'email_reminder',  label: 'Weekly email reminder', description: 'A client hasn’t submitted this week’s required emails',  hasAgency: true, hasEmail: false, hasManager: false, hasClient: true },
    ],
  },
  {
    title: 'Metrics',
    rows: [
      { key: 'metric_alerts', label: 'Metric alerts', description: 'The daily and weekly digest of big changes in ad metrics', hasAgency: false, hasEmail: true, hasManager: false, hasClient: false },
    ],
  },
  {
    title: 'Sync and integrations',
    rows: [
      { key: 'sync_connector_error', label: 'Connection needs signing in again', description: 'A connection’s access expired or was revoked', hasAgency: true, hasEmail: true, hasManager: false, hasClient: false },
    ],
  },
  {
    // hasClient is false on purpose: this is about OUR follow-up discipline.
    // "Nobody has called them in 30 days" must never reach the client's channel.
    title: 'Client check-ins',
    rows: [
      { key: 'client_contact_stale', label: 'Client due a check-in', description: 'A daily list of clients past their contact window', hasAgency: true, hasEmail: true, hasManager: false, hasClient: false },
    ],
  },
]

const DEFAULT: NotifSettings = { agency: true, email: false, manager: false, client: true }

export default function NotificationTypeTable() {
  const [saved,     setSaved]     = useState<NotifConfig | null>(null)
  const [local,     setLocal]     = useState<NotifConfig | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [success,   setSuccess]   = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(false)
    fetch('/api/admin/notification-settings')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: { config: NotifConfig }) => {
        setSaved(d.config)
        setLocal(d.config)
      })
      // Without the saved config every switch would show a default, and saving would write those
      // defaults over the real choices, so a failed load shows no switches at all.
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const getEffective = useCallback((key: string): NotifSettings => {
    const raw = local?.[key] as Record<string, boolean> | undefined
    if (!raw) return DEFAULT
    if ('discord' in raw || 'ops' in raw) {
      return {
        agency:  (raw.discord ?? true) && (raw.ops ?? true),
        email:   false,
        manager: false,
        client:  (raw.discord ?? true) && (raw.client ?? true),
      }
    }
    if ('email' in raw && !('agency' in raw)) {
      return {
        agency:  raw.email   ?? true,
        email:   false,
        manager: raw.manager ?? false,
        client:  raw.client  ?? true,
      }
    }
    return {
      agency:  raw.agency  ?? true,
      email:   raw.email   ?? false,
      manager: raw.manager ?? false,
      client:  raw.client  ?? true,
    }
  }, [local])

  function set(key: string, field: Channel, value: boolean, linkedKeys?: string[]) {
    const base = local ?? {} as NotifConfig
    const cur  = getEffective(key)
    const next: NotifConfig = { ...base, [key]: { ...cur, [field]: value } }
    for (const lk of linkedKeys ?? []) {
      const lkCur = getEffective(lk)
      next[lk] = { ...lkCur, [field]: value }
    }
    setLocal(next)
    setSuccess(false)
  }

  const isDirty = JSON.stringify(local) !== JSON.stringify(saved)

  async function handleSave() {
    if (!local) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/notification-settings', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ config: local }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaved(local)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 4500)
    } catch {
      setError('The channel changes weren’t saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="nt-sk" aria-busy="true" aria-label="Loading notification channels">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="nt-sk-row">
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><Sk w="40%" h={12} /><Sk w="70%" h={10} /></span>
            <Sk w={36} h={20} r={999} /><Sk w={36} h={20} r={999} className="ui-hide-sm" />
          </div>
        ))}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="ui-notice ui-notice--danger" role="alert" style={{ margin: 0 }}>
        <span>The notification channels didn’t load, so they can’t be changed right now.</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={load}>Try again</button>
      </div>
    )
  }

  return (
    <div>
      {isDirty && (
        <div className="ui-notice ui-notice--warning" role="status">
          <span>Channel changes aren’t saved yet. They save separately from the rest of this page.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save channels'}
          </button>
        </div>
      )}
      {error && <div className="ui-notice ui-notice--danger" role="alert">{error}</div>}
      {success && !isDirty && <div className="ui-notice ui-notice--success" role="status">Channels saved.</div>}

      <table className="nt">
        <thead>
          <tr>
            <th scope="col" className="nt-event">Event</th>
            {CHANNELS.map(c => <th key={c.id} scope="col" className="nt-ch">{c.label}</th>)}
          </tr>
        </thead>
        {GROUPS.map(group => (
          <tbody key={group.title}>
            <tr className="nt-group">
              <th scope="colgroup" colSpan={CHANNELS.length + 1}>{group.title}</th>
            </tr>
            {group.rows.map(row => {
              // For merged rows: if the primary key was never persisted, fall back to
              // the first linked key's values so the UI reflects the actual saved state.
              const eff = (!local?.[row.key] && row.linkedKeys?.[0])
                ? getEffective(row.linkedKeys[0])
                : getEffective(row.key)
              return (
                <tr key={row.key} className="nt-row">
                  <th scope="row" className="nt-event">
                    <span className="nt-label">{row.label}</span>
                    <span className="nt-desc">{row.description}</span>
                  </th>
                  {CHANNELS.map(c => (
                    <td key={c.id} className={`nt-ch${c.has(row) ? '' : ' nt-ch--none'}`}>
                      {c.has(row) ? (
                        <Switch
                          checked={eff[c.id]}
                          onChange={v => set(row.key, c.id, v, row.linkedKeys)}
                          label={<span className="nt-ch-label">{c.label}<span className="sr-only">: {row.label}</span></span>}
                        />
                      ) : (
                        <span className="nt-none" title={`${row.label} can’t be sent to ${c.label}`}>
                          <span aria-hidden>–</span><span className="sr-only">Not available</span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}
