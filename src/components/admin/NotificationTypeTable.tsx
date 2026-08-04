'use client'

import { useCallback, useEffect, useState } from 'react'
import type { NotifConfig, NotifSettings } from '@/lib/notificationConfig'

interface NotifRow {
  key:         string
  linkedKeys?: string[]  // extra DB keys to keep in sync with this row's toggles
  label:       string
  description: string
  hasAgency:   boolean  // agency Discord ops channel
  hasEmail:    boolean  // global team email
  hasManager:  boolean  // account manager email
  hasClient:   boolean  // per-client Discord
  isBc?:       boolean  // BigCommerce-specific row (visual grouping)
}

const GROUPS: { title: string; rows: NotifRow[] }[] = [
  {
    title: 'Uptime & SSL',
    rows: [
      { key: 'uptime_down',      label: 'Site DOWN alert',        description: 'Fires when a monitored site fails the flap threshold', hasAgency: true,  hasEmail: true,  hasManager: true,  hasClient: true  },
      { key: 'uptime_recovered', label: 'Site recovered',         description: 'Fires when a previously down site comes back up',      hasAgency: true,  hasEmail: true,  hasManager: true,  hasClient: true  },
      { key: 'ssl_expiry',       label: 'SSL expiring / expired', description: 'Fires when a certificate is within 30 days of expiry', hasAgency: true,  hasEmail: true,  hasManager: false, hasClient: false },
    ],
  },
  {
    title: 'Content',
    rows: [
      { key: 'content_monthly_review',  label: 'Monthly review ready',       description: 'Once per month when posts are generated and ready to approve',  hasAgency: true,  hasEmail: true,  hasManager: false, hasClient: false },
      { key: 'content_mid_month_check', label: 'Mid-month pending reminder', description: 'After the 10th if posts are still unapproved',                   hasAgency: true,  hasEmail: true,  hasManager: false, hasClient: false },
      { key: 'content_bc_post_due',     label: 'BC post due tomorrow',       description: 'BigCommerce post due within 24 h with no publish ID',            hasAgency: true,  hasEmail: true,  hasManager: false, hasClient: false, isBc: true },
      { key: 'content_sa_auto_pushed',  label: 'SA pages auto-pushed',       description: 'Service area pages automatically pushed to WordPress / BC',       hasAgency: true,  hasEmail: true,  hasManager: false, hasClient: false },
      { key: 'content_bc_sa_due',       label: 'BC service area page due',   description: 'BC SA page due tomorrow and not yet published',                   hasAgency: true,  hasEmail: true,  hasManager: false, hasClient: false, isBc: true },
      { key: 'content_post_generated', linkedKeys: ['content_sa_generated'], label: 'Post / SA generated', description: 'Sent when a new post or service area page is ready for review', hasAgency: false, hasEmail: true, hasManager: true, hasClient: true },
      { key: 'content_post_published',  label: 'Content published to WP / BC', description: 'Sent when a post or SA page is approved and uploaded',            hasAgency: false, hasEmail: true,  hasManager: true,  hasClient: true  },
    ],
  },
  {
    title: 'Ad Management',
    rows: [
      { key: 'ad_fuel_low',     label: 'Ad Fuel low / depleted',  description: 'Balance dropped below threshold or hit zero',        hasAgency: true,  hasEmail: true,  hasManager: true,  hasClient: true },
      { key: 'ad_fuel_paused',  label: 'Campaigns auto-paused',   description: 'Ad Fuel balance went negative and campaigns paused', hasAgency: true,  hasEmail: true,  hasManager: true,  hasClient: true },
      { key: 'ad_fuel_resumed', label: 'Campaigns auto-resumed',  description: 'Balance restored and campaigns re-enabled',          hasAgency: true,  hasEmail: true,  hasManager: true,  hasClient: true },
      { key: 'bc_daily_sales',  label: 'BigCommerce daily sales', description: 'Daily sales summary sent to client channel',         hasAgency: false, hasEmail: false, hasManager: false, hasClient: true, isBc: true },
    ],
  },
  {
    title: 'Email Workflow',
    rows: [
      { key: 'email_submitted', label: 'New email submitted',   description: 'An email campaign was submitted for review',              hasAgency: true, hasEmail: true, hasManager: false, hasClient: true },
      { key: 'email_reminder',  label: 'Weekly email reminder', description: 'Client has not submitted required emails this week',      hasAgency: true, hasEmail: true, hasManager: false, hasClient: true },
    ],
  },
  {
    title: 'Sync & Integration',
    rows: [
      { key: 'sync_connector_error', label: 'Connector auth error', description: 'An OAuth token expired or was revoked', hasAgency: true, hasEmail: true, hasManager: false, hasClient: false },
    ],
  },
]

// ── Toggle pill ────────────────────────────────────────────────────────────────

function Toggle({ checked, disabled, onChange, color }: {
  checked:   boolean
  disabled?: boolean
  onChange:  (v: boolean) => void
  color:     'amber' | 'blue' | 'purple' | 'green'
}) {
  const activeColor =
    color === 'amber'  ? '#d97706' :
    color === 'blue'   ? '#2563eb' :
    color === 'purple' ? '#7c3aed' : '#16a34a'
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width:        36,
        height:       20,
        borderRadius: 999,
        background:   checked && !disabled ? activeColor : 'var(--bg-subtle)',
        border:       `1px solid ${checked && !disabled ? activeColor : 'var(--border)'}`,
        cursor:       disabled ? 'not-allowed' : 'pointer',
        position:     'relative',
        transition:   'background 0.15s, border-color 0.15s',
        opacity:      disabled ? 0.4 : 1,
        flexShrink:   0,
        padding:      0,
      }}
    >
      <span style={{
        position:     'absolute',
        top:          2,
        left:         checked ? 18 : 2,
        width:        14,
        height:       14,
        borderRadius: '50%',
        background:   'white',
        transition:   'left 0.15s',
        boxShadow:    '0 1px 2px rgba(0,0,0,0.2)',
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

  const DEFAULT: NotifSettings = { agency: true, email: false, manager: false, client: true }

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

  function set(key: string, field: 'agency' | 'email' | 'manager' | 'client', value: boolean, linkedKeys?: string[]) {
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
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '8px 0', fontSize: 13 }}>Loading…</div>

  const COL_W = 72

  return (
    <div>
      {/* Channel legend */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#d97706', display: 'inline-block', flexShrink: 0 }} />
          Agency Discord
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#2563eb', display: 'inline-block', flexShrink: 0 }} />
          Global Emails
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#7c3aed', display: 'inline-block', flexShrink: 0 }} />
          Acc Manager
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#16a34a', display: 'inline-block', flexShrink: 0 }} />
          Client Discord
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
        <div style={{ background: '#f0fdf4', border: '1px solid #16a34a', borderRadius: 8, padding: '0.625rem 0.875rem', marginBottom: 12, fontSize: 13, color: '#15803d', display: 'flex', alignItems: 'center', gap: 7, fontWeight: 500 }}>
          <span style={{ fontSize: 15 }}>✓</span> Notification settings saved
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
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#d97706', width: COL_W, textAlign: 'center' }}>Agency</span>
                <span style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#2563eb', width: COL_W, textAlign: 'center' }}>Emails</span>
                <span style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#7c3aed', width: COL_W, textAlign: 'center' }}>Mgr</span>
                <span style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#16a34a', width: COL_W, textAlign: 'center' }}>Client</span>
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
                    display:             'grid',
                    gridTemplateColumns: '1fr auto',
                    padding:             '0.75rem 1rem',
                    gap:                 8,
                    borderBottom:        isLast ? 'none' : '1px solid var(--border)',
                    alignItems:          'center',
                    borderLeft:          row.isBc ? '3px solid #f59e0b' : '3px solid transparent',
                    background:          row.isBc ? 'rgba(245, 158, 11, 0.04)' : undefined,
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {row.isBc && (
                        <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em', background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 3, padding: '1px 4px', lineHeight: 1.4, flexShrink: 0 }}>
                          BC
                        </span>
                      )}
                      {row.label}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 1 }}>{row.description}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {/* Agency Discord */}
                    <div style={{ width: COL_W, display: 'flex', justifyContent: 'center' }}>
                      {row.hasAgency ? (
                        <Toggle checked={eff.agency} onChange={v => set(row.key, 'agency', v, row.linkedKeys)} color="amber" />
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>—</span>
                      )}
                    </div>
                    {/* Global Emails */}
                    <div style={{ width: COL_W, display: 'flex', justifyContent: 'center' }}>
                      {row.hasEmail ? (
                        <Toggle checked={eff.email} onChange={v => set(row.key, 'email', v, row.linkedKeys)} color="blue" />
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>—</span>
                      )}
                    </div>
                    {/* Acc Manager */}
                    <div style={{ width: COL_W, display: 'flex', justifyContent: 'center' }}>
                      {row.hasManager ? (
                        <Toggle checked={eff.manager} onChange={v => set(row.key, 'manager', v, row.linkedKeys)} color="purple" />
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>—</span>
                      )}
                    </div>
                    {/* Client Discord */}
                    <div style={{ width: COL_W, display: 'flex', justifyContent: 'center' }}>
                      {row.hasClient ? (
                        <Toggle checked={eff.client} onChange={v => set(row.key, 'client', v, row.linkedKeys)} color="green" />
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
