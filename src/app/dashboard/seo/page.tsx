// ─────────────────────────────────────────────────────────────────────────────
// SEO report — /dashboard/seo
//
// One page for everything a local business wants to know about how people find
// them: search results (Search Console, live API), the map listing (Business
// Profile), tracked keyword positions (DataForSEO) and site authority (Ahrefs).
// It replaces the four thin sub-pages, which said one number each and made the
// client click four times to assemble the answer themselves.
//
// Every section stands on its own: a connector that isn't connected, or has no
// rows for the chosen dates, says so in the client's words instead of rendering
// an empty shell. Sections that are genuinely optional (rank tracking, the map
// grid embed) are left out entirely rather than shown as a gap.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies }           from 'next/headers'
import { redirect }          from 'next/navigation'
import { unstable_cache }    from 'next/cache'
import type { ReactNode }    from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveDashboardRange } from '@/lib/dateRange'
import type { Client, DailyMetric } from '@/lib/types'
import { fetchGSCLiveData }  from '@/lib/gsc-live'
import type { GSCSummaryResult } from '@/lib/gsc-live'
import PageHeader            from '@/components/dashboard/PageHeader'
import EmptyState            from '@/components/dashboard/EmptyState'
import SparkMetricCard       from '@/components/SparkMetricCard'
import SpendChart            from '@/components/SpendChart'
import GscTrendChart         from './search-console/GscTrendChart'
import type { GscDailyPoint } from './search-console/GscTrendChart'
import { GscQueriesTable, GscPagesTable } from './search-console/GscSortableTable'
import {
  MagnifyingGlass, Storefront, ChartLineUp, LinkSimple, MapTrifold,
} from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

// Live Search Console calls are cached for 15 minutes and busted by the sync cron's
// revalidateTag('client-metrics'), exactly as the Search Console page does it.
const _getCachedGSCLive = unstable_cache(
  async (
    connectionId: string,
    from: string, to: string,
    compFrom: string | null, compTo: string | null,
    showCompare: boolean,
  ) => {
    const [curr, comp] = await Promise.all([
      fetchGSCLiveData(connectionId, from, to, 25),
      showCompare && compFrom && compTo
        ? fetchGSCLiveData(connectionId, compFrom, compTo, 25)
        : Promise.resolve(null),
    ])
    return { curr, comp }
  },
  ['dashboard-seo-gsc-live'],
  { revalidate: 900, tags: ['client-metrics'] }
)

// ── formatting ───────────────────────────────────────────────────────────────

const iso     = (d: Date) => d.toISOString().split('T')[0]
const fmtNum  = (n: number) => Math.round(n).toLocaleString()
const fmtPct  = (n: number) => `${(n * 100).toFixed(1)}%`
const fmtPos  = (n: number) => n.toFixed(1)
const fmtDay  = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Percentage change, or undefined when there is nothing to compare against. */
function pctDelta(curr: number, prev: number): number | undefined {
  if (!prev) return undefined
  return ((curr - prev) / Math.abs(prev)) * 100
}

function pathOf(url: string): string {
  try { const u = new URL(url); return (u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '')) + (u.search || '') }
  catch { return url }
}

function positionClass(pos: number): string {
  if (pos <= 3)  return 'seo-pos seo-pos--top'
  if (pos <= 10) return 'seo-pos seo-pos--page1'
  return 'seo-pos seo-pos--rest'
}

// ── small presentational pieces (server-rendered) ────────────────────────────

function SectionHead({ icon, tint, tintBg, title, desc, meta }: {
  icon: ReactNode; tint: string; tintBg: string
  title: string; desc: string; meta?: ReactNode
}) {
  return (
    <div className="seo-section__head">
      <span className="seo-section__icon" style={{ background: tintBg, color: tint }} aria-hidden>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <h2 className="seo-section__title">{title}</h2>
        <p className="seo-section__desc">{desc}</p>
      </div>
      {meta && <span className="seo-section__meta">{meta}</span>}
    </div>
  )
}

function Panel({ title, desc, flush, children }: {
  title: string; desc?: string; flush?: boolean; children: ReactNode
}) {
  return (
    <section className="card seo-panel">
      <div className="seo-panel__head">
        <h3 className="section-title">{title}</h3>
        {desc && <p className="section-desc">{desc}</p>}
      </div>
      <div className={flush ? 'seo-panel__body seo-panel__body--flush' : 'seo-panel__body'}>{children}</div>
    </section>
  )
}

/** A labelled proportional bar — used for rank bands and for search-vs-maps. */
function Bar({ label, value, total, tint, suffix }: {
  label: string; value: number; total: number; tint: string; suffix?: string
}) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="seo-bar">
      <span className="seo-bar__label">{label}</span>
      <span className="seo-bar__value">
        {fmtNum(value)}{suffix}
        {total > 0 && <span className="seo-bar__pct">{pct.toFixed(0)}%</span>}
      </span>
      <span className="seo-bar__track">
        <span className="seo-bar__fill" style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%`, background: tint }} />
      </span>
    </div>
  )
}

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating)
  return (
    <span className="seo-stars" aria-label={`${rating.toFixed(1)} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ color: i < full ? 'var(--amber)' : 'var(--border)' }} aria-hidden>★</span>
      ))}
    </span>
  )
}

/** Change in ranking position. Positive delta = moved toward #1. */
function Move({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return <span className="seo-move seo-move--flat">—</span>
  return (
    <span className={delta > 0 ? 'seo-move seo-move--up' : 'seo-move seo-move--down'}>
      {delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`}
    </span>
  )
}

/** Average position over time. Drawn top-down: higher on the chart = closer to #1. */
function PositionTrend({ points }: { points: { date: string; avg: number }[] }) {
  if (points.length < 2) return null
  const min  = Math.min(...points.map(p => p.avg))
  const max  = Math.max(...points.map(p => p.avg))
  const span = Math.max(max - min, 1)
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100
    const y = 3 + ((p.avg - min) / span) * 26
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  return (
    <div>
      <svg className="seo-trend" viewBox="0 0 100 32" preserveAspectRatio="none" role="img"
           aria-label={`Average position from ${fmtDay(points[0].date)} to ${fmtDay(points[points.length - 1].date)}`}>
        <polyline
          points={coords.join(' ')}
          vectorEffect="non-scaling-stroke"
          style={{ fill: 'none', stroke: 'var(--blue)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}
        />
      </svg>
      <div className="seo-trend__axis">
        <span>{fmtDay(points[0].date)} · {fmtPos(points[0].avg)}</span>
        <span>higher is closer to the top of Google</span>
        <span>{fmtDay(points[points.length - 1].date)} · {fmtPos(points[points.length - 1].avg)}</span>
      </div>
    </div>
  )
}

// ── row shapes ───────────────────────────────────────────────────────────────

interface GbpRow {
  date: string; location_id: string; location_name: string | null
  views_search: number; views_maps: number
  website_clicks: number; call_clicks: number; direction_clicks: number
  reviews_count: number; reviews_avg_rating: number
}

interface RankRow {
  keyword: string
  current_position: number | null
  previous_position: number | null
  position_delta: number | null
  current_url: string | null
  search_volume: number | null
}

interface AhrefsMetricRow {
  date: string
  domain_rating: number | null; backlinks: number | null; referring_domains: number | null
  organic_keywords: number | null; organic_traffic: number | null; traffic_value: number | null
  new_backlinks: number | null; lost_backlinks: number | null
  new_referring_domains: number | null; lost_referring_domains: number | null
}

function gbpTotals(rows: GbpRow[]) {
  return rows.reduce((a, r) => ({
    search:     a.search     + (r.views_search     ?? 0),
    maps:       a.maps       + (r.views_maps       ?? 0),
    calls:      a.calls      + (r.call_clicks      ?? 0),
    directions: a.directions + (r.direction_clicks ?? 0),
    website:    a.website    + (r.website_clicks   ?? 0),
  }), { search: 0, maps: 0, calls: 0, directions: 0, website: 0 })
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function SeoPage({
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

  const { fromDate, toDate } = resolveDashboardRange(params)
  const compare     = params.compare ?? 'none'
  const showCompare = compare === 'prior_period' || compare === 'last_year'

  let compFrom: Date | null = null
  let compTo:   Date | null = null
  if (showCompare) {
    if (compare === 'last_year') {
      compFrom = new Date(fromDate); compFrom.setFullYear(compFrom.getFullYear() - 1)
      compTo   = new Date(toDate);   compTo.setFullYear(compTo.getFullYear() - 1)
    } else {
      const ms = toDate.getTime() - fromDate.getTime()
      compTo   = new Date(fromDate.getTime() - 86_400_000)
      compFrom = new Date(compTo.getTime() - ms)
    }
  }

  const GBP_COLS = 'date, location_id, location_name, views_search, views_maps, website_clicks, call_clicks, direction_clicks, reviews_count, reviews_avg_rating'

  // Phase 1 — everything that doesn't depend on another query, in parallel.
  const [
    { data: connData },
    { data: gbpData },
    { data: gbpPrevData },
    { data: ahrefsData },
    { data: ahrefsKwDates },
    { data: rankData },
    { data: rankHistData },
  ] = await Promise.all([
    db.from('client_connections')
      .select('id, connector:connectors(type)')
      .eq('client_id', client.id)
      .eq('status', 'active'),
    db.from('gbp_metrics')
      .select(GBP_COLS)
      .eq('client_id', client.id)
      .gte('date', iso(fromDate))
      .lte('date', iso(toDate))
      .order('date', { ascending: true })
      .limit(2000),
    showCompare && compFrom && compTo
      ? db.from('gbp_metrics')
          .select(GBP_COLS)
          .eq('client_id', client.id)
          .gte('date', iso(compFrom))
          .lte('date', iso(compTo))
          .order('date', { ascending: true })
          .limit(2000)
      : Promise.resolve({ data: null }),
    db.from('ahrefs_metrics')
      .select('date, domain_rating, backlinks, referring_domains, organic_keywords, organic_traffic, traffic_value, new_backlinks, lost_backlinks, new_referring_domains, lost_referring_domains')
      .eq('client_id', client.id)
      .order('date', { ascending: false })
      .limit(10),
    db.from('ahrefs_keywords')
      .select('date')
      .eq('client_id', client.id)
      .order('date', { ascending: false })
      .limit(120),
    db.from('seo_keyword_current')
      .select('keyword, current_position, previous_position, position_delta, current_url, search_volume')
      .eq('client_id', client.id)
      .eq('is_tracked', true)
      .order('current_position', { ascending: true, nullsFirst: false })
      .limit(50),
    db.from('seo_rankings')
      .select('date, position')
      .eq('client_id', client.id)
      .gte('date', iso(fromDate))
      .lte('date', iso(toDate))
      .order('date', { ascending: true })
      .limit(2000),
  ])

  // Which connectors are live, and the Search Console connection to read from.
  type ConnRow = { id: string; connector: { type: string } | { type: string }[] | null }
  const connRows = (connData ?? []) as unknown as ConnRow[]
  const connectionIdFor = (type: string): string | null => {
    for (const c of connRows) {
      const conn  = c.connector
      const types = Array.isArray(conn) ? conn.map(x => x.type) : conn ? [conn.type] : []
      if (types.includes(type)) return c.id
    }
    return null
  }

  const gscConnectionId = connectionIdFor('google_search_console')
  const hasGbpConn      = connectionIdFor('google_business_profile') !== null
  const ahrefsRows      = (ahrefsData ?? []) as AhrefsMetricRow[]
  const hasAhrefs       = connectionIdFor('ahrefs') !== null || ahrefsRows.length > 0

  // Ahrefs keyword/page snapshots are stamped with the sync end date, which differs from
  // the weekly metric snapshot dates — resolve the two most recent DISTINCT ones.
  const kwSnapshotDates = Array.from(new Set(((ahrefsKwDates ?? []) as { date: string }[]).map(r => r.date)))
  const latestKwDate    = kwSnapshotDates[0] ?? null
  const prevKwDate      = kwSnapshotDates[1] ?? null

  // Phase 2 — the queries that needed an answer from phase 1.
  const [gscLive, { data: ahrefsKwData }, { data: ahrefsPageData }, { data: ahrefsPrevKwData }] = await Promise.all([
    gscConnectionId
      ? _getCachedGSCLive(
          gscConnectionId, iso(fromDate), iso(toDate),
          compFrom ? iso(compFrom) : null, compTo ? iso(compTo) : null, showCompare,
        )
      : Promise.resolve({ curr: null, comp: null }),
    latestKwDate
      ? db.from('ahrefs_keywords')
          .select('keyword, position, volume, traffic')
          .eq('client_id', client.id)
          .eq('date', latestKwDate)
          .order('traffic', { ascending: false })
          .limit(15)
      : Promise.resolve({ data: null }),
    latestKwDate
      ? db.from('ahrefs_pages')
          .select('url, organic_traffic, organic_keywords')
          .eq('client_id', client.id)
          .eq('date', latestKwDate)
          .order('organic_traffic', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null }),
    prevKwDate
      ? db.from('ahrefs_keywords')
          .select('keyword, position')
          .eq('client_id', client.id)
          .eq('date', prevKwDate)
      : Promise.resolve({ data: null }),
  ])

  // ── Search Console ─────────────────────────────────────────────────────────
  const gscCurr = gscLive.curr as GSCSummaryResult | null
  const gscComp = gscLive.comp as GSCSummaryResult | null

  const gscClicks      = gscCurr?.totals?.clicks      ?? 0
  const gscImpressions = gscCurr?.totals?.impressions ?? 0
  const gscCtr         = gscCurr?.totals?.ctr         ?? 0
  const gscPosition    = gscCurr?.totals?.position    ?? 0
  const gscHasData     = gscClicks > 0 || gscImpressions > 0

  const gscDaily: GscDailyPoint[] = (gscCurr?.daily ?? []).map(d => ({
    date: d.date, clicks: d.clicks, impressions: d.impressions,
    ctr: d.impressions > 0 ? d.clicks / d.impressions : 0,
  }))

  const dist = gscCurr?.distribution ?? { top3: 0, page1: 0, page2: 0, beyond: 0 }
  const distTotal = dist.top3 + dist.page1 + dist.page2 + dist.beyond

  const compQueryPos = new Map<string, number>()
  const compPagePos  = new Map<string, number>()
  for (const q of gscComp?.queries ?? []) if (q.query) compQueryPos.set(q.query, q.position)
  for (const p of gscComp?.pages   ?? []) if (p.page)  compPagePos.set(p.page, p.position)

  const topQueries = (gscCurr?.queries ?? []).map(q => ({
    query: q.query ?? '', clicks: q.clicks, impressions: q.impressions, ctr: q.ctr, position: q.position,
    positionDelta: showCompare && q.query && compQueryPos.has(q.query) ? q.position - compQueryPos.get(q.query)! : null,
  }))
  const topPages = (gscCurr?.pages ?? []).map(p => ({
    page: p.page ?? '', clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position,
    positionDelta: showCompare && p.page && compPagePos.has(p.page) ? p.position - compPagePos.get(p.page)! : undefined,
  }))

  // ── Business Profile ───────────────────────────────────────────────────────
  const gbpRows     = (gbpData     ?? []) as GbpRow[]
  const gbpPrevRows = (gbpPrevData ?? []) as GbpRow[]
  const gbp         = gbpTotals(gbpRows)
  const gbpPrev     = gbpTotals(gbpPrevRows)
  const gbpViews    = gbp.search + gbp.maps
  const gbpPrevViews = gbpPrev.search + gbpPrev.maps
  const gbpContacts  = gbp.calls + gbp.directions
  const gbpPrevContacts = gbpPrev.calls + gbpPrev.directions
  const hasGbpData   = gbpRows.length > 0

  // Daily series (summed across locations) for the chart and the headline sparkline.
  const gbpDailyMap = new Map<string, { views: number; contacts: number }>()
  for (const r of gbpRows) {
    const day = r.date.slice(0, 10)
    const ex  = gbpDailyMap.get(day) ?? { views: 0, contacts: 0 }
    ex.views    += (r.views_search ?? 0) + (r.views_maps ?? 0)
    ex.contacts += (r.call_clicks ?? 0) + (r.direction_clicks ?? 0)
    gbpDailyMap.set(day, ex)
  }
  const gbpDaily = Array.from(gbpDailyMap.entries()).sort(([a], [b]) => a.localeCompare(b))
  const gbpChart: DailyMetric[] = gbpDaily.map(([date, v]) => ({
    date, spend: v.views, conversions: v.contacts, clicks: 0, roas: 0,
  }))

  // Reviews: the most recent count/rating per location (rows arrive oldest first).
  const latestByLocation = new Map<string, { name: string; rating: number; count: number; views: number; calls: number; directions: number; website: number }>()
  for (const r of gbpRows) {
    const ex = latestByLocation.get(r.location_id) ?? {
      name: r.location_name ?? r.location_id, rating: 0, count: 0, views: 0, calls: 0, directions: 0, website: 0,
    }
    ex.name       = r.location_name ?? ex.name
    ex.rating     = r.reviews_avg_rating ?? ex.rating
    ex.count      = r.reviews_count ?? ex.count
    ex.views      += (r.views_search ?? 0) + (r.views_maps ?? 0)
    ex.calls      += r.call_clicks ?? 0
    ex.directions += r.direction_clicks ?? 0
    ex.website    += r.website_clicks ?? 0
    latestByLocation.set(r.location_id, ex)
  }
  const locations  = Array.from(latestByLocation.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.views - a.views)
  const rated      = locations.filter(l => l.rating > 0)
  const avgRating  = rated.length > 0 ? rated.reduce((s, l) => s + l.rating, 0) / rated.length : 0
  const reviewCount = locations.reduce((s, l) => s + l.count, 0)

  // ── Rank tracking ──────────────────────────────────────────────────────────
  const rankRows  = (rankData ?? []) as RankRow[]
  const ranked    = rankRows.filter(r => r.current_position !== null)
  const hasRanks  = rankRows.length > 0
  const inTop3    = ranked.filter(r => (r.current_position ?? 99) <= 3).length
  const onPage1   = ranked.filter(r => (r.current_position ?? 99) <= 10).length
  const avgRank   = ranked.length > 0 ? ranked.reduce((s, r) => s + (r.current_position ?? 0), 0) / ranked.length : 0
  const withPrev  = rankRows.filter(r => r.current_position !== null && r.previous_position !== null)
  const prevAvgRank = withPrev.length > 0 ? withPrev.reduce((s, r) => s + (r.previous_position ?? 0), 0) / withPrev.length : 0
  const gainers   = rankRows.filter(r => (r.position_delta ?? 0) > 0).sort((a, b) => (b.position_delta ?? 0) - (a.position_delta ?? 0)).slice(0, 4)
  const losers    = rankRows.filter(r => (r.position_delta ?? 0) < 0).sort((a, b) => (a.position_delta ?? 0) - (b.position_delta ?? 0)).slice(0, 4)
  const rankBands = [
    { label: 'Top 3',          value: ranked.filter(r => (r.current_position ?? 99) <= 3).length,                                         tint: 'var(--green)' },
    { label: 'Positions 4–10', value: ranked.filter(r => (r.current_position ?? 99) > 3  && (r.current_position ?? 99) <= 10).length,     tint: 'var(--amber)' },
    { label: 'Page two',       value: ranked.filter(r => (r.current_position ?? 99) > 10 && (r.current_position ?? 99) <= 20).length,     tint: 'var(--blue)' },
    { label: 'Beyond page two', value: rankRows.length - ranked.filter(r => (r.current_position ?? 99) <= 20).length,                     tint: 'var(--text-faint)' },
  ]

  const rankHistMap = new Map<string, { sum: number; n: number }>()
  for (const r of (rankHistData ?? []) as { date: string; position: number | null }[]) {
    if (r.position === null) continue
    const day = r.date.slice(0, 10)
    const ex  = rankHistMap.get(day) ?? { sum: 0, n: 0 }
    ex.sum += r.position; ex.n += 1
    rankHistMap.set(day, ex)
  }
  const rankHistory = Array.from(rankHistMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, avg: v.sum / v.n }))

  // ── Authority (Ahrefs) ─────────────────────────────────────────────────────
  const ahLatest = ahrefsRows[0]
  const ahPrev   = ahrefsRows[1]
  const ahTrend  = ahrefsRows.slice(0, 8).reverse()
  const spark    = (pick: (r: AhrefsMetricRow) => number | null) => ahTrend.map(r => ({ v: pick(r) ?? 0 }))

  const ahKeywords = (ahrefsKwData   ?? []) as { keyword: string; position: number | null; volume: number | null; traffic: number | null }[]
  const ahPages    = (ahrefsPageData ?? []) as { url: string; organic_traffic: number | null; organic_keywords: number | null }[]
  const ahPrevKwPos = new Map<string, number>(
    ((ahrefsPrevKwData ?? []) as { keyword: string; position: number | null }[])
      .map(r => [r.keyword, r.position ?? 999] as [string, number])
  )
  const hasAhrefsData = !!ahLatest

  // ── Headline row ───────────────────────────────────────────────────────────
  interface Headline { label: string; value: string; sub: string; delta?: number; invert?: boolean; spark?: { v: number }[]; color: string }
  const headline: Headline[] = []

  if (hasAhrefsData && ahLatest.organic_traffic != null) {
    headline.push({
      label: 'Visitors from search',
      value: fmtNum(ahLatest.organic_traffic),
      sub:   'people arriving each month without an ad',
      delta: ahPrev?.organic_traffic != null ? pctDelta(ahLatest.organic_traffic, ahPrev.organic_traffic) : undefined,
      spark: spark(r => r.organic_traffic),
      color: 'var(--seo-local)',
    })
  }
  if (gscHasData) {
    headline.push({
      label: 'Clicks from search results',
      value: fmtNum(gscClicks),
      sub:   'people who picked your listing on Google',
      delta: showCompare ? pctDelta(gscClicks, gscComp?.totals?.clicks ?? 0) : undefined,
      spark: gscDaily.map(d => ({ v: d.clicks })),
      color: 'var(--seo-search)',
    })
    headline.push({
      label: 'Times you appeared',
      value: fmtNum(gscImpressions),
      sub:   `shown in search results · ${fmtPct(gscCtr)} of them clicked`,
      delta: showCompare ? pctDelta(gscImpressions, gscComp?.totals?.impressions ?? 0) : undefined,
      spark: gscDaily.map(d => ({ v: d.impressions })),
      color: 'var(--seo-search-soft)',
    })
    headline.push({
      label:  'Average position',
      value:  fmtPos(gscPosition),
      sub:    'where you sit on the results page',
      delta:  showCompare ? pctDelta(gscPosition, gscComp?.totals?.position ?? 0) : undefined,
      invert: true,
      color:  'var(--seo-neutral)',
    })
  } else if (hasRanks && avgRank > 0) {
    headline.push({
      label:  'Average position',
      value:  fmtPos(avgRank),
      sub:    `across the ${rankRows.length} search term${rankRows.length === 1 ? '' : 's'} we track`,
      delta:  prevAvgRank > 0 ? pctDelta(avgRank, prevAvgRank) : undefined,
      invert: true,
      color:  'var(--seo-neutral)',
    })
  }
  if (hasGbpData) {
    headline.push({
      label: 'Calls & directions',
      value: fmtNum(gbpContacts),
      sub:   `${fmtNum(gbp.calls)} calls · ${fmtNum(gbp.directions)} direction requests`,
      delta: showCompare ? pctDelta(gbpContacts, gbpPrevContacts) : undefined,
      spark: gbpDaily.map(([, v]) => ({ v: v.contacts })),
      color: 'var(--seo-local)',
    })
  }

  const nothingConnected = !gscConnectionId && !hasGbpConn && !hasAhrefs && !hasRanks
  const mapsUrl = client.local_dominator_url ?? null

  // ── render ─────────────────────────────────────────────────────────────────

  if (nothingConnected) {
    return (
      <div className="seo-report min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <PageHeader title="SEO" accent="var(--seo-search)" fromDate={fromDate} toDate={toDate} compare={compare} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <EmptyState
            title="Your search reporting isn't switched on yet"
            description="This page will show the searches that bring people to your website, how often you turn up on Google Maps, and where you rank for the terms that matter to your business. Ask your account manager to switch it on."
            icon={<MagnifyingGlass size={22} />}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="seo-report min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <PageHeader title="SEO" accent="var(--seo-search)" fromDate={fromDate} toDate={toDate} compare={compare} />

      <main className="max-w-7xl mx-auto px-6 py-6 seo-page">

        {/* ── Headline: is our search presence growing? ─────────────────── */}
        {headline.length > 0 && (
          <section className="seo-section">
            <SectionHead
              icon={<ChartLineUp size={17} weight="duotone" />}
              tint="var(--blue)" tintBg="var(--blue-subtle)"
              title="Your search presence"
              desc={showCompare
                ? `How people are finding you, ${fmtDay(iso(fromDate))} – ${fmtDay(iso(toDate))}, against ${compare === 'last_year' ? 'the same dates last year' : 'the period before'}`
                : `How people are finding you, ${fmtDay(iso(fromDate))} – ${fmtDay(iso(toDate))}`}
            />
            <div className="stat-grid stat-grid--wide">
              {headline.map((h, i) => (
                <SparkMetricCard
                  key={h.label}
                  label={h.label}
                  value={h.value}
                  sub={h.sub}
                  delta={h.delta}
                  invertDelta={h.invert}
                  sparkData={h.spark}
                  sparkColor={h.color}
                  delay={i}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Search results (Search Console) ───────────────────────────── */}
        <section className="seo-section">
          <SectionHead
            icon={<MagnifyingGlass size={17} weight="duotone" />}
            tint="var(--blue)" tintBg="var(--blue-subtle)"
            title="Search results"
            desc="What people typed into Google, and what they clicked"
          />

          {!gscConnectionId ? (
            <EmptyState
              title="Your website isn't linked to Google Search yet"
              description="Once it's linked you'll see the searches that bring people to your website, how often you appear, and which pages they land on. Ask your account manager to link it."
              icon={<MagnifyingGlass size={22} />}
            />
          ) : !gscHasData ? (
            <EmptyState
              title="No searches recorded for these dates"
              description="Google reports search activity a few days behind, so very recent dates can look empty. Try a wider date range."
              icon={<MagnifyingGlass size={22} />}
            />
          ) : (
            <>
              <div className="seo-split seo-split--aside">
                <section className="card seo-panel">
                  <div className="seo-panel__head">
                    <h3 className="section-title">Clicks and appearances</h3>
                    <p className="section-desc">Clicks (bars) against how often you were shown (line)</p>
                  </div>
                  <div className="seo-panel__body">
                    {gscDaily.length > 1 ? (
                      <GscTrendChart
                        data={gscDaily}
                        colorClicks="var(--seo-search-soft)"
                        colorImpressions="var(--seo-neutral)"
                      />
                    ) : (
                      <p className="seo-note">Not enough days in this range to draw a trend.</p>
                    )}
                  </div>
                </section>

                <Panel title="Where you rank" desc={`${fmtNum(distTotal)} searches you appeared for`}>
                  {distTotal > 0 ? (
                    <div className="seo-bars">
                      <Bar label="Top 3"           value={dist.top3}   total={distTotal} tint="var(--green)" />
                      <Bar label="Positions 4–10"  value={dist.page1}  total={distTotal} tint="var(--amber)" />
                      <Bar label="Page two"        value={dist.page2}  total={distTotal} tint="var(--blue)" />
                      <Bar label="Beyond page two" value={dist.beyond} total={distTotal} tint="var(--text-faint)" />
                    </div>
                  ) : (
                    <p className="seo-note">No positions recorded for these dates.</p>
                  )}
                </Panel>
              </div>

              <div className="seo-split">
                {topQueries.length > 0 && (
                  <Panel title="What people searched for" desc={`Top ${topQueries.length} searches by clicks · tap a heading to sort`} flush>
                    <div className="table-scroll">
                      <GscQueriesTable rows={topQueries} showCompare={showCompare} />
                    </div>
                  </Panel>
                )}
                {topPages.length > 0 && (
                  <Panel title="Pages people landed on" desc={`Top ${topPages.length} pages by clicks · tap a heading to sort`} flush>
                    <div className="table-scroll">
                      <GscPagesTable rows={topPages} showCompare={showCompare} />
                    </div>
                  </Panel>
                )}
              </div>
            </>
          )}
        </section>

        {/* ── Local visibility (Business Profile) ───────────────────────── */}
        <section className="seo-section">
          <SectionHead
            icon={<Storefront size={17} weight="duotone" />}
            tint="var(--green)" tintBg="var(--green-subtle)"
            title="Your listing on Google"
            desc="How many people found your business on Google Search and Maps — and got in touch"
            meta={avgRating > 0
              ? <span className="seo-rating-chip"><Stars rating={avgRating} /> {avgRating.toFixed(1)} · {fmtNum(reviewCount)} reviews</span>
              : undefined}
          />

          {!hasGbpConn ? (
            <EmptyState
              title="Your Google business listing isn't connected yet"
              description="Once it's connected you'll see how many people found you on Google Maps, and how many of them called, asked for directions or visited your website. Ask your account manager to connect it."
              icon={<Storefront size={22} />}
            />
          ) : !hasGbpData ? (
            <EmptyState
              title="No listing activity recorded for these dates"
              description="Google reports listing activity a few days behind. Try a wider date range to see how your listing is doing."
              icon={<Storefront size={22} />}
            />
          ) : (
            <>
              <div className="stat-grid stat-grid--wide">
                <SparkMetricCard
                  label="People who saw your listing"
                  value={fmtNum(gbpViews)}
                  sub={`${fmtNum(gbp.search)} on Search · ${fmtNum(gbp.maps)} on Maps`}
                  delta={showCompare ? pctDelta(gbpViews, gbpPrevViews) : undefined}
                  sparkData={gbpDaily.map(([, v]) => ({ v: v.views }))}
                  sparkColor="var(--seo-search)"
                  delay={0}
                />
                <SparkMetricCard
                  label="Calls"
                  value={fmtNum(gbp.calls)}
                  sub="tapped the phone number on your listing"
                  delta={showCompare ? pctDelta(gbp.calls, gbpPrev.calls) : undefined}
                  delay={1}
                />
                <SparkMetricCard
                  label="Direction requests"
                  value={fmtNum(gbp.directions)}
                  sub="asked Google how to get to you"
                  delta={showCompare ? pctDelta(gbp.directions, gbpPrev.directions) : undefined}
                  delay={2}
                />
                <SparkMetricCard
                  label="Website visits"
                  value={fmtNum(gbp.website)}
                  sub="came to your site from the listing"
                  delta={showCompare ? pctDelta(gbp.website, gbpPrev.website) : undefined}
                  delay={3}
                />
              </div>

              <div className="seo-split seo-split--aside">
                <section className="card seo-panel">
                  <div className="seo-panel__head">
                    <h3 className="section-title">Listing views and contacts</h3>
                    <p className="section-desc">Views of your listing (bars) against calls and direction requests (line)</p>
                  </div>
                  <div className="seo-panel__body">
                    <SpendChart
                      data={gbpChart}
                      variant="count"
                      spendLabel="Listing views"
                      conversionsLabel="Calls & directions"
                      colorSpend="var(--seo-search-soft)"
                      colorConversions="var(--seo-local)"
                    />
                  </div>
                </section>

                <Panel title="Where people found you" desc="Google Search results versus the map">
                  <div className="seo-bars">
                    <Bar label="Google Search" value={gbp.search} total={gbpViews} tint="var(--blue)" />
                    <Bar label="Google Maps"   value={gbp.maps}   total={gbpViews} tint="var(--green)" />
                  </div>

                  {avgRating > 0 && (
                    <div className="seo-reviews">
                      <div>
                        <p className="metric-label">Your reviews</p>
                        <div className="seo-reviews__line">
                          <span className="seo-reviews__score">{avgRating.toFixed(1)}</span>
                          <Stars rating={avgRating} />
                        </div>
                        <p className="seo-note">{fmtNum(reviewCount)} review{reviewCount === 1 ? '' : 's'} across {locations.length} location{locations.length === 1 ? '' : 's'}</p>
                      </div>
                    </div>
                  )}
                </Panel>
              </div>

              {locations.length > 1 && (
                <Panel title="Your locations" desc={`${locations.length} listings`} flush>
                  <div className="table-scroll">
                    <table className="data-table" style={{ minWidth: 560 }}>
                      <thead>
                        <tr>
                          <th>Location</th>
                          <th style={{ textAlign: 'right' }}>Views</th>
                          <th style={{ textAlign: 'right' }}>Calls</th>
                          <th style={{ textAlign: 'right' }}>Directions</th>
                          <th style={{ textAlign: 'right' }}>Website</th>
                          <th style={{ textAlign: 'right' }}>Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {locations.map(loc => (
                          <tr key={loc.id}>
                            <td style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{loc.name}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(loc.views)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(loc.calls)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(loc.directions)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(loc.website)}</td>
                            <td style={{ textAlign: 'right' }}>
                              {loc.rating > 0
                                ? <span style={{ color: 'var(--amber)', fontWeight: 600 }}>{loc.rating.toFixed(1)} ★</span>
                                : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}
            </>
          )}

          {/* Map grid — only when the client has one set up. */}
          {mapsUrl && (
            <section className="card seo-panel">
              <div className="seo-panel__head">
                <h3 className="section-title">Where you rank on the map</h3>
                <p className="section-desc">Your position across your service area for each search term we track</p>
              </div>
              <iframe
                src={mapsUrl}
                title="Map rankings"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="seo-embed"
              />
            </section>
          )}

          {/* No map grid set up: say what it would show rather than leave a gap. */}
          {!mapsUrl && hasGbpData && (
            <p className="seo-note seo-footnote">
              <MapTrifold size={14} weight="duotone" aria-hidden />
              Want to see where you rank on the map right across your service area? Ask your account manager about map rank tracking.
            </p>
          )}
        </section>

        {/* ── Tracked search terms (DataForSEO) ─────────────────────────── */}
        {hasRanks && (
          <section className="seo-section">
            <SectionHead
              icon={<ChartLineUp size={17} weight="duotone" />}
              tint="var(--text-secondary)" tintBg="var(--bg-subtle)"
              title="Search terms we're working on"
              desc="Where your site ranks on Google for the terms we target, and how those positions are moving"
            />

            <div className="stat-grid">
              <div className="card seo-stat">
                <p className="metric-label">Terms tracked</p>
                <p className="metric-row__value">{fmtNum(rankRows.length)}</p>
              </div>
              <div className="card seo-stat">
                <p className="metric-label">In the top 3</p>
                <p className="metric-row__value" style={inTop3 > 0 ? { color: 'var(--green)' } : undefined}>{fmtNum(inTop3)}</p>
              </div>
              <div className="card seo-stat">
                <p className="metric-label">On page one</p>
                <p className="metric-row__value">{fmtNum(onPage1)}</p>
              </div>
              <div className="card seo-stat">
                <p className="metric-label">Average position</p>
                <p className="metric-row__value">{avgRank > 0 ? fmtPos(avgRank) : '—'}</p>
                {prevAvgRank > 0 && Math.abs(prevAvgRank - avgRank) >= 0.05 && (
                  <p className="seo-move" style={{ color: avgRank < prevAvgRank ? 'var(--green)' : 'var(--red)' }}>
                    {avgRank < prevAvgRank ? '▲' : '▼'} {Math.abs(prevAvgRank - avgRank).toFixed(1)} since the last check
                  </p>
                )}
              </div>
            </div>

            <div className="seo-split seo-split--aside">
              <Panel title="Your tracked terms" desc={ranked.length === rankRows.length ? 'Position on Google today' : `${ranked.length} of ${rankRows.length} currently ranking`} flush>
                <div className="table-scroll">
                  {/* Phones drop the volume column rather than pushing the change off-screen. */}
                  <table className="data-table seo-table--tight" style={{ minWidth: 340 }}>
                    <thead>
                      <tr>
                        <th>Search term</th>
                        <th style={{ textAlign: 'center' }}>Position</th>
                        <th style={{ textAlign: 'center' }}>Change</th>
                        <th className="hide-sm" style={{ textAlign: 'right' }}>Searches / month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankRows.map(r => (
                        <tr key={r.keyword}>
                          <td className="seo-cell-term" style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                            <span className="block truncate" title={r.current_url ? `${r.keyword} — ${pathOf(r.current_url)}` : r.keyword}>{r.keyword}</span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {r.current_position !== null
                              ? <span className={positionClass(r.current_position)}>{r.current_position}</span>
                              : <span style={{ color: 'var(--text-faint)' }}>Not yet</span>}
                          </td>
                          <td style={{ textAlign: 'center' }}><Move delta={r.position_delta} /></td>
                          <td className="hide-sm" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                            {r.search_volume != null ? fmtNum(r.search_volume) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="How the tracked terms sit" desc="Across all terms we're working on">
                <div className="seo-bars">
                  {rankBands.map(b => (
                    <Bar key={b.label} label={b.label} value={b.value} total={rankRows.length} tint={b.tint} />
                  ))}
                </div>
              </Panel>
            </div>

            {(rankHistory.length > 1 || gainers.length > 0 || losers.length > 0) && (
              <div className="seo-split">
                {rankHistory.length > 1 && (
                  <Panel title="Average position over time" desc="All tracked terms combined">
                    <PositionTrend points={rankHistory} />
                  </Panel>
                )}
                {(gainers.length > 0 || losers.length > 0) && (
                  <Panel title="Biggest moves" desc="Since the previous check">
                    <div className="seo-movers">
                      {gainers.map(g => (
                        <div key={`up-${g.keyword}`} className="seo-mover">
                          <span className="seo-mover__kw" title={g.keyword}>{g.keyword}</span>
                          <span className="seo-mover__right">
                            <Move delta={g.position_delta} />
                            <span className={positionClass(g.current_position ?? 99)}>{g.current_position}</span>
                          </span>
                        </div>
                      ))}
                      {losers.map(l => (
                        <div key={`down-${l.keyword}`} className="seo-mover">
                          <span className="seo-mover__kw" title={l.keyword}>{l.keyword}</span>
                          <span className="seo-mover__right">
                            <Move delta={l.position_delta} />
                            <span className={positionClass(l.current_position ?? 99)}>{l.current_position}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── Authority (Ahrefs) ────────────────────────────────────────── */}
        <section className="seo-section">
          <SectionHead
            icon={<LinkSimple size={17} weight="duotone" />}
            tint="var(--amber)" tintBg="var(--amber-subtle)"
            title="How strong your site looks to Google"
            desc="Traffic you earn without paying for it, and the other websites that vouch for you"
            meta={ahLatest ? <span className="seo-note">Measured {fmtDay(ahLatest.date)}</span> : undefined}
          />

          {!hasAhrefs || !hasAhrefsData ? (
            <EmptyState
              title="We're not measuring your site's authority yet"
              description="Once this is switched on you'll see how many people reach you through search each month, how strong Google considers your site, and which other websites link to you. Ask your account manager to switch it on."
              icon={<LinkSimple size={22} />}
            />
          ) : (
            <>
              <div className="stat-grid stat-grid--wide">
                <SparkMetricCard
                  label="Visitors from search"
                  value={ahLatest.organic_traffic != null ? fmtNum(ahLatest.organic_traffic) : '—'}
                  sub="people arriving each month without an ad"
                  delta={ahPrev?.organic_traffic != null && ahLatest.organic_traffic != null ? pctDelta(ahLatest.organic_traffic, ahPrev.organic_traffic) : undefined}
                  sparkData={spark(r => r.organic_traffic)}
                  sparkColor="var(--seo-local)"
                  delay={0}
                />
                <SparkMetricCard
                  label="Site strength"
                  value={ahLatest.domain_rating != null ? ahLatest.domain_rating.toFixed(1) : '—'}
                  sub="how Google weighs your site, 0 to 100"
                  delta={ahPrev?.domain_rating != null && ahLatest.domain_rating != null ? pctDelta(ahLatest.domain_rating, ahPrev.domain_rating) : undefined}
                  sparkData={spark(r => r.domain_rating)}
                  sparkColor="var(--seo-search)"
                  delay={1}
                />
                <SparkMetricCard
                  label="Links to your site"
                  value={ahLatest.backlinks != null ? fmtNum(ahLatest.backlinks) : '—'}
                  sub="from other websites"
                  delta={ahPrev?.backlinks != null && ahLatest.backlinks != null ? pctDelta(ahLatest.backlinks, ahPrev.backlinks) : undefined}
                  sparkData={spark(r => r.backlinks)}
                  sparkColor="var(--seo-search-soft)"
                  delay={2}
                />
                <SparkMetricCard
                  label="Sites linking to you"
                  value={ahLatest.referring_domains != null ? fmtNum(ahLatest.referring_domains) : '—'}
                  sub="how many different websites"
                  delta={ahPrev?.referring_domains != null && ahLatest.referring_domains != null ? pctDelta(ahLatest.referring_domains, ahPrev.referring_domains) : undefined}
                  sparkData={spark(r => r.referring_domains)}
                  sparkColor="var(--seo-neutral)"
                  delay={3}
                />
                {ahLatest.traffic_value != null && (
                  <SparkMetricCard
                    label="What that traffic is worth"
                    value={`$${fmtNum(ahLatest.traffic_value)}`}
                    sub="what you'd pay in ads for the same visitors"
                    delta={ahPrev?.traffic_value != null ? pctDelta(ahLatest.traffic_value, ahPrev.traffic_value) : undefined}
                    sparkData={spark(r => r.traffic_value)}
                    sparkColor="var(--seo-local)"
                    delay={4}
                  />
                )}
              </div>

              {(ahLatest.new_referring_domains != null || ahLatest.new_backlinks != null) && (
                <div className="card seo-velocity">
                  <p className="metric-label">New and lost links since the last measurement</p>
                  <div className="metric-row metric-row--dense">
                    {ahLatest.new_referring_domains != null && (
                      <div>
                        <p className="metric-label mb-1">New sites linking to you</p>
                        <p className="metric-row__value" style={{ color: 'var(--green)' }}>+{fmtNum(ahLatest.new_referring_domains)}</p>
                      </div>
                    )}
                    {ahLatest.lost_referring_domains != null && (
                      <div>
                        <p className="metric-label mb-1">Sites that dropped you</p>
                        <p className="metric-row__value" style={{ color: 'var(--red)' }}>−{fmtNum(ahLatest.lost_referring_domains)}</p>
                      </div>
                    )}
                    {ahLatest.new_backlinks != null && (
                      <div>
                        <p className="metric-label mb-1">New links</p>
                        <p className="metric-row__value" style={{ color: 'var(--green)' }}>+{fmtNum(ahLatest.new_backlinks)}</p>
                      </div>
                    )}
                    {ahLatest.lost_backlinks != null && (
                      <div>
                        <p className="metric-label mb-1">Lost links</p>
                        <p className="metric-row__value" style={{ color: 'var(--red)' }}>−{fmtNum(ahLatest.lost_backlinks)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(ahPages.length > 0 || ahKeywords.length > 0) && (
                <div className="seo-split">
                  {ahPages.length > 0 && (
                    <Panel title="Pages bringing in the most visitors" desc={latestKwDate ? `Measured ${fmtDay(latestKwDate)}` : undefined} flush>
                      <div className="table-scroll">
                        <table className="data-table" style={{ minWidth: 320 }}>
                          <thead>
                            <tr>
                              <th>Page</th>
                              <th style={{ textAlign: 'right' }}>Visitors / month</th>
                              <th className="hide-sm" style={{ textAlign: 'right' }}>Search terms</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ahPages.map(p => (
                              <tr key={p.url}>
                                <td style={{ maxWidth: 280 }}>
                                  <a href={p.url} target="_blank" rel="noopener noreferrer"
                                     className="hover:underline block truncate" style={{ color: 'var(--blue)' }} title={p.url}>
                                    {pathOf(p.url)}
                                  </a>
                                </td>
                                <td style={{ textAlign: 'right' }}>{p.organic_traffic != null ? fmtNum(p.organic_traffic) : '—'}</td>
                                <td className="hide-sm" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{p.organic_keywords != null ? fmtNum(p.organic_keywords) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Panel>
                  )}

                  {ahKeywords.length > 0 && (
                    <Panel title="Terms you already rank for" desc={prevKwDate ? `Change since ${fmtDay(prevKwDate)}` : 'Your best-performing search terms'} flush>
                      <div className="table-scroll">
                        <table className="data-table seo-table--tight" style={{ minWidth: 340 }}>
                          <thead>
                            <tr>
                              <th>Search term</th>
                              <th style={{ textAlign: 'center' }}>Position</th>
                              {prevKwDate && <th style={{ textAlign: 'center' }}>Change</th>}
                              <th className="hide-sm" style={{ textAlign: 'right' }}>Searches / month</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ahKeywords.map(k => {
                              const prev  = ahPrevKwPos.get(k.keyword)
                              const delta = prev != null && k.position != null ? prev - k.position : null
                              return (
                                <tr key={k.keyword}>
                                  <td className="seo-cell-term" style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                                    <span className="block truncate" title={k.keyword}>{k.keyword}</span>
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    {k.position != null
                                      ? <span className={positionClass(k.position)}>{k.position}</span>
                                      : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                                  </td>
                                  {prevKwDate && (
                                    <td style={{ textAlign: 'center' }}>
                                      {prev == null
                                        ? <span className="seo-move" style={{ color: 'var(--blue)' }}>New</span>
                                        : <Move delta={delta} />}
                                    </td>
                                  )}
                                  <td className="hide-sm" style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{k.volume != null ? fmtNum(k.volume) : '—'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </Panel>
                  )}
                </div>
              )}
            </>
          )}
        </section>

      </main>
    </div>
  )
}
