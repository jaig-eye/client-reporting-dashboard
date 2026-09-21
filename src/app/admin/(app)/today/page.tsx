// Today — /admin/today
// The admin's home: what needs attention across every client, and nothing else. The agency-wide
// KPI cards were removed — none of them was something to act on, and five of them cost a query
// apiece to render a number nobody used.
// Server component; every section loads in parallel and fails on its own, so one broken query
// shows a line of text instead of taking the whole page down.
//
// "Today" is a rolling window: agency_settings has no timezone, so "new" means created in the last
// 24 hours.

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  ArrowRight, ArrowsCounterClockwise, Article, Bell, CheckCircle, GasPump,
  Globe, Info, LockSimple, Warning, WarningOctagon,
} from '@phosphor-icons/react/dist/ssr'
import { createAdminClient } from '@/lib/supabase/server'
import { loadClientAdFuelBalances } from '@/lib/adFuelBalance'
import { balanceLevel } from '@/lib/adFuelColor'
import { getMonthlyReviewData } from '@/lib/content/monthlyReviewData'
import AlertBody, { alertPlainText } from '@/components/admin/AlertBody'
import Greeting from './Greeting'
import LowAdFuelList, { type LowFuelRow } from './LowAdFuelList'

export const dynamic = 'force-dynamic'

const DAY_MS        = 86_400_000
const SSL_WARN_DAYS = 14
const ALERT_LIMIT   = 6

// Content alerts are mostly routine (posts ready, auto-published, digests) and the Content card
// covers those. Only these content types are something to act on.
const ACTIONABLE_CONTENT = ['auto_push_error', 'sa_auto_push_error', 'bc_spot_check', 'bc_sa_spot_check']
const ACTIONABLE_ALERTS  = `type.neq.content,meta->>content_type.in.(${ACTIONABLE_CONTENT.join(',')})`

const SOURCE_LABELS: Record<string, string> = {
  google_ads:            'Google Ads',
  meta_ads:              'Meta Ads',
  google_search_console: 'Search Console',
  google_analytics_4:    'Google Analytics',
  google_business:       'Google Business',
  ahrefs:                'Ahrefs',
  ghl:                   'CRM',
  wordpress:             'WordPress',
  bigcommerce:           'BigCommerce',
}

type Severity = 'critical' | 'warning' | 'info'
const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 }

interface AlertRow {
  id: string; severity: string; client_id: string | null; client_name: string | null
  title: string; body: string | null; link_url: string | null; created_at: string
}
interface SyncJobRow {
  id: string; client_id: string | null; error_message: string | null; started_at: string
  client: { name: string } | null
  connection: { connector: { type: string } | null } | null
}
interface SiteRow {
  id: string; name: string; url: string; is_up: boolean | null
  ssl_days_remaining: number | null; uptime_7d: number | null
  clients: { name: string } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Settled<T> = { ok: true; value: T } | { ok: false; error: string }

async function settle<T>(fn: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[today]', error)
    return { ok: false, error }
  }
}

async function headCount(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

function relTime(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const mins = Math.round(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24)  return `${plural(hrs, 'hour')} ago`
  const days = Math.round(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7)  return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const shortDate = (isoDate: string) =>
  new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function hostOf(url: string) {
  try { return new URL(url).host } catch { return url }
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function Tag({ tone, icon, children }: { tone: 'red' | 'amber' | 'muted'; icon: ReactNode; children: ReactNode }) {
  return (
    <span className="today-tag" style={{ color: tone === 'muted' ? 'var(--text-muted)' : `var(--${tone})` }}>
      {icon}{children}
    </span>
  )
}

function SeverityTag({ severity }: { severity: string }) {
  const s = (severity in SEVERITY_RANK ? severity : 'info') as Severity
  if (s === 'critical') return <Tag tone="red"   icon={<WarningOctagon size={14} weight="fill" aria-hidden />}>Critical</Tag>
  if (s === 'warning')  return <Tag tone="amber" icon={<Warning size={14} weight="fill" aria-hidden />}>Warning</Tag>
  return <Tag tone="muted" icon={<Info size={14} weight="fill" aria-hidden />}>Info</Tag>
}

function Section({ id, icon, title, summary, action, children }: {
  id: string; icon: ReactNode; title: string; summary: ReactNode
  action?: { href: string; label: string }; children?: ReactNode
}) {
  return (
    <section id={id} className="card today-card" aria-labelledby={`${id}-title`}>
      <header className="today-card__head">
        <span className="today-card__icon" aria-hidden>{icon}</span>
        <div className="today-card__heading">
          <h2 id={`${id}-title`} className="today-card__title">{title}</h2>
          <p className="today-card__summary">{summary}</p>
        </div>
        {action && (
          <Link href={action.href} className="today-link">
            {action.label}<ArrowRight size={12} weight="bold" aria-hidden />
          </Link>
        )}
      </header>
      {children}
    </section>
  )
}

function AllClear({ children }: { children: ReactNode }) {
  return (
    <p className="today-clear">
      <CheckCircle size={16} weight="fill" aria-hidden style={{ color: 'var(--green)', flexShrink: 0 }} />
      {children}
    </p>
  )
}

function LoadError({ what }: { what: string }) {
  return (
    <p className="today-clear" style={{ color: 'var(--red)' }}>
      <Warning size={16} weight="fill" aria-hidden style={{ flexShrink: 0 }} />
      Couldn&rsquo;t load {what}. Refresh to try again.
    </p>
  )
}

function Row({ href, lead, title, meta, body, aside, linkLabel = 'View' }: {
  href?: string | null; lead?: ReactNode; title: ReactNode; meta?: ReactNode
  body?: ReactNode; aside?: ReactNode; linkLabel?: string
}) {
  return (
    <li className="today-row">
      <div className="today-row__main">
        {lead && <div className="today-row__lead">{lead}</div>}
        <p className="today-row__title">{title}</p>
        {body && <div className="today-row__body">{body}</div>}
        {meta && <p className="today-row__meta">{meta}</p>}
      </div>
      {(aside || href) && (
        <div className="today-row__aside">
          {aside}
          {href && (
            <Link href={href} className="today-link">
              {linkLabel}<ArrowRight size={12} weight="bold" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </li>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function TodayPage() {
  const db       = createAdminClient()
  const now      = Date.now()
  const since24h = new Date(now - DAY_MS).toISOString()
  const since48h = new Date(now - 2 * DAY_MS).toISOString()


  const [alertsRes, syncRes, fuelRes, reviewRes, sitesRes] = await Promise.all([
    // ── Alerts: new in the last 24h (actionable only), a 48h list, and the older backlog count
    settle(async () => {
      const count = () => db.from('admin_alerts').select('id', { count: 'exact', head: true }).is('dismissed_at', null)
      const [newTotal, newCritical, older, recent] = await Promise.all([
        headCount(count().gte('created_at', since24h).or(ACTIONABLE_ALERTS)),
        headCount(count().gte('created_at', since24h).or(ACTIONABLE_ALERTS).eq('severity', 'critical')),
        headCount(count().lt('created_at', since48h)),
        db.from('admin_alerts')
          .select('id, severity, client_id, client_name, title, body, link_url, created_at')
          .is('dismissed_at', null)
          .gte('created_at', since48h)
          .or(ACTIONABLE_ALERTS)
          .order('created_at', { ascending: false })
          .limit(200),
      ])
      if (recent.error) throw new Error(recent.error.message)
      const list = ((recent.data ?? []) as AlertRow[]).sort((a, b) =>
        (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      return { newTotal, newCritical, older, recent: list }
    }),
    settle(async () => {
      const { data, error } = await db.from('sync_jobs')
        .select('id, client_id, error_message, started_at, client:clients(name), connection:client_connections(connector:connectors(type))')
        .eq('status', 'error')
        .gte('started_at', since24h)
        .order('started_at', { ascending: false })
        .limit(500)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as SyncJobRow[]
    }),
    settle(async () => {
      const [balances, mutedRes] = await Promise.all([
        loadClientAdFuelBalances(db),
        db.from('clients').select('id').eq('ad_fuel_alert_muted', true),
      ])
      // The muted flag only hides rows; if it can't be read, show everyone rather than nothing.
      if (mutedRes.error) console.error('[today] muted clients:', mutedRes.error.message)
      const muted = new Set(((mutedRes.data ?? []) as { id: string }[]).map(c => c.id))
      return { balances, muted }
    }),
    settle(() => getMonthlyReviewData(db, null, mp => `/admin/content?view=review&month=${mp}`)),
    settle(async () => {
      const { data, error } = await db.from('sites')
        .select('id, name, url, is_up, ssl_days_remaining, uptime_7d, clients(name)')
        .eq('status', 'active')
        .order('name')
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as SiteRow[]
    }),
  ])

  // ── Alerts
  const alerts      = alertsRes.ok ? alertsRes.value : null
  const newTotal    = alerts?.newTotal ?? 0
  const newCritical = alerts?.newCritical ?? 0
  const recent      = alerts?.recent ?? []

  // ── Sync failures, grouped by client + platform (jobs arrive newest first)
  const syncJobs   = syncRes.ok ? syncRes.value : []
  const syncGroups = new Map<string, { key: string; clientId: string | null; clientName: string; source: string; count: number; latest: SyncJobRow }>()
  for (const j of syncJobs) {
    const type = j.connection?.connector?.type ?? 'unknown'
    const key  = `${j.client_id ?? 'none'}:${type}`
    const g    = syncGroups.get(key)
    if (g) g.count++
    else syncGroups.set(key, {
      key,
      clientId:   j.client_id,
      clientName: j.client?.name ?? 'Unknown client',
      source:     SOURCE_LABELS[type] ?? (type === 'unknown' ? 'Sync' : type.replace(/_/g, ' ')),
      count:      1,
      latest:     j,
    })
  }
  const syncList = Array.from(syncGroups.values())

  // ── Low Ad Fuel — a client that never bought or spent Ad Fuel is not "low"
  const lowFuel: LowFuelRow[] = (fuelRes.ok ? fuelRes.value.balances : [])
    .filter(r => r.afPurchased > 0 || r.afSpend > 0)
    .filter(r => balanceLevel(r.afBalance, r.alertThreshold) !== 'healthy')
    .sort((a, b) => a.afBalance - b.afBalance)
    .map(r => ({
      clientId:       r.clientId,
      clientName:     r.clientName,
      afBalance:      r.afBalance,
      alertThreshold: r.alertThreshold,
      muted:          fuelRes.ok && fuelRes.value.muted.has(r.clientId),
    }))
  const lowActive    = lowFuel.filter(r => !r.muted)

  // ── Content awaiting review this month (same window as /admin/content?view=review)
  const reviewPosts = reviewRes.ok
    ? reviewRes.value.posts.filter(p => p.status === 'for_review' || p.status === 'pending')
    : []
  const reviewByClient = new Map<string, { id: string; name: string; count: number; nextDate: string | null }>()
  for (const p of reviewPosts) {
    const g = reviewByClient.get(p.client_id)
    if (!g) {
      reviewByClient.set(p.client_id, { id: p.client_id, name: p.clientName, count: 1, nextDate: p.target_publish_date })
      continue
    }
    g.count++
    if (p.target_publish_date && (!g.nextDate || p.target_publish_date < g.nextDate)) g.nextDate = p.target_publish_date
  }
  const reviewList  = Array.from(reviewByClient.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const reviewMonth = reviewRes.ok ? reviewRes.value.month.split(' ')[0] : 'this month'
  const todayIso    = new Date(now).toISOString().slice(0, 10)

  // ── Sites
  const sites       = sitesRes.ok ? sitesRes.value : []
  const sitesDown   = sites.filter(s => s.is_up === false)
  const sslExpiring = sites
    .filter(s => s.ssl_days_remaining != null && s.ssl_days_remaining <= SSL_WARN_DAYS)
    .sort((a, b) => (a.ssl_days_remaining ?? 0) - (b.ssl_days_remaining ?? 0))

  // ── KPI values

  // ── Header
  const headline  = !alerts ? 'Here’s where things stand across every client.'
    : newTotal === 0
      ? 'No new alerts in the last 24 hours.'
      : `${plural(newTotal, 'new alert')} in the last 24 hours${newCritical ? `, ${newCritical} critical` : ''}.`

  return (
    <div className="today">
      <header className="today-hello">
        <p className="today-hello__eyebrow"><Greeting part="date" /></p>
        <h1 className="page-title"><Greeting part="greeting" /></h1>
        <p className="today-hello__line">{headline}</p>
      </header>

      <div className="today-grid">
        <div className="today-col">
          {/* ── Needs attention ──────────────────────────────────────── */}
          <Section
            id="attention"
            icon={<Bell size={16} weight="bold" />}
            title="Needs attention"
            summary={!alerts || recent.length === 0
              ? 'Alerts from the last 48 hours'
              : recent.length > ALERT_LIMIT
                ? `Most urgent ${ALERT_LIMIT} of ${recent.length} alerts from the last 48 hours`
                : `${plural(recent.length, 'alert')} from the last 48 hours, most urgent first`}
            action={{ href: '/admin/alerts', label: 'All alerts' }}
          >
            {!alerts ? <LoadError what="alerts" /> : recent.length === 0 ? (
              <AllClear>Nothing new in the last 48 hours.</AllClear>
            ) : (
              <ul className="today-list">
                {recent.slice(0, ALERT_LIMIT).map(a => (
                  <Row
                    key={a.id}
                    href={a.link_url}
                    lead={<>
                      <SeverityTag severity={a.severity} />
                      <span className="today-sep" aria-hidden>·</span>
                      <span className="today-row__client">{a.client_name ?? 'Agency-wide'}</span>
                    </>}
                    title={alertPlainText(a.title)}
                    body={a.body?.trim() ? <AlertBody body={a.body} lines={3} /> : null}
                    meta={<time dateTime={a.created_at}>{relTime(a.created_at, now)}</time>}
                  />
                ))}
              </ul>
            )}
            {alerts && alerts.older > 0 && (
              <div className="today-more">
                <span>+ {plural(alerts.older, 'older open alert')} in the inbox</span>
                <Link href="/admin/alerts" className="today-link">
                  Open inbox<ArrowRight size={12} weight="bold" aria-hidden />
                </Link>
              </div>
            )}
          </Section>

          {/* ── Sync failures ────────────────────────────────────────── */}
          <Section
            id="syncs"
            icon={<ArrowsCounterClockwise size={16} weight="bold" />}
            title="Sync failures"
            summary={!syncRes.ok || syncJobs.length === 0
              ? 'Last 24 hours'
              : `${plural(syncJobs.length, 'sync')} failed in the last 24 hours`}
            action={{ href: '/admin/system', label: 'Sync logs' }}
          >
            {!syncRes.ok ? <LoadError what="sync history" /> : syncList.length === 0 ? (
              <AllClear>Every sync in the last 24 hours succeeded.</AllClear>
            ) : (
              <ul className="today-list">
                {syncList.map(g => (
                  <Row
                    key={g.key}
                    href={g.clientId ? `/admin/clients/${g.clientId}?tab=advanced` : '/admin/system'}
                    linkLabel="Fix"
                    lead={<Tag tone="red" icon={<WarningOctagon size={14} weight="fill" aria-hidden />}>
                      {g.source} failed {g.count === 1 ? 'once' : `${g.count} times`}
                    </Tag>}
                    title={g.clientName}
                    body={g.latest.error_message ?? 'No error message recorded'}
                    meta={<>Last failed <time dateTime={g.latest.started_at}>{relTime(g.latest.started_at, now)}</time></>}
                  />
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="today-col">
          {/* ── Low Ad Fuel ──────────────────────────────────────────── */}
          <Section
            id="ad-fuel"
            icon={<GasPump size={16} weight="bold" />}
            title="Low Ad Fuel"
            summary={!fuelRes.ok || lowActive.length === 0
              ? 'Client balances'
              : `${plural(lowActive.length, 'client')} at or below their alert level`}
            action={{ href: '/admin/ad-fuel', label: 'Ad Fuel' }}
          >
            {!fuelRes.ok ? <LoadError what="Ad Fuel balances" /> : <LowAdFuelList rows={lowFuel} />}
          </Section>

          {/* ── Content awaiting review ──────────────────────────────── */}
          <Section
            id="content"
            icon={<Article size={16} weight="bold" />}
            title="Content awaiting review"
            summary={!reviewRes.ok || reviewPosts.length === 0
              ? `Posts due in ${reviewMonth}`
              : `${plural(reviewPosts.length, 'post')} due in ${reviewMonth} ${reviewPosts.length === 1 ? 'needs' : 'need'} a decision`}
            action={{ href: '/admin/content?view=review', label: 'Start review' }}
          >
            {!reviewRes.ok ? <LoadError what="the monthly review" /> : reviewList.length === 0 ? (
              <AllClear>No {reviewMonth} posts are waiting on you.</AllClear>
            ) : (
              <ul className="today-list">
                {reviewList.map(c => (
                  <Row
                    key={c.id}
                    href="/admin/content?view=review"
                    linkLabel="Review"
                    title={c.name}
                    meta={!c.nextDate ? null : c.nextDate < todayIso
                      ? <Tag tone="amber" icon={<Warning size={14} weight="fill" aria-hidden />}>Publish date {shortDate(c.nextDate)} has passed</Tag>
                      : <>Next publishes {shortDate(c.nextDate)}</>}
                    aside={<span className="today-count">{plural(c.count, 'post')}</span>}
                  />
                ))}
              </ul>
            )}
          </Section>

          {/* ── Sites ────────────────────────────────────────────────── */}
          <Section
            id="sites"
            icon={<Globe size={16} weight="bold" />}
            title="Sites"
            summary={!sitesRes.ok ? 'Uptime and SSL'
              : sitesDown.length === 0 && sslExpiring.length === 0
                ? `${plural(sites.length, 'active site')}`
                : [
                    sitesDown.length   && `${sitesDown.length} down`,
                    sslExpiring.length && `${plural(sslExpiring.length, 'certificate')} expiring within ${SSL_WARN_DAYS} days`,
                  ].filter(Boolean).join(', ')}
            action={{ href: '/admin/sites', label: 'All sites' }}
          >
            {!sitesRes.ok ? <LoadError what="sites" /> : sitesDown.length === 0 && sslExpiring.length === 0 ? (
              <AllClear>All sites are up and no certificates expire in the next {SSL_WARN_DAYS} days.</AllClear>
            ) : (
              <ul className="today-list">
                {sitesDown.map(s => (
                  <Row
                    key={`down-${s.id}`}
                    href="/admin/sites"
                    linkLabel="Sites"
                    lead={<Tag tone="red" icon={<WarningOctagon size={14} weight="fill" aria-hidden />}>Down</Tag>}
                    title={s.name}
                    body={hostOf(s.url)}
                    meta={[
                      s.clients?.name,
                      s.uptime_7d != null && `${Number(s.uptime_7d).toFixed(1)}% uptime this week`,
                    ].filter(Boolean).join(' · ') || null}
                  />
                ))}
                {sslExpiring.map(s => {
                  const d = s.ssl_days_remaining ?? 0
                  return (
                    <Row
                      key={`ssl-${s.id}`}
                      href="/admin/sites"
                      linkLabel="Sites"
                      lead={<Tag tone={d <= 3 ? 'red' : 'amber'} icon={<LockSimple size={14} weight="fill" aria-hidden />}>
                        {d < 0 ? 'SSL expired' : 'SSL expiring'}
                      </Tag>}
                      title={s.name}
                      body={hostOf(s.url)}
                      meta={[
                        d < 0 ? `Expired ${plural(-d, 'day')} ago` : d === 0 ? 'Expires today' : `Expires in ${plural(d, 'day')}`,
                        s.clients?.name,
                      ].filter(Boolean).join(' · ')}
                    />
                  )
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
