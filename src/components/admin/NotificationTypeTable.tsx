'use client'

import { useCallback, useEffect, useState } from 'react'
import type { NotifConfig, NotifSettings } from '@/lib/notificationConfig'

interface NotifRow {
  key:         string
  label:       string
  description: string
  hasAlerts:   boolean  // agency alerts channel (Discord ops)
  hasClient:   boolean  // per-client Discord channel
}

const GROUPS: { title: string; rows: NotifRow[] }[] = [
  {
    title: 'Uptime & SSL',
    rows: [
      { key: 'uptime_down',      label: 'Site DOWN alert',           description: 'Fires when a monitored site fails the flap threshold', hasAlerts: true,  hasClient: true  },
      { key: 'uptime_recovered', label: 'Site recovered',            description: 'Fires when a previously down site comes back up',      hasAlerts: true,  hasClient: true  },
      { key: 'ssl_expiry',       label: 'SSL expiring / expired',    description: 'Fires when a certificate is within 30 days of expiry', hasAlerts: true,  hasClient: false },
    ],
  },
  {
    title: 'Content',
    rows: [
      { key: 'content_monthly_review',  label: 'Monthly review ready',        description: 'Once-per-month when posts are generated and ready to approve',    hasAlerts: true,  hasClient: false },
      { key: 'content_mid_month_check', label: 'Mid-month pending reminder',   description: 'Once-per-month after the 10th if posts are still unapproved',    hasAlerts: true,  hasClient: false },
      { key: 'content_bc_post_due',     label: 'BC post due tomorrow',         description: 'BigCommerce post due within 24 h with no publish ID',            hasAlerts: true,  hasClient: false },
      { key: 'content_sa_auto_pushed',  label: 'SA pages auto-pushed',         description: 'Service area pages automatically pushed to WordPress/BC',         hasAlerts: true,  hasClient: false },
      { key: 'content_bc_sa_due',       label: 'BC service area page due',     description: 'BC service area page due tomorrow and not yet published',         hasAlerts: true,  hasClient: false },
      { key: 'content_post_generated',  label: 'Post generated',               description: 'Sent to client channel when a new post is ready for review',     hasAlerts: false, hasClient: true  },
      { key: 'content_post_published',  label: 'Post published to WP / BC',   description: 'Sent to client channel when a post is uploaded and approved',    hasAlerts: false, hasClient: true  },
      { key: 'content_sa_generated',    label: 'Service area page generated',  description: 'Sent to client channel when a SA page is ready for review',      hasAlerts: false, hasClient: true  },
    ],
  },
  {
    title: 'Ad Management',
    rows: [
      { key: 'ad_fuel_low',     label: 'Ad Fuel low / depleted',    description: 'Balance dropped below threshold or hit zero',        hasAlerts: false, hasClient: true },
      { key: 'ad_fuel_paused',  label: 'Campaigns auto-paused',     description: 'Ad Fuel balance went negative and campaigns paused', hasAlerts: false, hasClient: true },
      { key: 'ad_fuel_resumed', label: 'Campaigns auto-resumed',    description: 'Balance restored and campaigns re-enabled',          hasAlerts: false, hasClient: true },
      { key: 'bc_daily_sales',  label: 'BigCommerce daily sales',   description: 'Daily sales summary sent to client channel',         hasAlerts: false, hasClient: true },
    ],
  },
  {
    title: 'Email Workflow',
    rows: [
      { key: 'email_submitted', label: 'New email submitted',    description: 'An email campaign was submitted for review',               hasAlerts: true, hasClient: true },
      { key: 'email_reminder',  label: 'Weekly email reminder',  description: 'Client has not submitted required emails this week',       hasAlerts: true, hasClient: true },
    ],
  },
  {
    title: 'Sync & Integration',
    rows: [
      { key: 'sync_connector_error', label: 'Connector auth error', description: 'An OAuth token expired or was revoked', hasAlerts: true, hasClient: false },
    ],
  },
]

// ── Toggle pill ────────────────────────────────────────────────────────────────

function Toggle({ checked, disabled, onChange, color }: {
  checked:   boolean
  disabled?: boolean
  onChange:  (v: boolean) => void
  color:     'purple' | 'green'
}) {
  const activeColor = color === 'purple' ? '#7c3aed' : '#16a34a'
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width:           36,
        height:          20,
        borderRadius:    999,
        background:      checked && !disabled ? activeColor : 'var(--bg-subtle)',
        border:          `1px solid ${checked && !disabled ? activeColor : 'var(--border)'}`,
        cursor:          disabled ? 'not-allowed' : 'pointer',
        position:        'relative',
        transition:      'background 0.15s, border-color 0.15s',
        opacity:         disabled ? 0.4 : 1,
        flexShrink:      0,
        padding:         0,
      }}
    >
      <span style={{
        position:   'absolute',
        top:        2,
        left:       checked ? 18 : 2,
        width:      14,
        height:     14,
        borderRadius: '50%',
        background: 'white',
        transition: 'left 0.15s',
        boxShadow:  '0 1px 2px rgba(0,0,0,0.2)',
      }} />
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function NotificationTypeTable() {
  const [saved,   setSaved]   = useState<NotifConfig | null>(null)
  const [local,   setLocal]   = useState<NotifConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetch('/api/admin/notification-settings')
      .then(r => r.json())
      .then((d: { config: NotifConfig }) => {
        setSaved(d.config)
        setLocal(d.config)
      })
      .catch(() => setError('Failed to load notification settings'))
      .finally(() => setLoading(false))
  }, [])

  // When reading, factor in the master discord flag (discord:false silences both channels)
  const getEffective = useCallback((key: string): { alerts: boolean; client: boolean } => {
    const cfg: NotifSettings = local?.[key] ?? { discord: true, ops: true, client: true }
    return {
      alerts: cfg.discord && cfg.ops,
      client: cfg.discord && cfg.client,
    }
  }, [local])

  function set(key: string, field: 'ops' | 'client', value: boolean) {
    setLocal(prev => {
      const cur: NotifSettings = prev?.[key] ?? { discord: true, ops: true, client: true }
      // Always keep discord:true — the two sub-toggles are the control surface
      return { ...prev, [key]: { ...cur, discord: true, [field]: value } }
    })
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
      setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '8px 0', fontSize: 13 }}>Loading…</div>

  return (
    <div>
      {/* Channel legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#7c3aed', display: 'inline-block' }} />
          Alerts Channel — agency-wide Discord
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
          Client Discord — per-client channel
        </span>
      </div>

      {/* Dirty banner */}
      {isDirty && (
        <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: '0.625rem 0.875rem', marginBottom: 12, fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>Unsaved changes</span>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid var(--red)', borderRadius: 8, padding: '0.625rem 0.875rem', marginBottom: 12, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {success && !isDirty && (
        <div style={{ background: '#f0fdf4', border: '1px solid var(--green)', borderRadius: 8, padding: '0.625rem 0.875rem', marginBottom: 12, fontSize: 13, color: 'var(--green)' }}>
          Saved
        </div>
      )}

      {/* Groups */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {GROUPS.map(group => (
          <div key={group.title} className="card" style={{ overflow: 'hidden' }}>
            {/* Group header */}
            <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                {group.title}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#7c3aed', width: 90, textAlign: 'center' }}>Alerts Channel</span>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#16a34a', width: 90, textAlign: 'center' }}>Client Discord</span>
              </div>
            </div>

            {/* Rows */}
            {group.rows.map((row, i) => {
              const eff    = getEffective(row.key)
              const isLast = i === group.rows.length - 1
              return (
                <div
                  key={row.key}
                  style={{
                    display:       'grid',
                    gridTemplateColumns: '1fr auto',
                    padding:       '0.75rem 1rem',
                    gap:           8,
                    borderBottom:  isLast ? 'none' : '1px solid var(--border)',
                    alignItems:    'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{row.label}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 1 }}>{row.description}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Alerts Channel */}
                    <div style={{ width: 90, display: 'flex', justifyContent: 'center' }}>
                      {row.hasAlerts ? (
                        <Toggle checked={eff.alerts} onChange={v => set(row.key, 'ops', v)} color="purple" />
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>—</span>
                      )}
                    </div>
                    {/* Client Discord */}
                    <div style={{ width: 90, display: 'flex', justifyContent: 'center' }}>
                      {row.hasClient ? (
                        <Toggle checked={eff.client} onChange={v => set(row.key, 'client', v)} color="green" />
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>—</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
