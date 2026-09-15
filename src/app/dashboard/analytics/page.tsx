// ─────────────────────────────────────────────────────────────────────────────
// Website traffic — /dashboard/analytics
//
// The client-facing audience report. It answers, in the order a business owner
// asks them: how many people came, how that compares to last period, how it
// moved day to day, where they came from, what they did once they arrived, and
// whether they were new or coming back.
//
// Everything below is read from two tables and nothing is inferred beyond the
// arithmetic noted at each step:
//   ga4_metrics        date, channel_group, sessions, users, new_users,
//                      page_views, conversions, engaged_sessions,
//                      bounce_rate, avg_session_duration
//   ga4_source_metrics date, source, medium, campaign, sessions, conversions,
//                      engaged_sessions
//
// Neither table carries a landing-page or device dimension, so this page has no
// "top pages" and no "desktop vs mobile" section — either would have to be
// invented. Add the columns and the sections can follow.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveDashboardRange } from '@/lib/dateRange'
import type { Client, ClientConnection, Connector } from '@/lib/types'
import SpendChart from '@/components/SpendChart'
import SparkMetricCard from '@/components/SparkMetricCard'
import TrafficBySourceTable from '@/components/TrafficBySourceTable'
import PageHeader from '@/components/dashboard/PageHeader'
import EmptyState from '@/components/dashboard/EmptyState'
import { ChartLine } from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

/** Concrete colours, only where a chart component's API needs a real value.
 *  Page chrome uses theme tokens so it follows light and dark. */
const SERIES_VISITS      = '#3b82f6'
const SERIES_CONVERSIONS = '#059669'
const GA4_ACCENT         = '#e37400'

// Cache GA4 metric queries for 10 minutes. Busted by revalidateTag('client-metrics') in sync cron.
const _getCachedGA4Metrics = unstable_cache(
  async (
    clientId: string,
    primaryGa4Id: string | null,
    from: string, to: string,
    priorFrom: string, priorTo: string,
    showCompare: boolean,
  ) => {
    const db = createAdminClient()
    const COLS = 'date,channel_group,sessions,users,new_users,page_views,conversions,engaged_sessions,bounce_rate,avg_session_duration'
    const currQ = db.from('ga4_metrics').select(COLS)
      .eq('client_id', clientId)
      .gte('date', from).lte('date', to)
      .order('date', { ascending: true })
      .limit(10000)
    const priorQ = db.from('ga4_metrics').select(COLS)
      .eq('client_id', clientId)
      .gte('date', priorFrom).lte('date', priorTo)
      .order('date', { ascending: true })
      .limit(10000)
    const srcQ = db.from('ga4_source_metrics')
      .select('source,medium,campaign,sessions,conversions,engaged_sessions')
      .eq('client_id', clientId)
      .gte('date', from).lte('date', to)
      .limit(10000)
    const [{ data: rows }, { data: priorRows }, { data: srcRows }] = await Promise.all([
      primaryGa4Id ? currQ.eq('connection_id', primaryGa4Id) : currQ,
      showCompare
        ? (primaryGa4Id ? priorQ.eq('connection_id', primaryGa4Id) : priorQ)
        : Promise.resolve({ data: null }),
      primaryGa4Id ? srcQ.eq('connection_id', primaryGa4Id) : srcQ,
    ])
    return { rows: rows ?? [], priorRows: priorRows ?? null, srcRows: srcRows ?? [] }
  },
  ['dashboard-ga4'],
  { revalidate: 600, tags: ['client-metrics'] }
)

// ── Formatting ───────────────────────────────────────────────────────────────

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function fmtNum(n: number) { return Math.round(n).toLocaleString() }
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%` }
function fmtSec(n: number) {
  const m = Math.floor(n / 60)
  const s = Math.round(n % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
/** "Aug 15" — a date in words rather than ISO, which no client reads. */
function fmtDay(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function fmtRange(from: Date, to: Date) { return `${fmtDay(from)} – ${fmtDay(to)}` }

function pctChange(curr: number, prev: number): number | null {
  if (!prev) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

// ── Row shapes — every field below is a real column on these tables ──────────

type Ga4Row = {
  date: string
  channel_group: string | null
  sessions: number | null
  users: number | null
  new_users: number | null
  page_views: number | null
  conversions: number | null
  engaged_sessions: number | null
  bounce_rate: number | null
  avg_session_duration: number | null
}

type SourceRow = {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  sessions?: number | null
  conversions?: number | null
  engaged_sessions?: number | null
}

/**
 * Roll a set of daily channel rows up into one period.
 *
 * Engagement rate is engaged_sessions / sessions — GA4's own definition. Where a
 * property predates that column and only bounce_rate is filled, it falls back to
 * 1 − bounce_rate, which answers the same question. Averages are weighted by
 * sessions: a day with 200 visits should not count the same as a day with three.
 */
function rollUp(rows: Ga4Row[]) {
  let sessions = 0, users = 0, newUsers = 0, pageViews = 0, conversions = 0
  let engaged = 0, durationWeighted = 0, bounceWeighted = 0
  for (const r of rows) {
    const s = num(r.sessions)
    sessions         += s
    users            += num(r.users)
    newUsers         += num(r.new_users)
    pageViews        += num(r.page_views)
    conversions      += num(r.conversions)
    engaged          += num(r.engaged_sessions)
    durationWeighted += num(r.avg_session_duration) * s
    bounceWeighted   += num(r.bounce_rate) * s
  }
  const per = (n: number) => (sessions > 0 ? n / sessions : 0)
  return {
    sessions, users, newUsers, pageViews, conversions, engaged,
    returningUsers: Math.max(0, users - newUsers),
    engagementRate: engaged > 0 ? per(engaged) : sessions > 0 ? 1 - per(bounceWeighted) : 0,
    avgDuration:    per(durationWeighted),
    pagesPerVisit:  per(pageViews),
    convRate:       per(conversions),
  }
}

/** Bar widths: never let a non-zero share render as an invisible sliver. */
const barWidth = (share: number) => `${share > 0 ? Math.max(share * 100, 2) : 0}%`

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: 'var(--text-faint)' }}>—</span>
  return (
    <span className={`an-delta ${value >= 0 ? 'an-delta--up' : 'an-delta--down'}`}>
      {value >= 0 ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>
}) {
  const cookieStore = await cookies()
  const db          = createAdminClient()
  const params      = await searchParams

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const { data: clientData } = await db.from('clients').select('*').eq('dashboard_token', token).maybeSingle()
  const client = clientData as Client | null
  if (!client) redirect('/access')

  // The window ends yesterday — today is a partial day and would read as a collapse.
  const { fromDate, toDate } = resolveDashboardRange(params)
  const compare     = params.compare ?? 'none'
  const showCompare = compare !== 'none'

  const periodMs = toDate.getTime() - fromDate.getTime()
  let priorTo:   Date
  let priorFrom: Date
  if (compare === 'last_year') {
    priorFrom = new Date(fromDate); priorFrom.setFullYear(priorFrom.getFullYear() - 1)
    priorTo   = new Date(toDate);   priorTo.setFullYear(priorTo.getFullYear() - 1)
  } else {
    priorTo   = new Date(fromDate.getTime() - 86400000)
    priorFrom = new Date(priorTo.getTime() - periodMs)
  }
  const priorWord  = compare === 'last_year' ? 'same period last year' : 'previous period'
  const priorShort = compare === 'last_year' ? 'last year' : 'last period'

  const { data: connData } = await db
    .from('client_connections')
    .select('*, connector:connectors(id, type, label)')
    .eq('client_id', client.id)
    .eq('status', 'active')

  const connections = (connData ?? []) as (ClientConnection & { connector: Pick<Connector, 'id' | 'type' | 'label'> })[]
  // A client can end up with two GA4 connections (an old one plus a reconnected
  // one). Querying without a connection_id would sum both and show double the
  // traffic they actually had, so only the most recently synced one counts.
  const ga4Connections = connections
    .filter(c => c.connector.type === 'google_analytics')
    .sort((a, b) => (b.last_synced_at ?? '').localeCompare(a.last_synced_at ?? ''))
  const primaryGa4Id = ga4Connections[0]?.id

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <PageHeader title="Website Traffic" accent={GA4_ACCENT} fromDate={fromDate} toDate={toDate} compare={compare} />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">{children}</main>
    </div>
  )

  if (ga4Connections.length === 0) {
    return shell(
      <EmptyState
        title="Your website analytics aren't connected yet"
        description="Once your Google Analytics property is linked, this page shows how many people visit your website, where they come from, and what they do once they arrive. Your account manager can set that up."
        icon={<ChartLine size={22} />}
      />
    )
  }

  const { rows, priorRows, srcRows } = await _getCachedGA4Metrics(
    client.id,
    primaryGa4Id,
    fmtDate(fromDate), fmtDate(toDate),
    fmtDate(priorFrom), fmtDate(priorTo),
    showCompare,
  )

  // GA4 returns an empty channel_group for sessions it could not attribute, and
  // its own Traffic Acquisition report leaves those out of the total. Mapping
  // them to Direct (what this page used to do) quietly inflated that bucket.
  const named      = (rows as Ga4Row[]).filter(r => r.channel_group && r.channel_group !== '')
  const priorNamed = ((priorRows ?? []) as Ga4Row[]).filter(r => r.channel_group && r.channel_group !== '')

  if (named.length === 0) {
    return shell(
      <EmptyState
        title="No website visits recorded in this period"
        description={`Nothing was tracked between ${fmtRange(fromDate, toDate)}. Try a wider date range — and if a whole month comes back empty, your account manager can check that tracking is still running on the site.`}
        icon={<ChartLine size={22} />}
      />
    )
  }

  const now   = rollUp(named)
  const prior = rollUp(priorNamed)

  // ── Day by day ─────────────────────────────────────────────────────────────
  const byDay = new Map<string, { sessions: number; users: number; pageViews: number; conversions: number }>()
  for (const r of named) {
    const key = r.date.split('T')[0]
    const ex  = byDay.get(key) ?? { sessions: 0, users: 0, pageViews: 0, conversions: 0 }
    ex.sessions    += num(r.sessions)
    ex.users       += num(r.users)
    ex.pageViews   += num(r.page_views)
    ex.conversions += num(r.conversions)
    byDay.set(key, ex)
  }
  const days = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b))

  const dailyTrend    = days.map(([date, v]) => ({ date, spend: v.sessions, conversions: v.conversions, clicks: 0, roas: 0 }))
  const visitorsSpark = days.map(([, v]) => ({ v: v.users }))
  const visitsSpark   = days.map(([, v]) => ({ v: v.sessions }))
  const pagesSpark    = days.map(([, v]) => ({ v: v.pageViews }))
  const convSpark     = days.map(([, v]) => ({ v: v.conversions }))

  const busiest = days.reduce<[string, number] | null>(
    (best, [date, v]) => (!best || v.sessions > best[1] ? [date, v.sessions] : best),
    null,
  )

  // ── Channels ───────────────────────────────────────────────────────────────
  const byChannel = new Map<string, Ga4Row[]>()
  for (const r of named) {
    const key = r.channel_group as string
    const ex  = byChannel.get(key)
    if (ex) ex.push(r)
    else byChannel.set(key, [r])
  }
  const priorByChannel = new Map<string, number>()
  for (const r of priorNamed) {
    const key = r.channel_group as string
    priorByChannel.set(key, (priorByChannel.get(key) ?? 0) + num(r.sessions))
  }

  const channels = Array.from(byChannel.entries())
    .map(([name, channelRows]) => {
      const c = rollUp(channelRows)
      return {
        name,
        sessions:       c.sessions,
        conversions:    c.conversions,
        engagementRate: c.engagementRate,
        convRate:       c.convRate,
        share:          now.sessions > 0 ? c.sessions / now.sessions : 0,
        delta:          showCompare ? pctChange(c.sessions, priorByChannel.get(name) ?? 0) : null,
      }
    })
    .sort((a, b) => b.sessions - a.sessions)

  const topChannel = channels[0]
  // Which channel actually converts — a 100% rate off four visits is noise, so a
  // channel needs a floor of traffic before it can be called the best.
  const bestConverting = channels
    .filter(c => c.conversions > 0 && c.sessions >= 30)
    .sort((a, b) => b.convRate - a.convRate)[0]

  // ── Source / medium / campaign ─────────────────────────────────────────────
  type SourceAgg = { source: string; medium: string; campaign: string; sessions: number; conversions: number; engaged_sessions: number }
  const sourceMap = new Map<string, SourceAgg>()
  for (const r of (srcRows ?? []) as SourceRow[]) {
    const source   = r.source   || '(direct)'
    const medium   = r.medium   || '(none)'
    const campaign = r.campaign || '(not set)'
    const key = `${source}|||${medium}|||${campaign}`
    const ex  = sourceMap.get(key) ?? { source, medium, campaign, sessions: 0, conversions: 0, engaged_sessions: 0 }
    ex.sessions         += num(r.sessions)
    ex.conversions      += num(r.conversions)
    ex.engaged_sessions += num(r.engaged_sessions)
    sourceMap.set(key, ex)
  }
  // Capped: a busy property would otherwise serialise thousands of combinations
  // into the client bundle for a table that shows twenty at a time.
  const allSources  = Array.from(sourceMap.values()).sort((a, b) => b.sessions - a.sessions).slice(0, 200)
  const sourceTotal = allSources.reduce((s, r) => s + r.sessions, 0)
  const topSources  = allSources.slice(0, 6)

  // ── New vs returning ───────────────────────────────────────────────────────
  // new_users is a column; returning is the remainder. GA4 counts a visitor once
  // per channel, so treat these as the split rather than a unique headcount.
  const newShare            = now.users > 0 ? now.newUsers / now.users : 0
  const returningShare      = now.users > 0 ? now.returningUsers / now.users : 0
  const priorReturningShare = prior.users > 0 ? prior.returningUsers / prior.users : 0

  const visitorsDelta = showCompare ? pctChange(now.users, prior.users) : null
  const since = (value: number, unit: string) =>
    showCompare ? `${fmtNum(value)} ${unit} ${priorShort}` : undefined

  return shell(
    <>
      {/* The answer in a sentence, before any chart. */}
      <section className="card an-lede">
        <p className="an-lede__line">
          <strong className="an-lede__figure">{fmtNum(now.users)}</strong> people visited your website between{' '}
          <strong>{fmtRange(fromDate, toDate)}</strong>
          {visitorsDelta != null && (
            <>
              {' — '}
              <strong style={{ color: visitorsDelta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {visitorsDelta >= 0 ? 'up' : 'down'} {Math.abs(visitorsDelta).toFixed(0)}%
              </strong>
              {' '}on the {priorWord}
            </>
          )}
          .
        </p>
        <p className="an-lede__sub">
          {topChannel && <>Most arrived through <strong>{topChannel.name}</strong>, {fmtPct(topChannel.share)} of all visits. </>}
          {now.conversions > 0
            ? <>They completed <strong>{fmtNum(now.conversions)}</strong> {now.conversions === 1 ? 'conversion' : 'conversions'} — {fmtPct(now.convRate)} of visits ended in one.</>
            : <>No conversions were tracked on the site in this period.</>}
        </p>
      </section>

      {/* How many came, and how that compares. */}
      <div className="stat-grid stat-grid--wide an-kpis">
        <SparkMetricCard
          label="Visitors" value={fmtNum(now.users)} sub={since(prior.users, 'visitors')}
          sparkData={visitorsSpark} sparkColor={SERIES_VISITS} delay={0}
          delta={visitorsDelta ?? undefined}
        />
        <SparkMetricCard
          label="Visits" value={fmtNum(now.sessions)} sub={since(prior.sessions, 'visits')}
          sparkData={visitsSpark} sparkColor={SERIES_VISITS} delay={1}
          delta={(showCompare ? pctChange(now.sessions, prior.sessions) : null) ?? undefined}
        />
        <SparkMetricCard
          label="Pages viewed" value={fmtNum(now.pageViews)} sub={since(prior.pageViews, 'views')}
          sparkData={pagesSpark} sparkColor={SERIES_VISITS} delay={2}
          delta={(showCompare ? pctChange(now.pageViews, prior.pageViews) : null) ?? undefined}
        />
        <SparkMetricCard
          label="Conversions" value={fmtNum(now.conversions)} sub={since(prior.conversions, 'conversions')}
          sparkData={convSpark} sparkColor={SERIES_CONVERSIONS} delay={3}
          delta={(showCompare ? pctChange(now.conversions, prior.conversions) : null) ?? undefined}
        />
      </div>

      {/* The trend over time. */}
      <section className="card p-4 sm:p-6">
        <div className="an-head">
          <div>
            <h2 className="section-title">Visits over time</h2>
            <p className="section-desc">
              Every day from {fmtRange(fromDate, toDate)}
              {busiest && <> · busiest day was {fmtDay(new Date(busiest[0]))} with {fmtNum(busiest[1])} visits</>}
            </p>
          </div>
          {showCompare && (
            <p className="an-head__aside">
              {priorWord}: <strong>{fmtNum(prior.sessions)}</strong> visits, <strong>{fmtNum(prior.conversions)}</strong> conversions
            </p>
          )}
        </div>
        <SpendChart
          data={dailyTrend}
          colorSpend={SERIES_VISITS}
          colorConversions={SERIES_CONVERSIONS}
          spendLabel="Visits"
          conversionsLabel="Conversions"
          variant="count"
        />
      </section>

      {/* What they did once they arrived. */}
      <section className="card an-band">
        <div className="an-band__item">
          <p className="metric-label">Engagement rate <span className="an-hint">engaged visits</span></p>
          <p className="an-band__value">{fmtPct(now.engagementRate)}</p>
          <p className="an-band__sub">
            {showCompare
              ? <><Delta value={pctChange(now.engagementRate, prior.engagementRate)} /> from {fmtPct(prior.engagementRate)} {priorShort}</>
              : 'Visits that lasted, browsed on, or converted'}
          </p>
        </div>
        <div className="an-band__item">
          <p className="metric-label">Time on site <span className="an-hint">per visit</span></p>
          <p className="an-band__value">{fmtSec(now.avgDuration)}</p>
          <p className="an-band__sub">
            {showCompare
              ? <><Delta value={pctChange(now.avgDuration, prior.avgDuration)} /> from {fmtSec(prior.avgDuration)} {priorShort}</>
              : 'How long an average visit lasts'}
          </p>
        </div>
        <div className="an-band__item">
          <p className="metric-label">Pages per visit</p>
          <p className="an-band__value">{now.pagesPerVisit.toFixed(1)}</p>
          <p className="an-band__sub">
            {showCompare
              ? <><Delta value={pctChange(now.pagesPerVisit, prior.pagesPerVisit)} /> from {prior.pagesPerVisit.toFixed(1)} {priorShort}</>
              : 'How far into the site people go'}
          </p>
        </div>
        <div className="an-band__item">
          <p className="metric-label">Conversion rate</p>
          <p className="an-band__value">{fmtPct(now.convRate)}</p>
          <p className="an-band__sub">
            {showCompare
              ? <><Delta value={pctChange(now.convRate, prior.convRate)} /> from {fmtPct(prior.convRate)} {priorShort}</>
              : 'Share of visits that ended in a conversion'}
          </p>
        </div>
      </section>

      {/* Where they came from, and who they were. */}
      <div className="an-panels">
        <section className="card p-4 sm:p-6">
          <div className="mb-4">
            <h2 className="section-title">Top sources</h2>
            <p className="section-desc">
              {topSources.length > 0
                ? `The named places your visits came from, as a share of the ${fmtNum(sourceTotal)} visits that can be traced to one`
                : 'Where visits came from'}
            </p>
          </div>
          {topSources.length > 0 ? (
            <ul className="an-bars">
              {topSources.map(s => {
                const share = sourceTotal > 0 ? s.sessions / sourceTotal : 0
                return (
                  <li key={`${s.source}|${s.medium}|${s.campaign}`} className="an-bar">
                    <span className="an-bar__track">
                      <span className="an-bar__fill" style={{ width: barWidth(share) }} aria-hidden />
                      <span className="an-bar__name">
                        {s.source}
                        <span className="an-bar__medium">{s.medium}</span>
                      </span>
                    </span>
                    <span className="an-bar__value">{fmtNum(s.sessions)}</span>
                    <span className="an-bar__pct">{fmtPct(share)}</span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="an-note">
              Visits are being recorded, but the referral detail behind them hasn&rsquo;t come through for these dates.
              The channel breakdown below still covers the whole period.
            </p>
          )}
        </section>

        <section className="card p-4 sm:p-6">
          <div className="mb-4">
            <h2 className="section-title">New vs returning</h2>
            <p className="section-desc">Whether people are finding you for the first time or coming back</p>
          </div>
          {now.users > 0 ? (
            <>
              <div
                className="an-split"
                role="img"
                aria-label={`${fmtPct(newShare)} new visitors, ${fmtPct(returningShare)} returning`}
              >
                <span className="an-split__seg an-split__seg--new" style={{ width: barWidth(newShare) }} />
                <span className="an-split__seg an-split__seg--ret" style={{ width: barWidth(returningShare) }} />
              </div>
              <dl className="an-legend">
                <div className="an-legend__row">
                  <dt><span className="an-dot an-dot--new" aria-hidden /> New visitors</dt>
                  <dd><strong>{fmtNum(now.newUsers)}</strong><span>{fmtPct(newShare)}</span></dd>
                </div>
                <div className="an-legend__row">
                  <dt><span className="an-dot an-dot--ret" aria-hidden /> Returning visitors</dt>
                  <dd><strong>{fmtNum(now.returningUsers)}</strong><span>{fmtPct(returningShare)}</span></dd>
                </div>
              </dl>
              <p className="an-note">
                {returningShare >= 0.35
                  ? 'A healthy share of people are coming back, so the site is earning more than a single look.'
                  : 'Most of this traffic is people finding you for the first time.'}
                {showCompare && prior.users > 0 && <> {priorShort === 'last year' ? 'Last year' : 'Last period'} it was {fmtPct(priorReturningShare)} returning.</>}
              </p>
            </>
          ) : (
            <p className="an-note">No visitor counts were recorded for these dates.</p>
          )}
        </section>
      </div>

      {/* Which channels actually convert. */}
      <section className="card p-4 sm:p-6">
        <div className="mb-4">
          <h2 className="section-title">How each channel performed</h2>
          <p className="section-desc">
            {bestConverting
              ? <>{channels.length} channels brought visits. <strong>{bestConverting.name}</strong> converts best, at {fmtPct(bestConverting.convRate)} of its visits.</>
              : <>{channels.length} channels brought visits in this period.</>}
          </p>
        </div>
        <div className="table-scroll">
          <table className="data-table an-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Channel</th>
                <th style={{ textAlign: 'right' }}>Visits</th>
                <th style={{ textAlign: 'right' }}>Share</th>
                {showCompare && <th style={{ textAlign: 'right' }}>vs {priorShort}</th>}
                <th style={{ textAlign: 'right' }}>Engagement</th>
                <th style={{ textAlign: 'right' }}>Conversions</th>
                <th style={{ textAlign: 'right' }}>Conv. rate</th>
              </tr>
            </thead>
            <tbody>
              {channels.map(ch => (
                <tr key={ch.name}>
                  <td className="an-table__name">
                    <span className="an-table__bar" style={{ width: barWidth(ch.share) }} aria-hidden />
                    <span className="an-table__label">{ch.name}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(ch.sessions)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(ch.share)}</td>
                  {showCompare && <td style={{ textAlign: 'right' }}><Delta value={ch.delta} /></td>}
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(ch.engagementRate)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{ch.conversions > 0 ? fmtNum(ch.conversions) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {ch.conversions > 0
                      ? <span className={bestConverting?.name === ch.name ? 'an-best' : undefined}>{fmtPct(ch.convRate)}</span>
                      : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="an-table__name"><span className="an-table__label">All channels</span></td>
                <td style={{ textAlign: 'right' }}>{fmtNum(now.sessions)}</td>
                <td style={{ textAlign: 'right' }}>100.0%</td>
                {showCompare && <td style={{ textAlign: 'right' }}><Delta value={pctChange(now.sessions, prior.sessions)} /></td>}
                <td style={{ textAlign: 'right' }}>{fmtPct(now.engagementRate)}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(now.conversions)}</td>
                <td style={{ textAlign: 'right' }}>{fmtPct(now.convRate)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* The full source / medium / campaign detail. */}
      {allSources.length > 0 ? (
        <section className="card p-4 sm:p-6">
          <div className="mb-4">
            <h2 className="section-title">Every source and campaign</h2>
            <p className="section-desc">
              {allSources.length} source and campaign combinations — filter to find a specific one
            </p>
          </div>
          <TrafficBySourceTable rows={allSources} />
        </section>
      ) : (
        <EmptyState
          title="No source detail for these dates"
          description="This is the line-by-line view of every website, search engine and campaign that sent you a visit. It fills in as soon as referral detail is recorded — the channel breakdown above already covers the whole period."
          icon={<ChartLine size={22} />}
        />
      )}
    </>
  )
}
