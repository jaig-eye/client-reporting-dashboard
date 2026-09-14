'use client'

// "Recent incidents": sites down right now, then closed incidents from site_incidents (last 30 days).
// A site the cron has marked down but with no open incident row still shows, from its own state.

import { CheckCircle } from '@phosphor-icons/react'
import {
  CAUSE_LABELS, type IncidentRow, type Site, fmtDuration, plural, timeAgo,
} from './siteData'

interface Props {
  sites:      Site[]
  incidents:  IncidentRow[]
  loading:    boolean
  onOpenSite: (id: string) => void
}

const LIMIT = 8

interface Item { key: string; siteId: string; name: string; ongoing: boolean; title: string; meta: string }

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function causeLabel(cause: string | null): string {
  return cause ? CAUSE_LABELS[cause] ?? 'Down' : 'Down'
}

export default function IncidentsRail({ sites, incidents, loading, onOpenSite }: Props) {
  const byId       = new Map(sites.map(s => [s.id, s]))
  const openBySite = new Map(incidents.filter(i => !i.ended_at).map(i => [i.site_id, i]))
  const items: Item[] = []

  for (const s of sites) {
    if (s.status !== 'active' || s.is_up !== false) continue
    const inc = openBySite.get(s.id)
    items.push({
      key: inc?.id ?? `down-${s.id}`, siteId: s.id, name: s.name, ongoing: true,
      title: inc ? causeLabel(inc.cause) : 'Down',
      meta: inc
        ? `Since ${when(inc.started_at)} · ${fmtDuration(Math.max(0, Math.floor((Date.now() - new Date(inc.started_at).getTime()) / 1000)))}`
        : `${plural(s.consecutive_failures ?? 0, 'failed check')} in a row · checked ${timeAgo(s.last_checked_at)}`,
    })
  }
  for (const inc of incidents) {
    if (!inc.ended_at) continue
    const s = byId.get(inc.site_id)
    if (!s) continue
    items.push({
      key: inc.id, siteId: s.id, name: s.name, ongoing: false,
      title: `${causeLabel(inc.cause)}${inc.duration_s != null ? ` · ${fmtDuration(inc.duration_s)}` : ''}`,
      meta: `Resolved · started ${when(inc.started_at)}`,
    })
  }

  return (
    <section className="card site-rail" aria-labelledby="site-rail-title">
      <header className="site-rail__head">
        <h2 id="site-rail-title" className="site-rail__title">Recent incidents</h2>
        <p className="site-rail__note">Last 30 days</p>
      </header>
      {loading ? (
        <p className="site-rail__empty">Loading…</p>
      ) : items.length === 0 ? (
        <p className="site-rail__empty">
          <CheckCircle size={16} weight="fill" aria-hidden className="site-tone--green" />
          No incidents in the last 30 days.
        </p>
      ) : (
        <ol className="site-incidents">
          {items.slice(0, LIMIT).map(item => (
            <li key={item.key}>
              <button type="button" className="site-incident" onClick={() => onOpenSite(item.siteId)}>
                <span className={`site-incident__mark${item.ongoing ? ' site-incident__mark--live' : ''}`} aria-hidden />
                <span className="site-incident__body">
                  <span className="site-incident__top">
                    <span className="site-incident__name">{item.name}</span>
                    {item.ongoing && <span className="site-chip site-chip--red">Ongoing</span>}
                  </span>
                  <span className="site-incident__title">{item.title}</span>
                  <span className="site-incident__meta">{item.meta}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {items.length > LIMIT && <p className="site-rail__more">+ {items.length - LIMIT} more</p>}
    </section>
  )
}
