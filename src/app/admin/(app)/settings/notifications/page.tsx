'use client'

import { useCallback, useEffect, useState } from 'react'
import type { NotifConfig, NotifSettings } from '@/lib/notificationConfig'

// ── Notification type definitions ────────────────────────────────────────────

interface NotifRow {
  key:         string
  label:       string
  description: string
  hasOps:      boolean
  hasClient:   boolean
}

const GROUPS: { title: string; rows: NotifRow[] }[] = [
  {
    title: 'Uptime & SSL',
    rows: [
      { key: 'uptime_down',      label: 'Site DOWN alert',           description: 'Fires when a monitored site fails the flap threshold', hasOps: true,  hasClient: true  },
      { key: 'uptime_recovered', label: 'Site recovered',            description: 'Fires when a previously down site comes back up',      hasOps: true,  hasClient: true  },
      { key: 'ssl_expiry',       label: 'SSL expiring / expired',    description: 'Fires when a certificate is within 30 days of expiry', hasOps: true,  hasClient: false },
    ],
  },
  {
    title: 'Content',
    rows: [
      { key: 'content_monthly_review',  label: 'Monthly review ready',        description: 'Once-per-month when posts are generated and ready to approve',    hasOps: true,  hasClient: false },
      { key: 'content_mid_month_check', label: 'Mid-month pending reminder',   description: 'Once-per-month after the 10th if posts are still unapproved',    hasOps: true,  hasClient: false },
      { key: 'content_bc_post_due',     label: 'BC post due tomorrow',         description: 'BigCommerce post due within 24 h with no WP/BC publish ID',      hasOps: true,  hasClient: false },
      { key: 'content_sa_auto_pushed',  label: 'SA pages auto-pushed',         description: 'Service area pages automatically pushed to WordPress/BC',         hasOps: true,  hasClient: false },
      { key: 'content_bc_sa_due',       label: 'BC service area page due',     description: 'BC service area page due tomorrow and not yet published',         hasOps: true,  hasClient: false },
      { key: 'content_post_generated',  label: 'Post generated',               description: 'Sent to client channel when a new post is ready for review',     hasOps: false, hasClient: true  },
      { key: 'content_post_published',  label: 'Post published to WP / BC',   description: 'Sent to client channel when a post is uploaded and approved',    hasOps: false, hasClient: true  },
      { key: 'content_sa_generated',    label: 'Service area page generated',  description: 'Sent to client channel when a SA page is ready for review',      hasOps: false, hasClient: true  },
    ],
  },
  {
    title: 'Ad Management',
    rows: [
      { key: 'ad_fuel_low',     label: 'Ad Fuel low / depleted',    description: 'Balance dropped below threshold or hit zero',        hasOps: false, hasClient: true },
      { key: 'ad_fuel_paused',  label: 'Campaigns auto-paused',     description: 'Ad Fuel balance went negative and campaigns paused', hasOps: false, hasClient: true },
      { key: 'ad_fuel_resumed', label: 'Campaigns auto-resumed',    description: 'Balance restored and campaigns re-enabled',          hasOps: false, hasClient: true },
      { key: 'bc_daily_sales',  label: 'BigCommerce daily sales',   description: 'Daily sales summary sent to client channel',         hasOps: false, hasClient: true },
    ],
  },
  {
    title: 'Email Workflow',
    rows: [
      { key: 'email_submitted', label: 'New email submitted',    description: 'An email campaign was submitted for review',               hasOps: true, hasClient: true },
      { key: 'email_reminder',  label: 'Weekly email reminder',  description: 'Client has not submitted required emails this week',       hasOps: true, hasClient: true },
    ],
  },
  {
    title: 'Sync & Integration',
    rows: [
      { key: 'sync_connector_error', label: 'Connector auth error', description: 'An OAuth token expired or was revoked', hasOps: true, hasClient: false },
    ],
  },
]

const DEFAULT_SETTING: NotifSettings = { discord: true, ops: true, client: true }

// ── Component ─────────────────────────────────────────────────────────────────

export default function NotificationSettingsPage() {
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

  const get = useCallback((key: string): NotifSettings => {
    return local?.[key] ?? DEFAULT_SETTING
  }, [local])

  function set(key: string, field: keyof NotifSettings, value: boolean) {
    setLocal(prev => {
      const cur = prev?.[key] ?? { ...DEFAULT_SETTING }
      return { ...prev, [key]: { ...cur, [field]: value } }
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

  if (loading) return <div className="p-6" style={{ color: 'var(--text-muted)' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Notification Center
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Control which Discord notifications fire for each event type. Ops = agency ops channel; Client = per-client Discord channel.
          </p>
        </div>
        <a href="/admin/settings?tab=notifications" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', textDecoration: 'none' }}>
          ← Back to settings
        </a>
      </div>

      {/* Dirty banner */}
      {isDirty && (
        <div style={{ background: 'var(--amber-subtle, #fffbeb)', border: '1px solid var(--amber, #f59e0b)', borderRadius: 8, padding: '0.625rem 0.875rem', marginBottom: '1rem', fontSize: '0.8125rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>Unsaved changes</span>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ background: 'var(--red-subtle, #fef2f2)', border: '1px solid var(--red)', borderRadius: 8, padding: '0.625rem 0.875rem', marginBottom: '1rem', fontSize: '0.8125rem', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {success && !isDirty && (
        <div style={{ background: 'var(--green-subtle, #f0fdf4)', border: '1px solid var(--green)', borderRadius: 8, padding: '0.625rem 0.875rem', marginBottom: '1rem', fontSize: '0.8125rem', color: 'var(--green)' }}>
          Settings saved
        </div>
      )}

      {/* Groups */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {GROUPS.map(group => (
          <div key={group.title} className="card" style={{ overflow: 'hidden' }}>
            {/* Group header */}
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                {group.title}
              </span>
            </div>

            {/* Column header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', gap: 8 }}>
              <div />
              <div style={{ display: 'flex', gap: 28, paddingRight: 4 }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', width: 52, textAlign: 'center' }}>Discord</span>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', width: 36, textAlign: 'center' }}>Ops</span>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', width: 46, textAlign: 'center' }}>Client</span>
              </div>
            </div>

            {/* Rows */}
            {group.rows.map((row, i) => {
              const cfg = get(row.key)
              const isLast = i === group.rows.length - 1
              return (
                <div
                  key={row.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    padding: '0.75rem 1rem',
                    gap: 8,
                    borderBottom: isLast ? 'none' : '1px solid var(--border)',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{row.label}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 1 }}>{row.description}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 28, alignItems: 'center', paddingRight: 4 }}>
                    {/* Discord master toggle */}
                    <div style={{ width: 52, display: 'flex', justifyContent: 'center' }}>
                      <Toggle
                        checked={cfg.discord}
                        onChange={v => set(row.key, 'discord', v)}
                        color="blue"
                      />
                    </div>
                    {/* Ops */}
                    <div style={{ width: 36, display: 'flex', justifyContent: 'center' }}>
                      {row.hasOps ? (
                        <Toggle
                          checked={cfg.ops && cfg.discord}
                          disabled={!cfg.discord}
                          onChange={v => set(row.key, 'ops', v)}
                          color="purple"
                        />
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>—</span>
                      )}
                    </div>
                    {/* Client */}
                    <div style={{ width: 46, display: 'flex', justifyContent: 'center' }}>
                      {row.hasClient ? (
                        <Toggle
                          checked={cfg.client && cfg.discord}
                          disabled={!cfg.discord}
                          onChange={v => set(row.key, 'client', v)}
                          color="green"
                        />
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

      {/* Save footer */}
      <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !isDirty}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

// ── Toggle pill ───────────────────────────────────────────────────────────────

function Toggle({ checked, disabled, onChange, color }: {
  checked:   boolean
  disabled?: boolean
  onChange:  (v: boolean) => void
  color:     'blue' | 'green' | 'purple'
}) {
  const colorMap = {
    blue:   { on: '#3b82f6', off: 'var(--border)' },
    green:  { on: '#22c55e', off: 'var(--border)' },
    purple: { on: '#8b5cf6', off: 'var(--border)' },
  }
  const { on, off } = colorMap[color]
  const bg = checked ? on : off

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 10, background: bg, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative', transition: 'background 0.15s', opacity: disabled ? 0.4 : 1, flexShrink: 0, padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16,
          borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  )
}
