// Today — /admin/today
// The admin's home: what's new and what needs attention, across every client, plus a handful of
// agency-wide KPIs with a trend.
// Server component; every section loads in parallel and fails on its own, so one broken query
// shows a line of text instead of taking the whole page down.
//
// "Today" is a rolling window: agency_settings has no timezone, so "new" means created in the last
// 24 hours. Day-level metrics (spend, conversions, leads) use yesterday's UTC date, which is the
// last complete day the daily syncs have written.

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
import KpiCard, { type KpiDelta, type KpiTone } from './KpiCard'
import Greeting from './Greeting'
import LowAdFuelList, { type LowFuelRow } from './LowAdFuelList'

export const dynamic = 'force-dynamic'

const DAY_MS        = 86_400_000
const SSL_WARN_DAYS = 14
const ALERT_LIMIT   = 6
const PAGE_SIZE     = 1000
const MAX_PAGES     = 20

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
interface GoogleDayRow { client_id: string; campaign_id: string; date: string; spend: number | string; conversions: number | string }
interface MetaDayRow   { client_id: string; date: string; spend: number | string }
interface GhlDayRow    { date: string; contacts_created: number | null; spam_leads: number | null; reviews_received: number | null }

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

type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>

/** Read a bounded query past PostgREST's 1,000-row cap, one page at a time. */
async function fetchPaged<T>(page: (from: number, to: number) => PageResult): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
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

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const whole = (n: number) => Math.round(n).toLocaleString('en-US')

const shortDate = (isoDate: string) =>
  new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const weekday = (isoDate: string) =>
  new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })

function hostOf(url: string) {
  try { return new URL(url).host } catch { return url }
}

/** Percentage change as a chip. upTone/downTone say whether each direction is good news. */
function changeDelta(cur: number, prev: number, upTone: KpiTone, downTone: KpiTone, vs: string): KpiDelta | null {
  if (prev === 0 && cur === 0) return null
  if (prev === 0) return { text: 'New', direction: 'up', tone: upTone, label: `Up from zero ${vs}` }
  const pct = ((cur - prev) / prev) * 100
  const abs = Math.abs(pct)
  if (abs < 0.5) return null   // no meaningful change — show no pill rather than "0%"
  const up = pct > 0
  return {
    text:      `${abs >= 100 ? Math.round(abs) : abs.toFixed(1)}%`,
    direction: up ? 'up' : 'down',
    tone:      up ? upTone : downTone,
    label:     `${up ? 'Up' : 'Down'} ${abs.toFixed(1)}% ${vs}`,
  }
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

/**
 * Summary tile. tone colours the number and its line only for a genuinely bad state (red/amber);
 * "good" puts a green check on the line and leaves the number neutral.
 */
function Tile({ href, label, value, sub, tone }: {
  href: string; label: string; value: number | string; sub: ReactNode
  tone?: 'red' | 'amber' | 'good'
}) {
  const bad  = tone === 'red' || tone === 'amber'
  const icon = tone === 'red'   ? <WarningOctagon size={12} weight="fill" aria-hidden />
             : tone === 'amber' ? <Warning size={12} weight="fill" aria-hidden />
             : tone === 'good'  ? <CheckCircle size={12} weight="fill" aria-hidden />
             : null
  return (
    <a href={href} className="card today-tile">
      <p className="today-tile__label">{label}</p>
      <p className="today-tile__value" style={{ color: bad ? `var(--${tone})` : 'var(--text-primary)' }}>
        {value}
      </p>
      <p className={`today-tile__sub${tone === 'good' ? ' today-tile__sub--green' : ''}`} style={bad ? { color: `var(--${tone})` } : undefined}>
        {icon}{sub}
      </p>
    </a>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function TodayPage() {
  const db       = createAdminClient()
  const now      = Date.now()
  const since24h = new Date(now - DAY_MS).toISOString()
  const since48h = new Date(now - 2 * DAY_MS).toISOString()

  // Day buckets for the KPI trends: the 14 days ending yesterday (UTC), oldest first.
  const dayIso    = (daysAgo: number) => new Date(now - daysAgo * DAY_MS).toISOString().slice(0, 10)
  const days14    = Array.from({ length: 14 }, (_, i) => dayIso(14 - i))
  const yesterday = days14[13]
  const lastWeek  = days14[6]   // same weekday as yesterday, one week earlier
  const vsLastWeek = `vs last ${weekday(lastWeek)}`

  const [alertsRes, syncRes, fuelRes, reviewRes, sitesRes, adsRes, ghlRes, postsRes, syncRateRes, purchasesRes] = await Promise.all([
    // ── Alerts: new in the last 24h (actionable only), a 48h list, and the older backlog count
    settle(async () => {
      const count = () => db.from('admin_alerts').select('id', { count: 'exact', head: true }).is('dismissed_at', null)
      const [newTotal, newCritical, newWarning, older, recent] = await Promise.all([
        headCount(count().gte('created_at', since24h).or(ACTIONABLE_ALERTS)),
        headCount(count().gte('created_at', since24h).or(ACTIONABLE_ALERTS).eq('severity', 'critical')),
        headCount(count().gte('created_at', since24h).or(ACTIONABLE_ALERTS).eq('severity', 'warning')),
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
      return { newTotal, newCritical, newWarning, older, recent: list }
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
    // ── Ad spend + Google conversions per day. Google: campaign rows, de-duplicated per
    //    (client, campaign, date) like sum_google_spend_by_client. Meta spend: the ad-level
    //    daily_meta_spend_by_client RPC — never campaign-level meta_ads_metrics.
    settle(async () => {
      const [googleRows, metaRes] = await Promise.all([
        fetchPaged<GoogleDayRow>((from, to) => db.from('google_ads_metrics')
          .select('client_id, campaign_id, date, spend, conversions')
          .gte('date', days14[0]).lte('date', yesterday)
          .or('cost_micros.gt.0,conversions.gt.0')
          .order('id')
          .range(from, to)),
        db.rpc('daily_meta_spend_by_client', { floor_date: days14[0] }),
      ])
      if (metaRes.error) throw new Error(metaRes.error.message)
      const spend = new Map(days14.map(d => [d, 0]))
      const conv  = new Map(days14.map(d => [d, 0]))
      const seen  = new Set<string>()
      for (const r of googleRows) {
        const key = `${r.client_id}|${r.campaign_id}|${r.date}`
        if (seen.has(key) || !spend.has(r.date)) continue
        seen.add(key)
        spend.set(r.date, spend.get(r.date)! + (Number(r.spend) || 0))
        conv.set(r.date, conv.get(r.date)! + (Number(r.conversions) || 0))
      }
      for (const r of (metaRes.data ?? []) as MetaDayRow[]) {
        if (spend.has(r.date)) spend.set(r.date, spend.get(r.date)! + (Number(r.spend) || 0))
      }
      return { spend: days14.map(d => spend.get(d)!), conversions: days14.map(d => conv.get(d)!) }
    }),
    // ── CRM leads (new contacts minus spam, as on the CRM dashboard) and reviews per day
    settle(async () => {
      const rows = await fetchPaged<GhlDayRow>((from, to) => db.from('ghl_metrics')
        .select('date, contacts_created, spam_leads, reviews_received')
        .gte('date', days14[0]).lte('date', yesterday)
        .order('id')
        .range(from, to))
      const leads   = new Map(days14.map(d => [d, 0]))
      const reviews = new Map(days14.map(d => [d, 0]))
      for (const r of rows) {
        if (!leads.has(r.date)) continue
        leads.set(r.date, leads.get(r.date)! + Math.max(0, (Number(r.contacts_created) || 0) - (Number(r.spam_leads) || 0)))
        reviews.set(r.date, reviews.get(r.date)! + (Number(r.reviews_received) || 0))
      }
      return { leads: days14.map(d => leads.get(d)!), reviews: days14.map(d => reviews.get(d)!) }
    }),
    // ── Posts published in the last 14 days (7-day total + previous 7 days)
    settle(async () => {
      const { data, error } = await db.from('content_posts')
        .select('published_at')
        .eq('status', 'published')
        .gte('published_at', new Date(now - 14 * DAY_MS).toISOString())
        .limit(PAGE_SIZE)
      if (error) throw new Error(error.message)
      const times = ((data ?? []) as { published_at: string }[]).map(p => new Date(p.published_at).getTime())
      const last7 = times.filter(t => t >= now - 7 * DAY_MS).length
      const daily = Array.from({ length: 14 }, (_, i) => {
        const end = now - (13 - i) * DAY_MS
        return times.filter(t => t < end && t >= end - DAY_MS).length
      })
      return { last7, prev7: times.length - last7, daily }
    }),
    // ── Sync success rate: head counts only, this 24h vs the 24h before
    settle(async () => {
      const jobs = (status: 'success' | 'error', from: string, to?: string) => {
        let q = db.from('sync_jobs').select('id', { count: 'exact', head: true }).eq('status', status).gte('started_at', from)
        if (to) q = q.lt('started_at', to)
        return headCount(q)
      }
      const [ok, failed, okPrev, failedPrev] = await Promise.all([
        jobs('success', since24h), jobs('error', since24h),
        jobs('success', since48h, since24h), jobs('error', since48h, since24h),
      ])
      return { ok, failed, okPrev, failedPrev }
    }),
    // ── Ad Fuel purchased (same ledger the balance uses), last 60 days
    settle(async () => {
      const { data, error } = await db.from('ad_fuel_ledger')
        .select('date_of_payment, amount_af')
        .gte('date_of_payment', dayIso(59))
        .lte('date_of_payment', dayIso(0))
        .limit(PAGE_SIZE)
      if (error) throw new Error(error.message)
      const rows  = (data ?? []) as { date_of_payment: string; amount_af: number | string }[]
      const sum   = (from: string, to: string) => rows
        .filter(r => r.date_of_payment >= from && r.date_of_payment <= to)
        .reduce((s, r) => s + (Number(r.amount_af) || 0), 0)
      const weekly = Array.from({ length: 8 }, (_, i) => sum(dayIso(55 - i * 7), dayIso(49 - i * 7)))
      return { last30: sum(dayIso(29), dayIso(0)), prev30: sum(dayIso(59), dayIso(30)), weekly }
    }),
  ])

  // ── Alerts
  const alerts      = alertsRes.ok ? alertsRes.value : null
  const newTotal    = alerts?.newTotal ?? 0
  const newCritical = alerts?.newCritical ?? 0
  const newWarning  = alerts?.newWarning ?? 0
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
  const negativeFuel = lowActive.filter(r => r.afBalance < 0).length
  const mutedLow     = lowFuel.length - lowActive.length

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
  const uptimes     = sites.map(s => s.uptime_7d).filter((u): u is number => u != null).map(Number)
  const avgUptime   = uptimes.length ? uptimes.reduce((s, u) => s + u, 0) / uptimes.length : null

  // ── KPI values
  const ads       = adsRes.ok ? adsRes.value : null
  const ghl       = ghlRes.ok ? ghlRes.value : null
  const posts     = postsRes.ok ? postsRes.value : null
  const syncRate  = syncRateRes.ok ? syncRateRes.value : null
  const purchases = purchasesRes.ok ? purchasesRes.value : null

  const syncTotal     = syncRate ? syncRate.ok + syncRate.failed : 0
  const syncTotalPrev = syncRate ? syncRate.okPrev + syncRate.failedPrev : 0
  const syncPct       = syncTotal ? (syncRate!.ok / syncTotal) * 100 : null
  const syncPctPrev   = syncTotalPrev ? (syncRate!.okPrev / syncTotalPrev) * 100 : null
  let syncDelta: KpiDelta | null = null
  if (syncPct != null && syncPctPrev != null) {
    const pts = syncPct - syncPctPrev
    syncDelta = Math.abs(pts) < 0.5
      ? null   // no meaningful change — show no pill rather than "0 pts"
      : {
          text:      `${Math.abs(pts).toFixed(1)} pts`,
          direction: pts > 0 ? 'up' : 'down',
          tone:      pts > 0 ? 'good' : 'bad',
          label:     `${pts > 0 ? 'Up' : 'Down'} ${Math.abs(pts).toFixed(1)} points vs the previous 24 hours`,
        }
  }

  // ── Header
  const failed    = 'couldn’t load'
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

      {/* ── Summary strip: red only for genuinely bad states ─────────────── */}
      <div className="stat-grid today-strip">
        <Tile
          href="#attention" label="New alerts" value={alerts ? newTotal : '–'}
          tone={!alerts ? undefined : newCritical ? 'red' : newWarning ? 'amber' : newTotal === 0 ? 'good' : undefined}
          sub={!alerts ? failed
            : newCritical || newWarning
              ? [newCritical && `${newCritical} critical`, newWarning && `${newWarning} warning`].filter(Boolean).join(', ')
              : newTotal ? 'last 24 hours, nothing urgent' : 'nothing new in 24 hours'}
        />
        <Tile
          href="#syncs" label="Failed syncs" value={syncRes.ok ? syncJobs.length : '–'}
          tone={!syncRes.ok ? undefined : syncJobs.length ? 'red' : 'good'}
          sub={!syncRes.ok ? failed : syncJobs.length ? 'last 24 hours' : 'all succeeded in 24 hours'}
        />
        <Tile
          href="#ad-fuel" label="Low Ad Fuel" value={fuelRes.ok ? lowActive.length : '–'}
          tone={!fuelRes.ok ? undefined : negativeFuel ? 'red' : lowActive.length ? 'amber' : 'good'}
          sub={!fuelRes.ok ? failed
            : negativeFuel ? `${negativeFuel} below zero`
            : lowActive.length ? 'at or below alert level'
            : mutedLow ? `healthy, ${mutedLow} muted` : 'all balances healthy'}
        />
        <Tile
          href="#content" label="Posts to review" value={reviewRes.ok ? reviewPosts.length : '–'}
          tone={reviewRes.ok && reviewPosts.length === 0 ? 'good' : undefined}
          sub={!reviewRes.ok ? failed : reviewPosts.length ? `due in ${reviewMonth}` : `${reviewMonth} is reviewed`}
        />
        <Tile
          href="#sites" label="Sites down" value={sitesRes.ok ? sitesDown.length : '–'}
          tone={!sitesRes.ok || sites.length === 0 ? undefined : sitesDown.length ? 'red' : 'good'}
          sub={!sitesRes.ok ? failed
            : sitesDown.length ? `of ${plural(sites.length, 'active site')}`
            : sites.length ? `all ${plural(sites.length, 'site')} up` : 'no active sites'}
        />
      </div>

      {/* ── KPI spark cards ──────────────────────────────────────────────── */}
      <section aria-labelledby="kpis-title">
        <div className="today-subhead">
          <h2 id="kpis-title" className="today-subhead__title">At a glance</h2>
          <p className="today-subhead__note">Yesterday vs the same day last week, 14-day trend</p>
        </div>
        <div className="today-kpis">
          <KpiCard
            href="/admin/dashboard"
            label="Ad spend yesterday"
            error={!ads}
            value={ads ? money(ads.spend[13]) : null}
            compare={ads && `${money(ads.spend[6])} last ${weekday(lastWeek)}`}
            delta={ads && changeDelta(ads.spend[13], ads.spend[6], 'info', 'info', vsLastWeek)}
            spark={ads?.spend}
          />
          <KpiCard
            href="/admin/dashboard"
            label="Google Ads conversions"
            error={!ads}
            value={ads ? whole(ads.conversions[13]) : null}
            compare={ads && `${whole(ads.conversions[6])} last ${weekday(lastWeek)}`}
            delta={ads && changeDelta(Math.round(ads.conversions[13]), Math.round(ads.conversions[6]), 'good', 'bad', vsLastWeek)}
            spark={ads?.conversions}
          />
          <KpiCard
            label="CRM leads yesterday"
            error={!ghl}
            value={ghl ? whole(ghl.leads[13]) : null}
            compare={ghl && `${whole(ghl.leads[6])} last ${weekday(lastWeek)}`}
            delta={ghl && changeDelta(ghl.leads[13], ghl.leads[6], 'good', 'bad', vsLastWeek)}
            spark={ghl?.leads}
          />
          <KpiCard
            label="Reviews received yesterday"
            error={!ghl}
            value={ghl ? whole(ghl.reviews[13]) : null}
            compare={ghl && `${whole(ghl.reviews[6])} last ${weekday(lastWeek)}`}
            delta={ghl && changeDelta(ghl.reviews[13], ghl.reviews[6], 'good', 'bad', vsLastWeek)}
            spark={ghl?.reviews}
          />
          <KpiCard
            href="/admin/content"
            label="Posts published, 7 days"
            error={!posts}
            value={posts ? whole(posts.last7) : null}
            compare={posts && `${whole(posts.prev7)} the 7 days before`}
            delta={posts && changeDelta(posts.last7, posts.prev7, 'good', 'bad', 'vs the previous 7 days')}
            spark={posts?.daily}
          />
          <KpiCard
            href="/admin/system"
            label="Sync success, 24 hours"
            error={!syncRate}
            value={syncPct == null ? '–' : `${syncPct >= 99.95 || syncPct === 0 ? syncPct.toFixed(0) : syncPct.toFixed(1)}%`}
            compare={syncRate && (syncTotal ? `${whole(syncRate.ok)} of ${plural(syncTotal, 'run')} succeeded` : 'No syncs ran')}
            delta={syncDelta}
            meter={syncPct == null ? undefined : { pct: syncPct, tone: syncPct >= 95 ? 'good' : syncPct >= 80 ? 'neutral' : 'bad' }}
          />
          <KpiCard
            href="/admin/sites"
            label="Site uptime, 7 days"
            error={!sitesRes.ok}
            value={avgUptime == null ? '–' : `${avgUptime.toFixed(2)}%`}
            compare={avgUptime == null ? 'No uptime data yet' : `Average across ${plural(uptimes.length, 'site')}`}
            meter={avgUptime == null ? undefined : { pct: avgUptime, tone: avgUptime >= 99 ? 'good' : avgUptime >= 95 ? 'neutral' : 'bad' }}
          />
          <KpiCard
            href="/admin/ad-fuel"
            label="Ad Fuel purchased, 30 days"
            error={!purchases}
            value={purchases ? money(purchases.last30) : null}
            compare={purchases && `${money(purchases.prev30)} the 30 days before`}
            delta={purchases && changeDelta(purchases.last30, purchases.prev30, 'good', 'neutral', 'vs the previous 30 days')}
            spark={purchases?.weekly}
          />
        </div>
      </section>

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
