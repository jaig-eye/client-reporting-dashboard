'use client'

// One monitored site as a compact row: status, identity, uptime history, figures, and a "…" menu.
// The row's main area is a button that expands the site's SEO audit panel underneath.

import type { MouseEvent, ReactNode } from 'react'
import { CaretDown, DotsThree } from '@phosphor-icons/react'
import {
  type DailyRow, type Site, type SiteState, PLATFORM_LABELS,
  fmtPct, hostOf, scoreTone, shortDate, sslTone, stateLabel, uptimeTone,
} from './siteData'

interface Props {
  site:      Site
  state:     SiteState
  dates:     string[]
  /** This site's site_check_daily rows by date; undefined when it has none. */
  history?:  Map<string, DailyRow>
  open:      boolean
  menuOpen:  boolean
  onToggle:  () => void
  onMenu:    (e: MouseEvent<HTMLButtonElement>) => void
  children?: ReactNode
}

type DayTone = 'none' | 'up' | 'warn' | 'down'

function dayTone(row: DailyRow | undefined): DayTone {
  if (!row || !row.check_count || row.uptime_pct == null) return 'none'
  const pct = Number(row.uptime_pct)
  if (pct >= 99.9 && !row.incident_count) return 'up'
  return pct >= 95 ? 'warn' : 'down'
}

function dayTitle(date: string, row: DailyRow | undefined): string {
  if (!row || !row.check_count || row.uptime_pct == null) return `${shortDate(date)} · no checks`
  const parts = [shortDate(date), `${fmtPct(Number(row.uptime_pct))} up`, `${row.check_count} checks`]
  if (row.incident_count) parts.push(`${row.incident_count} incident${row.incident_count === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

function UptimeHistory({ site, dates, history }: { site: Site; dates: string[]; history?: Map<string, DailyRow> }) {
  if (history && history.size > 0) {
    const tones   = dates.map(d => dayTone(history.get(d)))
    const bad     = tones.filter(t => t === 'down' || t === 'warn').length
    const summary = `Last ${dates.length} days: ${bad ? `${bad} day${bad === 1 ? '' : 's'} with downtime` : 'no downtime recorded'}`
    return (
      <span className="site-bar" role="img" aria-label={summary}>
        {dates.map((d, i) => (
          <span key={d} className={`site-bar__day site-bar__day--${tones[i]}`} title={dayTitle(d, history.get(d))} />
        ))}
      </span>
    )
  }

  // No daily rollups for this site — show the 7-day figure the cron keeps, without inventing history.
  if (site.uptime_7d == null) {
    return <span className="site-bar-empty">{site.status === 'active' ? 'No checks yet' : 'Not monitored'}</span>
  }
  const pct = Number(site.uptime_7d)
  return (
    <span className="site-meter site-meter--row" role="img" aria-label={`7-day uptime ${fmtPct(pct)}`} title={`7-day uptime ${fmtPct(pct)}`}>
      <span className={`site-meter__fill site-bg--${uptimeTone(pct)}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </span>
  )
}

function SslChip({ days }: { days: number | null }) {
  if (days == null) return <span className="site-chip site-chip--faint" title="Certificate not checked yet">SSL —</span>
  const tone = sslTone(days)
  return (
    <span className={`site-chip site-chip--${tone}`} title={days <= 0 ? 'Certificate has expired' : `Certificate expires in ${days} days`}>
      {days <= 0 ? 'SSL expired' : `SSL ${days}d`}
    </span>
  )
}

export default function SiteRow({ site, state, dates, history, open, menuOpen, onToggle, onMenu, children }: Props) {
  const label = stateLabel(site, state)
  const pct   = site.uptime_7d == null ? null : Number(site.uptime_7d)

  return (
    <li className={`site-row site-row--${state}`} data-open={open || undefined}>
      <div className="site-row__line">
        <button
          type="button"
          className="site-row__main"
          aria-expanded={open}
          aria-controls={`site-audit-${site.id}`}
          onClick={onToggle}
        >
          <span className="site-row__status">
            <span className={`site-dot site-dot--${state}`} aria-hidden />
            <span className={`site-row__state site-state--${state}`}>{label}</span>
          </span>

          <span className="site-row__id">
            <span className="site-row__title">
              <span className="site-row__name">{site.name}</span>
              <span className="site-platform">{PLATFORM_LABELS[site.platform] ?? site.platform}</span>
            </span>
            <span className="site-row__sub">
              {hostOf(site.url)}
              {site.clients?.name && <><span aria-hidden> · </span>{site.clients.name}</>}
            </span>
          </span>

          <span className="site-row__history">
            <UptimeHistory site={site} dates={dates} history={history} />
          </span>

          <span className="site-row__figures">
            <SslChip days={site.ssl_days_remaining} />
            {site.audit_score != null ? (
              <span className={`site-chip site-chip--${scoreTone(site.audit_score)}`} title={`SEO audit score ${site.audit_score}`}>
                SEO {site.audit_score}
              </span>
            ) : site.audit_enabled ? (
              <span className="site-chip site-chip--faint" title="Weekly audit on, no score yet">SEO …</span>
            ) : <span className="site-row__slot" aria-hidden />}
            <span className={`site-row__pct site-tone--${uptimeTone(pct)}`} title="Uptime, last 7 days">
              {pct == null ? '—' : fmtPct(pct)}
            </span>
            <CaretDown className="site-row__caret" size={14} weight="bold" aria-hidden />
          </span>
        </button>

        <button
          type="button"
          className="site-row__menu"
          aria-label={`Actions for ${site.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={onMenu}
        >
          <DotsThree size={18} weight="bold" aria-hidden />
        </button>
      </div>

      {open && (
        <div className="site-row__panel" id={`site-audit-${site.id}`}>
          {children}
        </div>
      )}
    </li>
  )
}
