'use client'

// A client's open alerts, shown where you're looking at that client — admin only.
//
// Alerts used to be visible only in the Alerts inbox, so you could open a client's record or their
// dashboard and have no idea their Google connection had expired or their Ad Fuel was out. Each
// notice dismisses the alert everywhere (the same soft-dismiss the inbox uses).
//
// Renders nothing when the client has no open alerts, or when the request isn't an admin's.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, WarningCircle, Info } from '@phosphor-icons/react'
import AlertBody from './AlertBody'

interface Alert {
  id:         string
  type:       string
  severity:   string | null
  title:      string
  body:       string | null
  link_url:   string | null
  created_at: string
  meta?:      Record<string, unknown> | null
}

// Routine content notices (posts ready for review, auto-published, digests) belong in the content
// workflow, not on a client's record or dashboard. Only content alerts that need someone to act —
// a publish that failed, or a post due to be published by hand — surface here.
const ACTIONABLE_CONTENT = new Set(['auto_push_error', 'sa_auto_push_error', 'bc_spot_check', 'bc_sa_spot_check'])

// Same window as the Today page's "Needs attention": a notice on a client's record is about what is
// happening now. Anything older is still in the Alerts inbox, filtered to this client.
const RECENT_MS = 48 * 60 * 60 * 1000

function shouldShow(alert: Alert, now: number): boolean {
  const created = Date.parse(alert.created_at)
  if (!Number.isFinite(created) || now - created > RECENT_MS) return false
  if (alert.type !== 'content') return true
  const kind = typeof alert.meta?.content_type === 'string' ? alert.meta.content_type : ''
  return ACTIONABLE_CONTENT.has(kind)
}

const tone = (severity: string | null) =>
  severity === 'critical' || severity === 'high' || severity === 'error'
    ? { edge: 'var(--red)',   bg: 'var(--red-subtle)',   fg: 'var(--red)',   icon: <WarningCircle size={16} weight="fill" /> }
    : severity === 'warning' || severity === 'medium'
    ? { edge: 'var(--amber)', bg: 'var(--amber-subtle)', fg: 'var(--amber)', icon: <WarningCircle size={16} weight="fill" /> }
    : { edge: 'var(--blue)',  bg: 'var(--blue-subtle)',  fg: 'var(--blue)',  icon: <Info size={16} weight="fill" /> }

export default function ClientAlertsNotice({ clientId, max = 3 }: { clientId: string; max?: number }) {
  const [alerts, setAlerts]   = useState<Alert[]>([])
  const [dismissing, setDismissing] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/alerts?client_id=${encodeURIComponent(clientId)}&limit=${Math.max(25, max * 5)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((data: { alerts?: Alert[] } | null) => {
        if (!live || !data?.alerts) return
        const now = Date.now()
        setAlerts(data.alerts.filter(a => shouldShow(a, now)))
      })
      .catch(() => {})
    return () => { live = false }
  }, [clientId, max])

  const dismiss = async (id: string) => {
    setDismissing(id)
    const res = await fetch(`/api/admin/alerts/${id}`, { method: 'DELETE' }).catch(() => null)
    setDismissing(null)
    if (res?.ok) setAlerts(prev => prev.filter(a => a.id !== id))
  }

  if (alerts.length === 0) return null

  const shown = alerts.slice(0, max)
  const more  = alerts.length - shown.length

  return (
    <div className="client-alerts" role="region" aria-label="Open alerts for this client">
      {shown.map(alert => {
        const t = tone(alert.severity)
        return (
          <div key={alert.id} className="client-alerts__item" style={{ borderLeftColor: t.edge, background: t.bg }}>
            <span className="client-alerts__icon" style={{ color: t.fg }} aria-hidden>{t.icon}</span>
            <div className="client-alerts__text">
              <p className="client-alerts__title">{alert.title}</p>
              {alert.body && <AlertBody body={alert.body} lines={2} className="client-alerts__body" />}
            </div>
            {alert.link_url && (
              <Link href={alert.link_url} className="client-alerts__link" style={{ color: t.fg }}>View</Link>
            )}
            <button
              type="button"
              className="client-alerts__dismiss"
              onClick={() => dismiss(alert.id)}
              disabled={dismissing === alert.id}
              aria-label={`Dismiss: ${alert.title}`}
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        )
      })}
      {more > 0 && (
        <Link href="/admin/alerts" className="client-alerts__more">
          {more} more recent alert{more === 1 ? '' : 's'} for this client
        </Link>
      )}
    </div>
  )
}
