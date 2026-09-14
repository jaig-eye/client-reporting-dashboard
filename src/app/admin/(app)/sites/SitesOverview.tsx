'use client'

// The top of the Sites page: one status headline (all up / N down / N degraded) beside four figures.

import { CheckCircle, Warning, WarningOctagon, Pulse } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import {
  CHECK_INTERVAL_LABEL, type IncidentRow, type Site, fmtPct, plural, siteState, timeAgo, uptimeTone,
} from './siteData'

interface Props {
  sites:     Site[]
  incidents: IncidentRow[]
  loading:   boolean
}

type HeadTone = 'green' | 'amber' | 'red' | 'muted'

function Stat({ label, value, sub, tone, children }: {
  label: string; value: ReactNode; sub: ReactNode; tone?: HeadTone; children?: ReactNode
}) {
  return (
    <div className="site-stat">
      <p className="site-label">{label}</p>
      <p className={`site-stat__value${tone && tone !== 'muted' ? ` site-tone--${tone}` : ''}`}>{value}</p>
      <p className="site-stat__sub">{sub}</p>
      {children}
    </div>
  )
}

export default function SitesOverview({ sites, incidents, loading }: Props) {
  const active   = sites.filter(s => s.status === 'active')
  const states   = active.map(siteState)
  const down     = states.filter(s => s === 'down').length
  const degraded = states.filter(s => s === 'degraded').length
  const pending  = states.filter(s => s === 'pending').length
  const inactive = sites.length - active.length

  const lastChecked = active
    .map(s => s.last_checked_at)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1) ?? null

  const uptimes   = active.map(s => s.uptime_7d).filter((v): v is number => v != null).map(Number)
  const avgUptime = uptimes.length ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length : null

  const expiring = sites
    .filter(s => s.ssl_days_remaining != null && s.ssl_days_remaining <= 30)
    .sort((a, b) => (a.ssl_days_remaining ?? 0) - (b.ssl_days_remaining ?? 0))
  const sslCritical = expiring.some(s => (s.ssl_days_remaining ?? 99) <= 7)

  const openIncidents = incidents.filter(i => !i.ended_at).length

  let tone: HeadTone
  let title: string
  let line: string
  if (loading) {
    tone = 'muted'; title = 'Checking sites…'; line = 'Loading the latest uptime checks'
  } else if (active.length === 0) {
    tone = 'muted'; title = 'No sites monitored'
    line = inactive ? `${plural(inactive, 'site')} paused or archived` : 'Add a site to start monitoring'
  } else if (down > 0) {
    tone = 'red'; title = `${plural(down, 'site')} down`
    line = degraded ? `${degraded} more failing checks · ${active.length - down - degraded} up` : `${active.length - down} of ${active.length} up`
  } else if (degraded > 0) {
    tone = 'amber'; title = `${degraded} degraded`
    line = 'Failing checks, not yet declared down'
  } else if (pending === active.length) {
    tone = 'muted'; title = 'Waiting for the first check'
    line = `${plural(active.length, 'site')} queued`
  } else {
    tone = 'green'; title = active.length === 1 ? 'Your site is up' : 'All sites up'
    line = 'Everything is responding normally'
  }

  const Icon = tone === 'red' ? WarningOctagon : tone === 'amber' ? Warning : tone === 'green' ? CheckCircle : Pulse

  return (
    <section className="site-overview" aria-label="Monitoring summary">
      <div className={`card site-status site-status--${tone}`} role="status" aria-live="polite">
        <span className="site-status__icon" aria-hidden>
          <Icon size={26} weight="fill" />
        </span>
        <div className="site-status__text">
          <h2 className="site-status__title">{title}</h2>
          <p className="site-status__line">{line}</p>
          {!loading && active.length > 0 && (
            <p className="site-status__meta">
              Checked {CHECK_INTERVAL_LABEL}
              {lastChecked && <> · last check <time dateTime={lastChecked}>{timeAgo(lastChecked)}</time></>}
            </p>
          )}
        </div>
      </div>

      <div className="card site-stats">
        <Stat
          label="Sites monitored"
          value={loading ? '–' : active.length}
          sub={loading ? '\u00a0' : inactive ? `${inactive} paused or archived` : `${plural(sites.length, 'site')}, all active`}
        />
        <Stat
          label="Avg uptime, 7 days"
          value={loading || avgUptime == null ? '–' : fmtPct(avgUptime)}
          tone={uptimeTone(avgUptime)}
          sub={loading ? '\u00a0' : avgUptime == null ? 'No checks yet' : `Across ${plural(uptimes.length, 'site')}`}
        >
          {!loading && avgUptime != null && (
            <span className="site-meter" aria-hidden>
              <span className={`site-meter__fill site-bg--${uptimeTone(avgUptime)}`} style={{ width: `${Math.max(0, Math.min(100, avgUptime))}%` }} />
            </span>
          )}
        </Stat>
        <Stat
          label="SSL ≤ 30 days"
          value={loading ? '–' : expiring.length}
          tone={loading || expiring.length === 0 ? 'muted' : sslCritical ? 'red' : 'amber'}
          sub={loading ? '\u00a0' : expiring.length
            ? expiring.slice(0, 2).map(s => `${s.name} (${(s.ssl_days_remaining ?? 0) <= 0 ? 'expired' : `${s.ssl_days_remaining}d`})`).join(', ')
            : 'Every certificate has 30+ days'}
        />
        <Stat
          label="Down now"
          value={loading ? '–' : down}
          tone={loading ? 'muted' : down ? 'red' : active.length ? 'green' : 'muted'}
          sub={loading ? '\u00a0' : openIncidents
            ? `${plural(openIncidents, 'open incident')}`
            : down ? `of ${plural(active.length, 'active site')}` : degraded ? `${degraded} degraded` : 'No open incidents'}
        />
      </div>
    </section>
  )
}
