// ─────────────────────────────────────────────────────────────────────────────
// Client Overview — /dashboard/overview   (dashboard v2)
//
// The cross-channel answer to "how is my marketing doing?" for a local service business.
// It reads top to bottom: what happened (headline + KPIs) → which channels did it
// (performance table + lead mix) → what it cost day to day → what became work (funnel)
// and what moved → how the phones were handled → the longer trend → search & local.
//
// Visuals only: every figure comes from tables the sync already fills. Leads from organic,
// direct and referral traffic are GA4 conversions, because the CRM does not yet record where
// a contact came from. GA4's own paid channels are left out whenever ads are connected, so
// an ad lead is never counted twice.
//
// Opt-in per client via clients.dashboard_v2. The original Summary page (/dashboard) is
// untouched and still serves every client without the flag.
//
// Every section renders only when its source is connected AND has data for the window, so a
// client with only Google Ads sees a page about Google Ads rather than a wall of dashes.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { isDashboardV2 } from '@/lib/dashboardVersion'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveDashboardRange } from '@/lib/dateRange'
import { getAgencySettings } from '@/lib/agency-settings'
import { applyAdFuel, calcDelta, resolveMetaConversions, fmt$, fmtCurrency } from '@/lib/metrics'
import { fetchGSCLiveData } from '@/lib/gsc-live'
import type { GSCSummaryResult } from '@/lib/gsc-live'
import type { Client, ClientConnection, Connector, MetaAction, DailyMetric } from '@/lib/types'
import PageHeader from '@/components/dashboard/PageHeader'
import EmptyState from '@/components/dashboard/EmptyState'
import SparkMetricCard from '@/components/SparkMetricCard'
import Sparkline from '@/components/Sparkline'
import SpendChart from '@/components/SpendChart'
import { ConnectorLogo } from '@/components/ConnectorLogo'
import CostLeadsChart, { type CostLeadsDay } from './CostLeadsChart'
import WeeklyTrendChart, { type WeekPoint } from './WeeklyTrendChart'
import LeadMixDonut, { type MixSlice } from './LeadMixDonut'
import { addLeadSources, summariseLeadSources, LEAD_SOURCES, type LeadSourceCounts, type LeadSourceKey } from '@/lib/leadSources'
import AlertBody, { alertPlainText } from '@/components/admin/AlertBody'
import { PositionPill, RankChange } from '@/components/dashboard/KeywordRank'
import {
  Compass, MapPin, LinkSimple, MagnifyingGlass, CursorClick, UsersThree, EnvelopeSimple, Globe,
  TrendUp, TrendDown, Lightbulb, ArrowRight, CheckCircle, Star, CurrencyDollar, Megaphone, FileText, Prohibit, ShieldCheck, Sparkle, Info,
} from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

/** Row caps. Every query is bounded so one noisy account can't stall the page. */
const MAX_ROWS      = 10_000
const ROLLING_WEEKS = 12
/** Named GA4 channels shown in the table before the rest fold into "Other". */
const MAX_GA4_ROWS  = 4
/** GA4 channels that are ad traffic — dropped when the ad platforms report those leads directly. */
const PAID_GA4      = /^(Paid |Display$|Cross-network$)/

function iso(d: Date) { return d.toISOString().split('T')[0] }
function addDays(d: Date, days: number) { return new Date(d.getTime() + days * 86_400_000) }
function fmtInt(n: number) { return Math.round(n).toLocaleString('en-US') }
function fmtShortDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function fmtPct(n: number) { return `${n >= 100 ? Math.round(n) : n.toFixed(1)}%` }
/** Whole dollars for table cells, where cents on a month of spend are noise. */
function fmtWholeDollars(n: number) { return `$${Math.round(n).toLocaleString('en-US')}` }

/** Drop rows sharing a logical key — two connections to the same ad account double-count. */
function dedupeBy<T>(rows: T[], key: (r: T) => string): T[] {
  const seen = new Set<string>()
  return rows.filter(r => { const k = key(r); if (seen.has(k)) return false; seen.add(k); return true })
}

// ── row shapes ───────────────────────────────────────────────────────────────
type GoogleRow = {
  campaign_id: string; date: string; spend: number; clicks: number; conversions: number
  impressions?: number; search_impression_share?: number | null; search_top_impression_share?: number | null
}
type MetaAdRow = {
  ad_id: string; campaign_id: string; date: string; spend: number; clicks: number
  actions: MetaAction[] | null; action_values: MetaAction[] | null
}
type AssignRow = { campaign_id: string; display_mode: string; hidden: boolean }
type GhlRow    = {
  date: string; contacts_created: number; spam_leads: number; total_calls: number; incoming_calls: number
  missed_calls: number; forms_submitted: number; new_opportunities: number; won_opportunities: number; won_value: number
  /** raw_data->lead_sources: null on days synced before lead sources were recorded. */
  lead_sources?: LeadSourceCounts | null
}
type GbpRow    = {
  date: string; call_clicks: number; direction_clicks: number
  views_search?: number | null; views_maps?: number | null; website_clicks?: number | null
  location_id?: string | null; reviews_count?: number | null; reviews_avg_rating?: number | null
}
type Ga4Row    = { date: string; channel_group: string | null; sessions: number; conversions: number | null }
type AhrefsRow = { date: string; domain_rating: number | null; referring_domains: number | null }
type AdStrengthRow = { ad_id: string; ad_type: string | null; ad_status: string | null; ad_strength: string | null; date: string }
type PostRow       = { title: string | null; published_url: string | null; published_at: string | null }
type SiteRow       = { uptime_7d: number | string | null; ssl_days_remaining: number | null }
type UpdateRow     = { title: string | null; content: string | null; next_up: string | null; created_at: string }
type KeywordRow = {
  keyword: string; current_position: number | null; previous_position: number | null
  position_delta: number | null; search_volume: number | null
}

/** Calls Google Ads counted from its own ads (migration 218). */
type ReviewRow = { star_rating: number; created_at: string; reply_comment: string | null }

type AdCallRow = { phone_calls: number; calls_received: number; calls_missed: number; calls_from_ad: number }

interface Connected {
  google: boolean; meta: boolean; ghl: boolean; gbp: boolean; ga4: boolean; ahrefs: boolean
}

// ─── Data (cached 5 min, busted by revalidateTag('client-metrics') in the sync cron) ──
const _getOverviewData = unstable_cache(
  async (
    clientId: string,
    from: string, to: string,
    priorFrom: string, priorTo: string,
    rollingFrom: string,
    showCompare: boolean,
    has: Connected,
    ga4ConnectionId: string | null,
  ) => {
    const db = createAdminClient()
    const none = Promise.resolve({ data: [] as never[] })

    const GOOGLE_COLS = 'campaign_id,date,spend,clicks,conversions,impressions,search_impression_share,search_top_impression_share'
    const META_COLS   = 'ad_id,campaign_id,date,spend,clicks,actions,action_values'
    const GHL_COLS    = 'date,contacts_created,spam_leads,total_calls,incoming_calls,missed_calls,forms_submitted,new_opportunities,won_opportunities,won_value,lead_sources:raw_data->lead_sources'
    const GBP_COLS    = 'date,call_clicks,direction_clicks,views_search,views_maps,website_clicks,location_id,reviews_count,reviews_avg_rating'
    const GA4_COLS    = 'date,channel_group,sessions,conversions'

    const ga4Query = (a: string, b: string) => {
      const q = db.from('ga4_metrics').select(GA4_COLS)
        .eq('client_id', clientId).gte('date', a).lte('date', b).limit(MAX_ROWS)
      return ga4ConnectionId ? q.eq('connection_id', ga4ConnectionId) : q
    }

    const [
      gRes, gPriorRes, mRes, mPriorRes, gAssignRes, mAssignRes,
      ghlRes, ghlPriorRes, ghlRollRes, gbpRes, gbpPriorRes,
      ga4Res, ga4PriorRes, ahrefsRes, keywordsRes,
      adStrengthRes, negativesRes, postsRes, sitesRes, updatesRes, adCallsRes, reviewsRes,
      ratingRes,
    ] = await Promise.all([
      // Paged: .limit() can't lift the API's 1000-row cap, and campaigns x days passes it.
      has.google
        ? fetchAllRows((a, b) => db.from('google_ads_metrics').select(GOOGLE_COLS)
            .eq('client_id', clientId).gte('date', from).lte('date', to)
            .order('date').order('campaign_id').order('connection_id').range(a, b), { maxRows: MAX_ROWS * 5 }).then(data => ({ data }))
        : none,
      has.google && showCompare
        ? fetchAllRows((a, b) => db.from('google_ads_metrics').select(GOOGLE_COLS)
            .eq('client_id', clientId).gte('date', priorFrom).lte('date', priorTo)
            .order('date').order('campaign_id').order('connection_id').range(a, b), { maxRows: MAX_ROWS * 5 }).then(data => ({ data }))
        : none,

      // Meta spend and conversions both come from the ad-level table — campaign-level
      // meta_ads_metrics lags and must never be summed for totals.
      has.meta
        ? fetchAllRows((a, b) => db.from('meta_ads_ad_metrics').select(META_COLS)
            .eq('client_id', clientId).gte('date', from).lte('date', to)
            .order('id').range(a, b), { maxRows: MAX_ROWS * 5 }).then(data => ({ data }))
        : none,
      has.meta && showCompare
        ? fetchAllRows((a, b) => db.from('meta_ads_ad_metrics').select(META_COLS)
            .eq('client_id', clientId).gte('date', priorFrom).lte('date', priorTo)
            .order('id').range(a, b), { maxRows: MAX_ROWS * 5 }).then(data => ({ data }))
        : none,

      has.google
        ? db.from('client_campaign_assignments').select('campaign_id,display_mode,hidden')
            .eq('client_id', clientId).eq('source', 'google_ads').limit(1000)
        : none,
      has.meta
        ? db.from('client_campaign_assignments').select('campaign_id,display_mode,hidden')
            .eq('client_id', clientId).eq('source', 'meta_ads').limit(1000)
        : none,

      has.ghl
        ? db.from('ghl_metrics').select(GHL_COLS)
            .eq('client_id', clientId).gte('date', from).lte('date', to)
            .order('date', { ascending: true }).limit(MAX_ROWS)
        : none,
      has.ghl && showCompare
        ? db.from('ghl_metrics').select(GHL_COLS)
            .eq('client_id', clientId).gte('date', priorFrom).lte('date', priorTo).limit(MAX_ROWS)
        : none,
      // The rolling trend is deliberately a fixed 12-week window, not the picked range:
      // it exists to show the shape of the year so far behind whatever month is selected.
      has.ghl
        ? db.from('ghl_metrics').select(GHL_COLS)
            .eq('client_id', clientId).gte('date', rollingFrom).lte('date', to)
            .order('date', { ascending: true }).limit(MAX_ROWS)
        : none,

      has.gbp
        ? db.from('gbp_metrics').select(GBP_COLS)
            .eq('client_id', clientId).gte('date', from).lte('date', to).limit(MAX_ROWS)
        : none,
      has.gbp && showCompare
        ? db.from('gbp_metrics').select(GBP_COLS)
            .eq('client_id', clientId).gte('date', priorFrom).lte('date', priorTo).limit(MAX_ROWS)
        : none,

      has.ga4 ? ga4Query(from, to)                           : none,
      has.ga4 && showCompare ? ga4Query(priorFrom, priorTo) : none,

      // Ahrefs is a weekly snapshot, so the two most recent rows give value + movement.
      has.ahrefs
        ? db.from('ahrefs_metrics').select('date,domain_rating,referring_domains')
            .eq('client_id', clientId).order('date', { ascending: false }).limit(8)
        : none,

      // Tracked keyword positions from the rank tracker (a view over seo_rankings), this client only.
      db.from('seo_keyword_current')
        .select('keyword,current_position,previous_position,position_delta,search_volume')
        .eq('client_id', clientId).eq('is_tracked', true)
        .order('current_position', { ascending: true, nullsFirst: false }).limit(50),

      // Each Google ad's latest status and ad strength. 35 days before the range end holds every
      // live ad's latest row. Paged: ads x days passes the API's 1000-row limit.
      has.google
        ? fetchAllRows((a, b) => db.from('google_ads_ad_metrics')
            .select('ad_id,ad_type,ad_status,ad_strength,date')
            .eq('client_id', clientId)
            .gte('date', new Date(new Date(to + 'T00:00:00Z').getTime() - 35 * 86_400_000).toISOString().slice(0, 10))
            .lte('date', to)
            .order('date', { ascending: false }).order('id').range(a, b), { maxRows: 20_000 }).then(data => ({ data }))
        : none,
      // Searches we stop this client paying for (negative keywords currently in place).
      has.google
        ? db.from('google_ads_negative_keywords').select('id', { count: 'exact', head: true }).eq('client_id', clientId)
        : Promise.resolve({ count: 0 }),
      // Posts published on their website in this window. Public pages only: status published with
      // a live URL, so drafts, rejected posts and internal notes can never appear here.
      db.from('content_posts')
        .select('title,published_url,published_at')
        .eq('client_id', clientId).eq('status', 'published').not('published_url', 'is', null)
        .gte('published_at', from).lte('published_at', `${to}T23:59:59.999Z`)
        .order('published_at', { ascending: false }).limit(6),
      // Their website, which we monitor.
      db.from('sites').select('uptime_7d,ssl_days_remaining').eq('client_id', clientId).eq('status', 'active'),
      // "What we did" notes the team writes for this client: the ONLY note category a client ever
      // sees, and only these columns. No author, no other fields, never the encrypted secret.
      db.from('client_notes')
        .select('title,content,next_up:fields->>next_up,created_at')
        .eq('client_id', clientId).eq('category', 'client_update')
        .gte('created_at', new Date(new Date(to + 'T00:00:00Z').getTime() - 90 * 86_400_000).toISOString())
        .order('created_at', { ascending: false }).limit(3),
      // Calls from Google Ads. Only campaign-days with calls are stored, so this stays small; before
      // migration 218 the read fails quietly and nothing is shown.
      has.google
        ? db.from('google_ads_call_metrics').select('phone_calls,calls_received,calls_missed,calls_from_ad')
            .eq('client_id', clientId).gte('date', from).lte('date', to).limit(MAX_ROWS * 5)
        : none,

      // Reviews with their replies, for the reputation card. Newest first and capped, because the
      // card only needs the recent ones plus the reply rate; before migration 219 this read fails
      // quietly and the card stays hidden.
      has.gbp
        ? db.from('gbp_reviews').select('star_rating,created_at,reply_comment')
            .eq('client_id', clientId).order('created_at', { ascending: false }).limit(500)
        : none,

      // The listing's running total and average. It is written to the most recent synced day, which
      // a short date range usually doesn't contain — so this looks outside the range on purpose,
      // the same way the Reputation page does. Without it the rating reads "—".
      has.gbp
        ? db.from('gbp_metrics').select('reviews_count,reviews_avg_rating')
            .eq('client_id', clientId).gt('reviews_count', 0)
            .order('date', { ascending: false }).limit(1)
        : none,
    ])

    return {
      google:      (gRes.data       ?? []) as GoogleRow[],
      googlePrior: (gPriorRes.data  ?? []) as GoogleRow[],
      meta:        (mRes.data       ?? []) as unknown as MetaAdRow[],
      metaPrior:   (mPriorRes.data  ?? []) as unknown as MetaAdRow[],
      assignments: [
        ...((gAssignRes.data ?? []) as AssignRow[]),
        ...((mAssignRes.data ?? []) as AssignRow[]),
      ],
      ghl:         (ghlRes.data      ?? []) as GhlRow[],
      ghlPrior:    (ghlPriorRes.data ?? []) as GhlRow[],
      ghlRolling:  (ghlRollRes.data  ?? []) as GhlRow[],
      gbp:         (gbpRes.data      ?? []) as GbpRow[],
      gbpPrior:    (gbpPriorRes.data ?? []) as GbpRow[],
      ga4:         (ga4Res.data      ?? []) as Ga4Row[],
      ga4Prior:    (ga4PriorRes.data ?? []) as Ga4Row[],
      ahrefs:      (ahrefsRes.data   ?? []) as AhrefsRow[],
      keywords:    (keywordsRes.data ?? []) as KeywordRow[],
      adStrength:  (adStrengthRes.data ?? []) as AdStrengthRow[],
      negativeKeywordCount: (negativesRes as { count: number | null }).count ?? 0,
      posts:       (postsRes.data ?? []) as PostRow[],
      sites:       (sitesRes.data ?? []) as SiteRow[],
      updates:     (updatesRes.data ?? []) as unknown as UpdateRow[],
      adCalls:     (adCallsRes.data ?? []) as AdCallRow[],
      reviewRows:  (reviewsRes.data ?? []) as ReviewRow[],
      ratingNow:   ((ratingRes.data ?? [])[0] ?? null) as { reviews_count: number; reviews_avg_rating: number } | null,
    }
  },
  ['dashboard-overview-v11'],
  { revalidate: 300, tags: ['client-metrics'] },
)

// Search Console has no synced table — it is read live from the API, so it gets its
// own longer cache window (same as the SEO page).
const _getOverviewGSC = unstable_cache(
  async (connectionId: string, from: string, to: string, priorFrom: string | null, priorTo: string | null) => {
    const [curr, prior] = await Promise.all([
      fetchGSCLiveData(connectionId, from, to, 100),
      // The prior period keeps 500 searches so a search is only "new" when it genuinely wasn't there.
      priorFrom && priorTo ? fetchGSCLiveData(connectionId, priorFrom, priorTo, 500) : Promise.resolve(null),
    ])
    return { curr, prior }
  },
  ['dashboard-overview-gsc-v2'],
  { revalidate: 900, tags: ['client-metrics'] },
)

// ─── Page ────────────────────────────────────────────────────────────────────
/** Percent change beside a figure, shown only when a comparison is chosen. */
function DeltaPill({ value }: { value?: number }) {
  if (value === undefined || !isFinite(value)) return null
  return (
    <span className={`badge ${value >= 0 ? 'badge-green' : 'badge-red'}`}>
      {value >= 0 ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

export default async function OverviewPage({
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

  // This page ships behind the per-client flag; everyone else keeps the Summary page.
  if (!isDashboardV2(client, cookieStore)) redirect('/dashboard')

  const { fromDate, toDate } = resolveDashboardRange(params)
  // An overview is a comparison by nature — "is this better than last month?" — so it
  // opens on the previous period. Picking "No comparison" still turns the deltas off.
  const compare     = params.compare ?? 'prior_period'
  const showCompare = compare !== 'none'
  const compareNoun = compare === 'last_year' ? 'vs last year' : 'vs the previous period'

  const periodMs = toDate.getTime() - fromDate.getTime()
  let priorFrom: Date
  let priorTo:   Date
  if (compare === 'last_year') {
    priorFrom = new Date(fromDate); priorFrom.setFullYear(priorFrom.getFullYear() - 1)
    priorTo   = new Date(toDate);   priorTo.setFullYear(priorTo.getFullYear() - 1)
  } else {
    priorTo   = new Date(fromDate.getTime() - 86_400_000)
    priorFrom = new Date(priorTo.getTime() - periodMs)
  }
  // Snapped to midnight UTC: the default range end carries the current time of day, and a
  // fractional start would push days into the wrong week bucket below.
  const rollingFrom = new Date(iso(addDays(toDate, -(ROLLING_WEEKS * 7 - 1))) + 'T00:00:00Z')

  // Every calendar day in the window, so sparklines and the daily chart show quiet days as zero
  // instead of silently closing the gap.
  const allDays: string[] = []
  {
    const end = new Date(iso(toDate) + 'T00:00:00Z').getTime()
    for (let t = new Date(iso(fromDate) + 'T00:00:00Z').getTime(); t <= end && allDays.length < 400; t += 86_400_000) {
      allDays.push(iso(new Date(t)))
    }
  }

  const [settings, connectionsRes] = await Promise.all([
    getAgencySettings(),
    db.from('client_connections')
      .select('*, connector:connectors(id, type, label)')
      .eq('client_id', client.id)
      .eq('status', 'active'),
  ])

  const connections = (connectionsRes.data ?? []) as (ClientConnection & {
    connector: Pick<Connector, 'id' | 'type' | 'label'>
  })[]
  const hiddenTypes = new Set<string>(settings.hidden_connector_types ?? [])
  const isOn = (type: string) =>
    !hiddenTypes.has(type) && connections.some(c => c.connector.type === type)

  const has: Connected = {
    google: isOn('google_ads'),
    meta:   isOn('meta_ads'),
    ghl:    isOn('ghl'),
    gbp:    isOn('google_business_profile'),
    ga4:    isOn('google_analytics'),
    ahrefs: isOn('ahrefs'),
  }

  // A client can hold two GA4 connections (old + reconnected); summing both inflates
  // sessions, so the most recently synced one wins.
  const ga4ConnectionId = connections
    .filter(c => c.connector.type === 'google_analytics')
    .sort((a, b) => (b.last_synced_at ?? '').localeCompare(a.last_synced_at ?? ''))[0]?.id ?? null
  const gscConnectionId = hiddenTypes.has('google_search_console')
    ? null
    : connections.find(c => c.connector.type === 'google_search_console')?.id ?? null

  const [data, gsc] = await Promise.all([
    _getOverviewData(
      client.id,
      iso(fromDate), iso(toDate),
      iso(priorFrom), iso(priorTo),
      iso(rollingFrom),
      showCompare, has, ga4ConnectionId,
    ),
    gscConnectionId
      ? _getOverviewGSC(
          gscConnectionId,
          iso(fromDate), iso(toDate),
          showCompare ? iso(priorFrom) : null,
          showCompare ? iso(priorTo)   : null,
        )
      : Promise.resolve({ curr: null, prior: null }),
  ])

  // ── Ad spend is always shown the way the client is billed for it ───────────
  const rawMode   = cookieStore.get('admin_raw_mode')?.value === '1'
  const adFuelCut = rawMode ? 0 : (client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut ?? 0)
  const billed    = (raw: number) => (adFuelCut > 0 ? applyAdFuel(raw, adFuelCut) : raw)

  const assignmentMap = new Map(data.assignments.map(a => [a.campaign_id, a]))

  // ── Paid: Google ──────────────────────────────────────────────────────────
  type Paid = { spend: number; leads: number; clicks: number; byDate: Map<string, { spend: number; leads: number }> }
  const emptyPaid = (): Paid => ({ spend: 0, leads: 0, clicks: 0, byDate: new Map() })

  function sumGoogle(rows: GoogleRow[]): Paid {
    const out = emptyPaid()
    for (const r of dedupeBy(rows, r => `${r.campaign_id}_${r.date}`)) {
      if (assignmentMap.get(r.campaign_id)?.hidden) continue
      const spend = billed(Number(r.spend) || 0)
      const leads = Number(r.conversions) || 0
      out.spend  += spend
      out.leads  += leads
      out.clicks += Number(r.clicks) || 0
      const day = out.byDate.get(r.date) ?? { spend: 0, leads: 0 }
      day.spend += spend; day.leads += leads
      out.byDate.set(r.date, day)
    }
    return out
  }

  // ── Paid: Meta (ad-level only, conversions via resolveMetaConversions) ────
  function sumMeta(rows: MetaAdRow[]): Paid {
    const out = emptyPaid()
    for (const r of dedupeBy(rows, r => `${r.ad_id}_${r.date}`)) {
      const assignment = assignmentMap.get(String(r.campaign_id || ''))
      if (assignment?.hidden) continue
      const isEcom  = (assignment?.display_mode ?? 'lead_gen') === 'ecommerce'
      const primary = isEcom
        ? (client!.purchase_action ?? settings.default_purchase_action ?? 'purchase')
        : (client!.lead_action ?? settings.default_lead_action ?? 'onsite_conversion.lead_grouped')
      const fallback = isEcom
        ? (client!.purchase_action_fallback ?? settings.default_purchase_action_fallback ?? null)
        : (client!.lead_action_fallback ?? settings.default_lead_action_fallback ?? 'lead')
      const { conversions } = resolveMetaConversions(r.actions, r.action_values, primary, fallback)

      const spend = billed(Number(r.spend) || 0)
      out.spend  += spend
      out.leads  += conversions
      out.clicks += Number(r.clicks) || 0
      const day = out.byDate.get(r.date) ?? { spend: 0, leads: 0 }
      day.spend += spend; day.leads += conversions
      out.byDate.set(r.date, day)
    }
    return out
  }

  const google      = sumGoogle(data.google)
  const googlePrior = sumGoogle(data.googlePrior)
  const meta        = sumMeta(data.meta)
  const metaPrior   = sumMeta(data.metaPrior)

  const adSpend      = google.spend + meta.spend
  const adLeads      = google.leads + meta.leads
  const adSpendPrior = googlePrior.spend + metaPrior.spend
  const adLeadsPrior = googlePrior.leads + metaPrior.leads
  const adCpl        = adLeads      > 0 ? adSpend      / adLeads      : 0
  const adCplPrior   = adLeadsPrior > 0 ? adSpendPrior / adLeadsPrior : 0

  const hasGoogleData = google.spend > 0 || google.leads > 0
  // Calls straight from Google ads: the call reporting count when it's on, otherwise the phone_calls
  // metric. The CRM can't tie these callers to the ad, so they're shown beside the ad leads, not added in.
  const adCallCount = Math.max(
    data.adCalls.reduce((s, r) => s + (Number(r.phone_calls) || 0), 0),
    data.adCalls.reduce((s, r) => s + (Number(r.calls_from_ad) || 0), 0),
  )
  const hasMetaData   = meta.spend   > 0 || meta.leads   > 0
  const hasPaidData   = hasGoogleData || hasMetaData

  // ── CRM: who actually got in touch, and what became work ──────────────────
  type CrmDay = { leads: number; calls: number; forms: number; incoming: number; missed: number; won: number }
  function sumGhl(rows: GhlRow[]) {
    const t = { leads: 0, calls: 0, forms: 0, incoming: 0, missed: 0, newOpps: 0, won: 0, wonValue: 0 }
    const byDate = new Map<string, CrmDay>()
    for (const r of rows) {
      // Spam is excluded from lead counts — GHL's own reporting does the same.
      const l   = Math.max(0, (Number(r.contacts_created) || 0) - (Number(r.spam_leads) || 0))
      const c   = Number(r.total_calls)       || 0
      const f   = Number(r.forms_submitted)   || 0
      const inc = Number(r.incoming_calls)    || 0
      // missed_calls counts incoming calls nobody picked up (migration 114).
      const m   = Number(r.missed_calls)      || 0
      const w   = Number(r.won_opportunities) || 0
      t.leads += l; t.calls += c; t.forms += f; t.incoming += inc; t.missed += m
      t.newOpps  += Number(r.new_opportunities) || 0
      t.won      += w
      t.wonValue += Number(r.won_value) || 0
      const day = byDate.get(r.date) ?? { leads: 0, calls: 0, forms: 0, incoming: 0, missed: 0, won: 0 }
      day.leads += l; day.calls += c; day.forms += f; day.incoming += inc; day.missed += m; day.won += w
      byDate.set(r.date, day)
    }
    return { ...t, byDate }
  }

  const crm        = sumGhl(data.ghl)
  const crmPrior   = sumGhl(data.ghlPrior)
  const hasCrmData = data.ghl.length > 0 && (crm.leads > 0 || crm.calls > 0 || crm.forms > 0)

  // ── Lead sources: how each lead first found the business, from the CRM's own tracking ──
  const sourceCounts: LeadSourceCounts = {}
  const sourcesByDate = new Map<string, LeadSourceCounts>()
  let sourceDays = 0
  for (const r of data.ghl) {
    if (r.lead_sources && typeof r.lead_sources === 'object') {
      sourceDays++
      addLeadSources(sourceCounts, r.lead_sources)
      sourcesByDate.set(r.date, addLeadSources({}, r.lead_sources))
    }
  }
  const leadSources     = summariseLeadSources(sourceCounts)
  const hasLeadSources  = sourceDays > 0 && leadSources.total > 0
  // Only speak for the whole range when every day in it was counted.
  const sourcesComplete = hasLeadSources && sourceDays === data.ghl.length

  const crmDays = Array.from(crm.byDate.entries()).sort(([a], [b]) => a.localeCompare(b))
  const leadTrend: DailyMetric[] = crmDays.map(([date, v]) => ({
    date, spend: v.calls, conversions: v.forms, clicks: 0, roas: 0,
  }))

  // 12 weeks of leads, bucketed into 7-day weeks that end on the range end.
  const rolling = sumGhl(data.ghlRolling)
  const weekBuckets = new Map<string, { leads: number; calls: number; forms: number }>()
  for (const [date, v] of Array.from(rolling.byDate.entries())) {
    const offset = Math.floor((new Date(date + 'T00:00:00Z').getTime() - rollingFrom.getTime()) / 86_400_000)
    if (offset < 0) continue
    const weekStart = iso(addDays(rollingFrom, Math.floor(offset / 7) * 7))
    const bucket = weekBuckets.get(weekStart) ?? { leads: 0, calls: 0, forms: 0 }
    bucket.leads += v.leads; bucket.calls += v.calls; bucket.forms += v.forms
    weekBuckets.set(weekStart, bucket)
  }
  const weekly: WeekPoint[] = Array.from(weekBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({ week, label: fmtShortDate(week), ...v }))

  // ── Local: Business Profile ───────────────────────────────────────────────
  const sumGbp = (rows: GbpRow[]) => rows.reduce(
    (acc, r) => ({
      calls:      acc.calls      + (Number(r.call_clicks)      || 0),
      directions: acc.directions + (Number(r.direction_clicks) || 0),
      search:     acc.search     + (Number(r.views_search)     || 0),
      maps:       acc.maps       + (Number(r.views_maps)       || 0),
      website:    acc.website    + (Number(r.website_clicks)   || 0),
    }),
    { calls: 0, directions: 0, search: 0, maps: 0, website: 0 },
  )
  const gbp           = sumGbp(data.gbp)
  const gbpPrior      = sumGbp(data.gbpPrior)
  const gbpViews      = gbp.search + gbp.maps
  const gbpPriorViews = gbpPrior.search + gbpPrior.maps
  const hasGbpData    = data.gbp.length > 0 && (gbp.calls > 0 || gbp.directions > 0 || gbpViews > 0)
  // Listing views per day, for the trend line. Google reports the listing a few days behind, so the
  // last day with figures is named rather than letting the chart trail off to zero.
  const gbpDaily = Array.from(
    data.gbp.reduce((m, r) => {
      const views = (Number(r.views_search) || 0) + (Number(r.views_maps) || 0)
      return m.set(r.date, (m.get(r.date) ?? 0) + views)
    }, new Map<string, number>()),
  ).sort(([a], [b]) => a.localeCompare(b))
  const gbpLastDay = [...gbpDaily].reverse().find(([, v]) => v > 0)?.[0] ?? null

  // ── Website: GA4 by channel ───────────────────────────────────────────────
  // Rows with an empty channel_group are unattributed sessions GA4 itself leaves out
  // of Traffic Acquisition — including them would not reconcile with the GA4 UI.
  type Ga4Channel = { sessions: number; conversions: number; byDate: Map<string, number> }
  function sumGa4(rows: Ga4Row[]) {
    let sessions = 0
    const byChannel = new Map<string, Ga4Channel>()
    for (const r of rows) {
      if (!r.channel_group) continue
      const s    = Number(r.sessions)    || 0
      const conv = Number(r.conversions) || 0
      sessions += s
      const ch = byChannel.get(r.channel_group) ?? { sessions: 0, conversions: 0, byDate: new Map<string, number>() }
      ch.sessions    += s
      ch.conversions += conv
      ch.byDate.set(r.date, (ch.byDate.get(r.date) ?? 0) + conv)
      byChannel.set(r.channel_group, ch)
    }
    return { sessions, byChannel }
  }
  const ga4        = sumGa4(data.ga4)
  const ga4Prior   = sumGa4(data.ga4Prior)
  const hasGa4Data = ga4.sessions > 0

  // ── Search Console (live) + Ahrefs (weekly snapshot) ──────────────────────
  const gscCurr    = gsc.curr  as GSCSummaryResult | null
  const gscPrior   = gsc.prior as GSCSummaryResult | null
  const hasGscData = !!gscCurr && gscCurr.totals.impressions > 0

  // Each figure from the newest week that has it: Ahrefs' newest week often has a rating but no
  // link counts yet. A change only when a comparison is set.
  const ahrefsOf = (pick: (row: AhrefsRow) => number | null) => {
    const rows = data.ahrefs.filter(row => pick(row) != null)
    return {
      value: rows[0] ? pick(rows[0]) : null,
      delta: showCompare && rows[0] && rows[1] ? calcDelta(pick(rows[0])!, pick(rows[1])!) : undefined,
    }
  }
  const ahrefsDomains = ahrefsOf(row => row.referring_domains)
  const ahrefsRating  = ahrefsOf(row => row.domain_rating)
  const hasAhrefsData = ahrefsDomains.value != null || ahrefsRating.value != null

  // ── Deltas — only when a comparison is on, and only when there is a base ───
  const delta = (curr: number, prior: number) => (showCompare ? calcDelta(curr, prior) : undefined)

  const qs = new URLSearchParams({ from: iso(fromDate), to: iso(toDate) })
  if (compare !== 'none') qs.set('compare', compare)
  const link = (path: string) => `${path}?${qs.toString()}`

  const dayCount    = Math.max(1, Math.round(periodMs / 86_400_000) + 1)
  const periodLabel = dayCount === 1 ? 'today' : `the last ${dayCount} days`

  // Ahrefs is a standing snapshot rather than activity inside the window, so it alone is not
  // evidence that there is anything to report — otherwise a client who picks a range from
  // before they joined lands on a single lonely card with nothing to explain it.
  const noDataForWindow = !hasCrmData && !hasPaidData && !hasGbpData && !hasGa4Data && !hasGscData

  // ── Performance by channel ────────────────────────────────────────────────
  interface ChannelRow {
    key: string; name: string; icon: ReactNode; color: string
    /** A short line under the channel name, e.g. calls from the ad. */
    note?: string
    /** null = this channel is not paid for per click. */
    cost: number | null
    /** null = nothing counts visits for this channel, e.g. leads that arrived by phone. */
    visits: number | null
    leads: number
    trend: { v: number }[]
  }

  const GA4_LABEL: Record<string, string> = {
    'Organic Search': 'Organic search', 'Direct': 'Direct', 'Referral': 'Referral sites',
    'Organic Social': 'Organic social', 'Organic Maps': 'Google Maps', 'Organic Video': 'Organic video',
    'Organic Shopping': 'Organic shopping', 'Email': 'Email', 'Unassigned': 'Unassigned',
    'Paid Search': 'Paid search', 'Paid Social': 'Paid social',
    'AI Assistant': 'AI assistants',
  }
  const GA4_COLOR: Record<string, string> = {
    'Organic Search': 'var(--green)', 'Direct': 'var(--ov-violet)', 'Referral': 'var(--ov-teal)',
    'Organic Social': 'var(--amber)', 'Organic Maps': 'var(--ov-teal)', 'Email': 'var(--amber)',
    'Paid Search': 'var(--blue)', 'Paid Social': 'var(--ov-indigo)',
    'AI Assistant': 'var(--ov-indigo)',
  }
  const FALLBACK_COLORS = ['var(--ov-teal)', 'var(--amber)', 'var(--ov-violet)', 'var(--green)']
  const ga4Icon = (name: string): ReactNode => {
    if (name === 'Organic Search') return <MagnifyingGlass size={15} weight="bold" aria-hidden />
    if (name === 'Direct')         return <CursorClick size={15} weight="bold" aria-hidden />
    if (name === 'Referral')       return <LinkSimple size={15} weight="bold" aria-hidden />
    if (name === 'Organic Maps')   return <MapPin size={15} weight="bold" aria-hidden />
    if (name === 'Email')          return <EnvelopeSimple size={15} weight="bold" aria-hidden />
    if (name === 'AI Assistant')   return <Sparkle size={15} weight="bold" aria-hidden />
    if (/Social/.test(name))       return <UsersThree size={15} weight="bold" aria-hidden />
    return <Globe size={15} weight="bold" aria-hidden />
  }

  const channels: ChannelRow[] = []

  /** Google Analytics channel whose visits belong to a CRM lead source, where one matches. */
  const GA4_FOR_SOURCE: Partial<Record<LeadSourceKey, string>> = {
    organic_search: 'Organic Search', direct: 'Direct', referral: 'Referral',
    social: 'Organic Social', ai_assistant: 'AI Assistant',
  }
  const AD_SOURCE_KEYS: LeadSourceKey[] = ['google_ads', 'google_ads_call', 'meta_ads', 'meta_ads_call']
  const sourceLeads = (keys: LeadSourceKey[]) => keys.reduce((s, k) => s + (sourceCounts[k] ?? 0), 0)
  const crmLeadTrend = (keys: LeadSourceKey[]) => allDays.map(d => ({
    v: keys.reduce((s, k) => s + (sourcesByDate.get(d)?.[k] ?? 0), 0),
  }))
  const sourceIcon = (key: LeadSourceKey): ReactNode => {
    if (key === 'organic_search')  return <MagnifyingGlass size={15} weight="bold" aria-hidden />
    if (key === 'google_business') return <MapPin size={15} weight="fill" aria-hidden />
    if (key === 'ai_assistant')    return <Sparkle size={15} weight="bold" aria-hidden />
    if (key === 'social')          return <UsersThree size={15} weight="bold" aria-hidden />
    if (key === 'referral')        return <LinkSimple size={15} weight="bold" aria-hidden />
    if (key === 'direct')          return <CursorClick size={15} weight="bold" aria-hidden />
    return <Globe size={15} weight="bold" aria-hidden />
  }
  const groupColor: Record<string, string> = {
    paid: 'var(--blue)', organic: 'var(--green)', internal: 'var(--ov-violet)', untracked: 'var(--text-faint)',
  }

  if (hasLeadSources) {
    // The CRM knows who got in touch and where from, so the table counts leads — one per person, the
    // same number as the headline — instead of the conversions each platform reports for itself.
    const googleLeads = sourceLeads(['google_ads', 'google_ads_call'])
    const metaLeads   = sourceLeads(['meta_ads', 'meta_ads_call'])
    if (hasGoogleData || googleLeads > 0) {
      channels.push({
        key: 'google', name: 'Google Ads', color: 'var(--blue)',
        icon: <ConnectorLogo type="google_ads" size={16} aria-hidden />,
        cost: hasGoogleData ? google.spend : null,
        visits: hasGoogleData ? google.clicks : null,
        leads: googleLeads,
        note: adCallCount > 0 ? `+ ${fmtInt(adCallCount)} ${adCallCount === 1 ? 'call' : 'calls'} from the ad` : undefined,
        trend: crmLeadTrend(['google_ads', 'google_ads_call']),
      })
    }
    if (hasMetaData || metaLeads > 0) {
      channels.push({
        key: 'meta', name: 'Meta Ads', color: 'var(--ov-indigo)',
        icon: <ConnectorLogo type="meta_ads" size={16} aria-hidden />,
        cost: hasMetaData ? meta.spend : null,
        visits: hasMetaData ? meta.clicks : null,
        leads: metaLeads,
        trend: crmLeadTrend(['meta_ads', 'meta_ads_call']),
      })
    }
    LEAD_SOURCES
      .filter(s => !AD_SOURCE_KEYS.includes(s.key))
      .map(s => ({ ...s, count: sourceCounts[s.key] ?? 0 }))
      .filter(s => s.count > 0)
      .sort((a, b) => b.count - a.count)
      .forEach(s => {
        const ga4Name = GA4_FOR_SOURCE[s.key]
        channels.push({
          key: `crm:${s.key}`, name: s.label, icon: sourceIcon(s.key),
          color: groupColor[s.group] ?? 'var(--text-faint)',
          cost: null,
          visits: ga4Name ? (ga4.byChannel.get(ga4Name)?.sessions ?? null) : null,
          leads: s.count,
          trend: crmLeadTrend([s.key]),
        })
      })
  } else if (hasGoogleData) {
    channels.push({
      key: 'google', name: 'Google Ads', color: 'var(--blue)',
      icon: <ConnectorLogo type="google_ads" size={16} aria-hidden />,
      cost: google.spend, visits: google.clicks, leads: google.leads,
      note: adCallCount > 0 ? `+ ${fmtInt(adCallCount)} ${adCallCount === 1 ? 'call' : 'calls'} from the ad` : undefined,
      trend: allDays.map(d => ({ v: google.byDate.get(d)?.leads ?? 0 })),
    })
  }
  if (!hasLeadSources && hasMetaData) {
    channels.push({
      key: 'meta', name: 'Meta Ads', color: 'var(--ov-indigo)',
      icon: <ConnectorLogo type="meta_ads" size={16} aria-hidden />,
      cost: meta.spend, visits: meta.clicks, leads: meta.leads,
      trend: allDays.map(d => ({ v: meta.byDate.get(d)?.leads ?? 0 })),
    })
  }

  const excludedPaidGa4 = hasPaidData && Array.from(ga4.byChannel.keys()).some(n => PAID_GA4.test(n))
  const ga4Channels = Array.from(ga4.byChannel.entries())
    .filter(([name, v]) => v.sessions > 0 && !(hasPaidData && PAID_GA4.test(name)))
    .sort(([, a], [, b]) => b.conversions - a.conversions || b.sessions - a.sessions)
  if (!hasLeadSources) ga4Channels.slice(0, MAX_GA4_ROWS).forEach(([name, v], i) => {
    channels.push({
      key: `ga4:${name}`, name: GA4_LABEL[name] ?? name, icon: ga4Icon(name),
      color: GA4_COLOR[name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      cost: null, visits: v.sessions, leads: v.conversions,
      trend: allDays.map(d => ({ v: v.byDate.get(d) ?? 0 })),
    })
  })
  const otherGa4 = ga4Channels.slice(MAX_GA4_ROWS)
  if (!hasLeadSources && otherGa4.length > 0) {
    channels.push({
      key: 'ga4:other', name: 'Other', color: 'var(--text-faint)', icon: <Globe size={15} weight="bold" aria-hidden />,
      cost: null,
      visits: otherGa4.reduce((s, [, v]) => s + v.sessions, 0),
      leads:  otherGa4.reduce((s, [, v]) => s + v.conversions, 0),
      trend:  allDays.map(d => ({ v: otherGa4.reduce((s, [, v]) => s + (v.byDate.get(d) ?? 0), 0) })),
    })
  }

  const totals = channels.reduce(
    (acc, c) => ({ cost: acc.cost + (c.cost ?? 0), visits: acc.visits + (c.visits ?? 0), leads: acc.leads + c.leads }),
    { cost: 0, visits: 0, leads: 0 },
  )
  const totalTrend = allDays.map((_, i) => ({ v: channels.reduce((s, c) => s + (c.trend[i]?.v ?? 0), 0) }))
  const showChannels = channels.length > 0 && (totals.leads > 0 || totals.visits > 0)
  const mixSlices: MixSlice[] = channels
    .filter(c => Math.round(c.leads) > 0)
    .map(c => ({ name: c.name, value: Math.round(c.leads), color: c.color }))
  const mixTotal = mixSlices.reduce((s, c) => s + c.value, 0)

  // Conversions are counted by each source, not by the CRM, so this table's total can be higher
  // than the lead count in the headline. Say so beside the numbers, not somewhere else.
  const channelFootnote = hasLeadSources ? [
    `Leads are the people ${settings.crm_name || 'your CRM'} recorded, counted once each, so this table adds up to the ${fmtInt(leadSources.total)} leads above.`,
    hasPaidData && adLeads > 0
      ? `Google and Meta reported ${fmtInt(adLeads)} conversions over the same days: a conversion counts an action, so one person can count more than once.`
      : '',
    !sourcesComplete ? 'Some days in this range were synced before sources were tracked, so a few leads are missing from the split.' : '',
    'Visits are ad clicks for the ad channels and website sessions where Google Analytics has a matching channel.',
  ].filter(Boolean).join(' ') : [
    hasPaidData && hasGa4Data
      ? 'Conversions are counted by each source: Google and Meta for ads, Google Analytics for everything else. They can add up to more than the leads your CRM recorded.'
      : hasPaidData
        ? 'Conversions are the ones Google and Meta report, so they can add up to more than the leads your CRM recorded.'
        : 'Conversions are the ones Google Analytics recorded, so they can differ from the leads your CRM recorded.',
    excludedPaidGa4 && "Google Analytics' own paid channels are left out so no ad conversion is counted twice.",
    'Visits are ad clicks for paid channels and website sessions for the rest.',
  ].filter(Boolean).join(' ')

  // ── Cost vs leads by day ──────────────────────────────────────────────────
  const lastCrmDate = crmDays.length > 0 ? crmDays[crmDays.length - 1][0] : null
  const costLeads: CostLeadsDay[] = allDays.map(d => ({
    date:   d,
    google: google.byDate.get(d)?.spend ?? 0,
    meta:   meta.byDate.get(d)?.spend ?? 0,
    // Days after the CRM's last synced day have no figure yet: a gap reads truer than a drop to zero.
    leads:  hasCrmData
      ? (lastCrmDate && d > lastCrmDate ? null : (crm.byDate.get(d)?.leads ?? 0))
      : (google.byDate.get(d)?.leads ?? 0) + (meta.byDate.get(d)?.leads ?? 0),
  }))

  // ── From lead to job ──────────────────────────────────────────────────────
  // Shown whenever leads came in. With no jobs marked won, the card nudges the client to mark them:
  // the CRM is the only place we can learn which leads turned into work.
  const showFunnel = hasCrmData && crm.leads > 0
  const crmLabel   = settings.crm_name || 'your CRM'
  const funnel = [
    { label: 'Leads', value: crm.leads, tone: 'blue' },
    ...(crm.newOpps > 0 ? [{ label: 'Opportunities', value: crm.newOpps, tone: 'violet' }] : []),
    { label: 'Jobs won', value: crm.won, tone: 'green' },
  ]

  // ── Phones ────────────────────────────────────────────────────────────────
  const showCalls       = hasCrmData && crm.incoming > 0
  const answered        = Math.max(0, crm.incoming - crm.missed)
  const answerRate      = crm.incoming > 0 ? answered / crm.incoming : 0
  const answerRatePrior = crmPrior.incoming > 0 ? Math.max(0, crmPrior.incoming - crmPrior.missed) / crmPrior.incoming : null
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const byWeekday = WEEKDAYS.map(() => ({ answered: 0, missed: 0 }))
  for (const [date, v] of crmDays) {
    const dow = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7
    byWeekday[dow].answered += Math.max(0, v.incoming - v.missed)
    byWeekday[dow].missed   += v.missed
  }
  const weekdayMax = Math.max(1, ...byWeekday.map(d => Math.max(d.answered, d.missed)))

  /** A small "▲ 4% vs the previous period" line for the big-number tiles. */
  const tileDelta = (cur: number, prior: number | null, opts: { lowerIsBetter?: boolean; points?: boolean } = {}) => {
    if (!showCompare || prior == null) return null
    const diff = opts.points ? (cur - prior) * 100 : prior > 0 ? ((cur - prior) / prior) * 100 : null
    if (diff == null || Math.abs(diff) < 0.5) return null
    const up   = diff > 0
    const good = opts.lowerIsBetter ? !up : up
    return (
      <span className={`ov2-bigstat__delta ov2-tone--${good ? 'good' : 'bad'}`}>
        {up ? <TrendUp size={12} weight="bold" aria-hidden /> : <TrendDown size={12} weight="bold" aria-hidden />}
        {opts.points ? `${Math.abs(diff).toFixed(1)} pts` : fmtPct(Math.abs(diff))} {compareNoun}
      </span>
    )
  }

  // ── What changed ──────────────────────────────────────────────────────────
  type Change = { key: string; kind: 'up' | 'down' | 'fact'; tone: 'good' | 'bad' | 'neutral'; text: string; detail: string; weight: number }
  const moves: Change[] = []
  const addMove = (key: string, noun: string, cur: number, prior: number, higherIsGood: boolean | null, fmt: (n: number) => string) => {
    if (!showCompare || prior <= 0) return
    const pct = ((cur - prior) / prior) * 100
    if (Math.abs(pct) < 5) return
    const up = pct > 0
    moves.push({
      key, kind: up ? 'up' : 'down',
      tone: higherIsGood == null ? 'neutral' : up === higherIsGood ? 'good' : 'bad',
      text: `${noun} ${up ? 'up' : 'down'} ${fmtPct(Math.abs(pct))}`,
      detail: `${fmt(cur)} vs ${fmt(prior)}`,
      weight: Math.abs(pct),
    })
  }
  if (hasCrmData) {
    addMove('leads', 'Leads', crm.leads, crmPrior.leads, true, fmtInt)
    addMove('calls', 'Phone calls', crm.calls, crmPrior.calls, true, fmtInt)
    addMove('forms', 'Web forms', crm.forms, crmPrior.forms, true, fmtInt)
    addMove('won', 'Jobs won', crm.won, crmPrior.won, true, fmtInt)
  }
  if (hasPaidData) {
    addMove('spend', 'Ad spend', adSpend, adSpendPrior, null, fmt$)
    if (adLeads > 0 && adLeadsPrior > 0) addMove('cpl', 'Cost per ad conversion', adCpl, adCplPrior, false, fmtCurrency)
  }
  const organicNow   = ga4.byChannel.get('Organic Search')
  const organicPrior = ga4Prior.byChannel.get('Organic Search')
  if (organicNow && organicPrior) {
    addMove('organic', 'Organic search leads', organicNow.conversions, organicPrior.conversions, true, fmtInt)
  }
  if (showCalls && answerRatePrior != null && showCompare) {
    const pts = (answerRate - answerRatePrior) * 100
    if (Math.abs(pts) >= 3) {
      moves.push({
        key: 'answer', kind: pts > 0 ? 'up' : 'down', tone: pts > 0 ? 'good' : 'bad',
        text: `Answer rate ${pts > 0 ? 'up' : 'down'} ${Math.abs(pts).toFixed(1)} pts`,
        detail: `${Math.round(answerRate * 100)}% vs ${Math.round(answerRatePrior * 100)}%`,
        weight: Math.abs(pts) * 2,
      })
    }
  }
  const changes: Change[] = moves.sort((a, b) => b.weight - a.weight).slice(0, 4)

  const paidWithLeads = channels.filter(c => c.cost != null && c.leads >= 1)
  if (paidWithLeads.length >= 2) {
    const best = paidWithLeads.reduce((a, b) => (a.cost! / a.leads <= b.cost! / b.leads ? a : b))
    changes.push({
      key: 'best-cpl', kind: 'fact', tone: 'neutral', weight: 0,
      text: `${best.name} had the lowest cost per lead`, detail: fmtCurrency(best.cost! / best.leads),
    })
  }
  const organicRow = channels.find(c => c.key === 'ga4:Organic Search')
  if (organicRow && totals.leads > 0 && organicRow.leads >= 1 && changes.length < 6) {
    changes.push({
      key: 'organic-share', kind: 'fact', tone: 'neutral', weight: 0,
      text: `Organic search brought ${Math.round((organicRow.leads / totals.leads) * 100)}% of conversions`,
      detail: `${fmtInt(organicRow.leads)} conversions`,
    })
  }

  // ── Keywords ──────────────────────────────────────────────────────────────
  // Two views of "are we being found for the right searches?": the terms the agency tracks (rank
  // tracker), and what people actually typed (Search Console).
  const tracked       = data.keywords
  const trackedRanked = tracked.filter(k => k.current_position != null)
  const inBand = (lo: number, hi: number) => trackedRanked.filter(k => k.current_position! > lo && k.current_position! <= hi).length
  const kwBands = [
    { label: 'Top 3',        value: inBand(0, 3),   tone: 'top' },
    { label: 'Page one',     value: inBand(3, 10),  tone: 'page1' },
    { label: 'Page two',     value: inBand(10, 20), tone: 'page2' },
    { label: 'Further back', value: tracked.length - inBand(0, 20), tone: 'rest' },
  ]
  const trackedShown = [...tracked]
    .sort((a, b) => (a.current_position ?? 999) - (b.current_position ?? 999))
    .slice(0, 6)
  const priorQueryPos = new Map((gscPrior?.queries ?? []).map(q => [q.query, q.position] as [string, number]))
  const topSearches = hasGscData && gscCurr
    ? gscCurr.queries.slice(0, 6).map(q => ({
        query: q.query, clicks: q.clicks, position: q.position,
        // undefined: no comparison. null: not searched in the comparison period.
        change: showCompare && gscPrior
          ? (priorQueryPos.has(q.query) ? priorQueryPos.get(q.query)! - q.position : null)
          : undefined,
      }))
    : []
  const showKeywords = tracked.length > 0 || topSearches.length > 0

  // ── Proof of progress ─────────────────────────────────────────────────────
  // A local business owner reads this page for one thing: is this working, and do these people
  // know what they're doing? So besides the results, surface the signals we control — how often
  // their ads show, how Google rates them, reviews, the work delivered — in plain words. Every
  // highlight below is picked only when it is actually true for the chosen dates.

  // Search coverage: impression-weighted share of eligible searches the ads appeared for.
  const searchCoverage = (rows: GoogleRow[]) => {
    let weight = 0, share = 0, topWeight = 0, top = 0
    for (const r of dedupeBy(rows, r => `${r.campaign_id}_${r.date}`)) {
      if (assignmentMap.get(r.campaign_id)?.hidden) continue
      const imp = Number(r.impressions) || 0
      if (imp <= 0) continue
      if (r.search_impression_share != null) { share += Number(r.search_impression_share) * imp; weight += imp }
      if (r.search_top_impression_share != null) { top += Number(r.search_top_impression_share) * imp; topWeight += imp }
    }
    return { share: weight > 0 ? share / weight : null, top: topWeight > 0 ? top / topWeight : null }
  }
  const coverage      = searchCoverage(data.google)
  const coveragePrior = searchCoverage(data.googlePrior)
  const coverageUp    = showCompare && coverage.share != null && coveragePrior.share != null
    ? (coverage.share - coveragePrior.share) * 100
    : null

  // Ad strength of the ads running now (each ad's latest row).
  const latestAds = new Map<string, AdStrengthRow>()
  for (const a of data.adStrength) {
    if (a.ad_type !== 'AD_GROUP_PLACEHOLDER' && !latestAds.has(a.ad_id)) latestAds.set(a.ad_id, a)
  }
  const STRENGTHS = [
    { key: 'EXCELLENT', label: 'Excellent', tone: 'green' },
    { key: 'GOOD',      label: 'Good',      tone: 'blue' },
    { key: 'AVERAGE',   label: 'Average',   tone: 'amber' },
    { key: 'POOR',      label: 'Poor',      tone: 'red' },
  ] as const
  const liveAds = Array.from(latestAds.values()).filter(a => ['ENABLED', 'ACTIVE'].includes((a.ad_status ?? '').toUpperCase()))
  const strengthCounts = STRENGTHS.map(st => ({ ...st, value: liveAds.filter(a => (a.ad_strength ?? '').toUpperCase() === st.key).length }))
  const ratedAds = strengthCounts.reduce((t, st) => t + st.value, 0)
  const goodAds  = strengthCounts[0].value + strengthCounts[1].value

  // Reputation: the reviews themselves, which carry the one thing the counts can't — whether
  // anybody replied. Hidden entirely until reviews are actually stored (migration 219 plus a sync).
  const reputation = (() => {
    const all = data.reviewRows
    if (all.length === 0) return null
    const day      = (v: string) => String(v).split('T')[0]
    const periodFrom = iso(fromDate), periodTo = iso(toDate)
    const inPeriod = all.filter(r => day(r.created_at) >= periodFrom && day(r.created_at) <= periodTo)
    const awaiting = all.filter(r => !r.reply_comment).length
    const rated    = inPeriod.filter(r => r.star_rating > 0)
    const allRated = all.filter(r => r.star_rating > 0)
    // Google's own figures when we have them, otherwise worked out from the reviews we hold.
    const snap     = data.ratingNow
    return {
      total:     snap?.reviews_count || all.length,
      rating:    snap?.reviews_avg_rating
        || (allRated.length > 0 ? allRated.reduce((s, r) => s + r.star_rating, 0) / allRated.length : 0),
      inPeriod:  inPeriod.length,
      awaiting,
      replyRate: ((all.length - awaiting) / all.length) * 100,
      periodAvg: rated.length > 0 ? rated.reduce((s, r) => s + r.star_rating, 0) / rated.length : 0,
    }
  })()

  // Google reviews: latest count and rating per location, and how many arrived during the window.
  const reviews = (() => {
    const byLocation = new Map<string, { first: GbpRow; last: GbpRow }>()
    for (const r of data.gbp) {
      if (!r.reviews_count || Number(r.reviews_count) <= 0) continue
      const key = r.location_id ?? 'all'
      const ex  = byLocation.get(key)
      if (!ex) byLocation.set(key, { first: r, last: r })
      else { if (r.date < ex.first.date) ex.first = r; if (r.date > ex.last.date) ex.last = r }
    }
    let count = 0, gained = 0, ratingSum = 0
    for (const { first, last } of Array.from(byLocation.values())) {
      const latest = Number(last.reviews_count) || 0
      count     += latest
      gained    += Math.max(0, latest - (Number(first.reviews_count) || 0))
      ratingSum += (Number(last.reviews_avg_rating) || 0) * latest
    }
    return { count, gained, rating: count > 0 ? ratingSum / count : 0 }
  })()

  // Website: the lowest uptime across their monitored sites, so a bad one is never averaged away.
  const monitoredSites = data.sites.filter(site => site.uptime_7d != null)
  const uptime = monitoredSites.length > 0 ? Math.min(...monitoredSites.map(site => Number(site.uptime_7d))) : null
  const certificatesOk = data.sites.length > 0 && data.sites.every(site => site.ssl_days_remaining == null || site.ssl_days_remaining > 14)
  const fmtUptime = (u: number) => `${u.toFixed(u >= 99.95 ? 2 : 1)}%`

  const keywordsUp = tracked.filter(k => (k.position_delta ?? 0) > 0).length
  const pctChange  = (cur: number, prior: number) => (prior > 0 ? ((cur - prior) / prior) * 100 : null)
  const cplChange  = showCompare && adLeads > 0 && adLeadsPrior > 0 ? pctChange(adCpl, adCplPrior) : null

  // ── At a glance: up to four true highlights, most persuasive first ──
  type Highlight = { key: string; icon: 'money' | 'up' | 'star' | 'check'; figure: string; text: string }
  const highlights: Highlight[] = []
  const wonRatio = crm.wonValue > 0 && adSpend > 0 ? crm.wonValue / adSpend : null
  if (wonRatio != null && wonRatio >= 1) {
    // Two facts side by side, not a claim that ads won every job: the CRM counts all won work.
    highlights.push({
      key: 'won', icon: 'money',
      figure: `$${Math.round(crm.wonValue).toLocaleString('en-US')}`,
      text: `In jobs won, ${wonRatio.toFixed(1)} times what was spent on ads`,
    })
  }
  const leadsChange = showCompare && hasCrmData ? pctChange(crm.leads, crmPrior.leads) : null
  if (leadsChange != null && leadsChange >= 5) {
    highlights.push({ key: 'leads', icon: 'up', figure: `+${Math.round(leadsChange)}%`, text: `More leads than ${compare === 'last_year' ? 'the same time last year' : 'the period before'}` })
  }
  if (cplChange != null && cplChange <= -5) {
    highlights.push({ key: 'cpl', icon: 'up', figure: `−${Math.round(-cplChange)}%`, text: 'Lower cost for each lead from your ads' })
  }
  // Visits from AI assistants rank high: it's the traffic clients ask about most now.
  // Visits from ChatGPT, Gemini, Copilot and the like, as Google Analytics' AI Assistant channel counts them.
  const aiVisits = ga4.byChannel.get('AI Assistant')?.sessions ?? 0
  if (aiVisits >= 5) {
    highlights.push({ key: 'ai', icon: 'up', figure: fmtInt(aiVisits), text: 'Visits from ChatGPT and other AI assistants' })
  }
  if (keywordsUp > 0) {
    highlights.push({ key: 'keywords', icon: 'up', figure: fmtInt(keywordsUp), text: `${keywordsUp === 1 ? 'Keyword' : 'Keywords'} we track moved up on Google` })
  }
  if (reviews.gained > 0) {
    highlights.push({ key: 'reviews', icon: 'star', figure: `+${reviews.gained}`, text: `New Google ${reviews.gained === 1 ? 'review' : 'reviews'}, ${reviews.rating.toFixed(1)}★ average` })
  } else if (reviews.count > 0 && reviews.rating >= 4.5) {
    highlights.push({ key: 'reviews', icon: 'star', figure: `${reviews.rating.toFixed(1)}★`, text: `Average rating across ${fmtInt(reviews.count)} Google reviews` })
  }
  if (data.posts.length > 0) {
    highlights.push({ key: 'posts', icon: 'check', figure: fmtInt(data.posts.length), text: `New ${data.posts.length === 1 ? 'page' : 'pages'} published on your website` })
  }
  if (showCalls && answerRate >= 0.85) {
    highlights.push({ key: 'answered', icon: 'check', figure: `${Math.round(answerRate * 100)}%`, text: 'Of incoming calls were answered' })
  }
  if (coverageUp != null && coverageUp >= 3 && coverage.share != null) {
    highlights.push({ key: 'coverage', icon: 'up', figure: `+${Math.round(coverageUp)} pts`, text: `Your ads now show for ${Math.round(coverage.share * 100)}% of the searches they could` })
  }
  if (ratedAds >= 2 && goodAds / ratedAds >= 0.6) {
    highlights.push({ key: 'strength', icon: 'check', figure: `${goodAds} of ${ratedAds}`, text: 'Ads rated Good or Excellent by Google' })
  }
  if (uptime != null && uptime >= 99.5) {
    highlights.push({ key: 'uptime', icon: 'check', figure: fmtUptime(uptime), text: 'Website uptime, checked around the clock' })
  }
  const topHighlights = highlights.slice(0, 4)

  // One thing to keep an eye on: the biggest real drop, with context from their own history.
  // No invented reasons and no promises — just where the number sits against the longer trend.
  let watch: { text: string; context: string | null } | null = null
  if (showCompare && hasCrmData) {
    const perWeek = { Leads: 'leads', 'Phone calls': 'calls', 'Web forms': 'forms' } as const
    const drops = ([
      { noun: 'Leads' as const,       cur: crm.leads, prior: crmPrior.leads },
      { noun: 'Phone calls' as const, cur: crm.calls, prior: crmPrior.calls },
      { noun: 'Web forms' as const,   cur: crm.forms, prior: crmPrior.forms },
    ])
      .map(d => ({ ...d, pct: pctChange(d.cur, d.prior) }))
      .filter((d): d is typeof d & { pct: number } => d.pct != null && d.pct <= -10)
      .sort((a, b) => a.pct - b.pct)
    const drop = drops[0]
    if (drop) {
      const field = perWeek[drop.noun]
      const avgPerWeek = weekly.length > 0 ? weekly.reduce((t, w) => t + w[field], 0) / weekly.length : 0
      const nowPerWeek = (drop.cur / Math.max(1, dayCount)) * 7
      let context: string | null = null
      if (drop.noun === 'Leads' && cplChange != null && cplChange <= -5) {
        context = `Each lead from your ads cost ${Math.round(-cplChange)}% less, so the budget went further.`
      } else if (avgPerWeek > 0) {
        const vsAverage = ((nowPerWeek - avgPerWeek) / avgPerWeek) * 100
        const avg = `${fmtInt(avgPerWeek)} a week`
        context = Math.abs(vsAverage) < 10 ? `That's in line with your 12-week average of ${avg}.`
          : vsAverage > 0 ? `That's still above your 12-week average of ${avg}.`
          : `That's below your 12-week average of ${avg}.`
      }
      watch = { text: `${drop.noun} down ${Math.round(-drop.pct)}% ${compareNoun}`, context }
    }
  }

  // ── The work behind the results ──
  const work: { key: string; figure: string; label: string; detail: string }[] = []
  if (data.posts.length > 0) {
    work.push({ key: 'posts', figure: fmtInt(data.posts.length), label: data.posts.length === 1 ? 'New page published' : 'New pages published', detail: 'Written around what your customers search for' })
  }
  if (tracked.length > 0) {
    work.push({ key: 'keywords', figure: fmtInt(tracked.length), label: tracked.length === 1 ? 'Keyword tracked on Google' : 'Keywords tracked on Google', detail: keywordsUp > 0 ? `${keywordsUp} moved up since the last check` : 'Positions checked regularly' })
  }
  if (data.negativeKeywordCount > 0) {
    work.push({ key: 'negatives', figure: fmtInt(data.negativeKeywordCount), label: 'Irrelevant searches blocked', detail: "Keeps your ads off searches that won't become customers" })
  }
  if (liveAds.length > 0) {
    work.push({ key: 'ads', figure: fmtInt(liveAds.length), label: liveAds.length === 1 ? 'Ad running on Google' : 'Ads running on Google', detail: ratedAds > 0 ? `${goodAds} rated Good or Excellent` : 'Live and serving' })
  }
  if (uptime != null) {
    work.push({ key: 'site', figure: fmtUptime(uptime), label: 'Website uptime', detail: certificatesOk ? 'Monitored around the clock, security certificate valid' : 'Monitored around the clock' })
  }
  const showWork     = work.length > 0
  const showAdHealth = coverage.share != null || coverage.top != null || ratedAds > 0

  const showLocal = hasGbpData || hasGscData || hasAhrefsData

  // ── KPI row ───────────────────────────────────────────────────────────────
  const paidDays = allDays
  const kpis: ReactNode[] = []
  if (hasCrmData) {
    kpis.push(
      <SparkMetricCard
        key="leads" label="Leads" value={fmtInt(crm.leads)}
        sub={sourcesComplete ? `${fmtInt(leadSources.paid)} from ads, ${fmtInt(leadSources.organic)} on their own` : 'new people who got in touch'}
        delta={delta(crm.leads, crmPrior.leads)} delay={0}
        sparkData={crmDays.map(([, v]) => ({ v: v.leads }))} sparkColor="var(--blue)"
      />,
      <SparkMetricCard
        key="calls" label="Phone calls" value={fmtInt(crm.calls)} sub="tracked calls to the business"
        delta={delta(crm.calls, crmPrior.calls)} delay={1}
        sparkData={crmDays.map(([, v]) => ({ v: v.calls }))} sparkColor="var(--green)"
      />,
      <SparkMetricCard
        key="forms" label="Web forms" value={fmtInt(crm.forms)} sub="enquiries sent from the website"
        delta={delta(crm.forms, crmPrior.forms)} delay={2}
        sparkData={crmDays.map(([, v]) => ({ v: v.forms }))} sparkColor="var(--ov-violet)"
      />,
    )
  }
  if (hasPaidData) {
    kpis.push(
      <SparkMetricCard
        key="ad-spend" label="Ad spend" value={fmt$(adSpend)}
        sub={sourcesComplete && leadSources.paid > 0
          ? `${fmtInt(leadSources.paid)} leads from ads in ${crmLabel}`
          : `${fmtInt(adLeads)} ${Math.round(adLeads) === 1 ? 'conversion' : 'conversions'} reported by the ads`}
        delta={delta(adSpend, adSpendPrior)} delay={3}
        sparkData={paidDays.map(d => ({ v: (google.byDate.get(d)?.spend ?? 0) + (meta.byDate.get(d)?.spend ?? 0) }))}
        sparkColor="var(--amber)"
      />,
      <SparkMetricCard
        key="ad-cpl" label="Cost per ad conversion" value={adLeads > 0 ? fmtCurrency(adCpl) : '—'}
        sub={hasGoogleData && hasMetaData ? 'across Google and Meta' : hasGoogleData ? 'on Google Ads' : 'on Meta Ads'}
        delta={delta(adCpl, adCplPrior)} invertDelta delay={4}
        sparkData={paidDays.map(d => {
          const s = (google.byDate.get(d)?.spend ?? 0) + (meta.byDate.get(d)?.spend ?? 0)
          const l = (google.byDate.get(d)?.leads ?? 0) + (meta.byDate.get(d)?.leads ?? 0)
          return { v: l > 0 ? s / l : 0 }
        })}
        sparkColor="var(--ov-teal)"
      />,
    )
  }
  if (hasCrmData && crm.won > 0) {
    kpis.push(
      <SparkMetricCard
        key="won" label="Jobs won" value={fmtInt(crm.won)}
        sub={crm.wonValue > 0 ? `worth ${fmt$(crm.wonValue)}` : 'opportunities marked won'}
        delta={delta(crm.won, crmPrior.won)} delay={5}
        sparkData={crmDays.map(([, v]) => ({ v: v.won }))} sparkColor="var(--green)"
      />,
    )
  }

  // ── The sentence a business owner reads first ─────────────────────────────
  const headline: ReactNode = hasCrmData ? (
    <>
      You picked up <b>{fmtInt(crm.leads)} {crm.leads === 1 ? 'lead' : 'leads'}</b> over {periodLabel}
      {crm.calls + crm.forms > 0 && <> — <b>{fmtInt(crm.calls)}</b> by phone and <b>{fmtInt(crm.forms)}</b> through the website</>}.
      {crm.won > 0 && <> <b>{fmtInt(crm.won)}</b> {crm.won === 1 ? 'job was' : 'jobs were'} won{crm.wonValue > 0 && <>, worth <b>{fmt$(crm.wonValue)}</b></>}.</>}
      {adLeads > 0 && <> Google and Meta reported <b>{fmtInt(adLeads)}</b> {Math.round(adLeads) === 1 ? 'conversion' : 'conversions'} from your ads at <b>{fmtCurrency(adCpl)}</b> each{sourcesComplete && leadSources.paid > 0 && <>, and <b>{fmtInt(leadSources.paid)}</b> of your leads came through an ad</>}.{adCallCount > 0 && <> Google Ads also counted <b>{fmtInt(adCallCount)}</b> {adCallCount === 1 ? 'call' : 'calls'} straight from the ad.</>}</>}
    </>
  ) : adLeads > 0 ? (
    <>
      Your ads reported <b>{fmtInt(adLeads)} {Math.round(adLeads) === 1 ? 'conversion' : 'conversions'}</b> over {periodLabel}, at <b>{fmtCurrency(adCpl)}</b> each
      on <b>{fmt$(adSpend)}</b> of spend.
    </>
  ) : null

  const showDailyChart = hasPaidData && allDays.length > 1
  const showChanges    = changes.length > 0

  return (
    <div className="ov-scope" style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <PageHeader title="Overview" accent="var(--accent)" fromDate={fromDate} toDate={toDate} compare={compare} />

      <main className="page ov-main">
        {noDataForWindow ? (
          <EmptyState
            title="Nothing to show for this period yet"
            description="Once your ads, website and phone tracking are connected, this page shows how many leads each of them brought in. Try a wider date range, or ask your account manager which sources are live."
            icon={<Compass size={22} />}
          />
        ) : (
          <>
            {headline && <p className="ov-headline">{headline}</p>}

            {(topHighlights.length > 0 || watch) && (
              <section className="card ov3-glance" aria-labelledby="ov3-glance-title">
                <div className="ov2-card-head">
                  <h2 id="ov3-glance-title" className="section-title">At a glance</h2>
                  <p className="section-desc">What went well over {periodLabel}</p>
                </div>
                {topHighlights.length > 0 && (
                  <ul className="ov3-wins">
                    {topHighlights.map(h => (
                      <li key={h.key} className="ov3-win">
                        <span className={`ov3-win__icon ov3-win__icon--${h.icon}`} aria-hidden>
                          {h.icon === 'money' ? <CurrencyDollar size={16} weight="bold" />
                            : h.icon === 'star' ? <Star size={16} weight="fill" />
                            : h.icon === 'up' ? <TrendUp size={16} weight="bold" />
                            : <CheckCircle size={16} weight="fill" />}
                        </span>
                        <span className="ov3-win__figure">{h.figure}</span>
                        <span className="ov3-win__text">{h.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {watch && (
                  <p className="ov3-watch">
                    <span className="ov3-watch__label">Keeping an eye on</span>
                    <span className="ov3-watch__text"><b>{watch.text}.</b>{watch.context && <> {watch.context}</>}</span>
                  </p>
                )}
              </section>
            )}

            {data.updates.length > 0 && (
              <section className="card ov3-team" aria-labelledby="ov3-team-title">
                <div className="ov3-team__head">
                  <span className="ov3-team__icon" aria-hidden><Megaphone size={18} weight="bold" /></span>
                  <div>
                    <h2 id="ov3-team-title" className="section-title">From your team</h2>
                    <p className="section-desc">What we&apos;ve been working on for you</p>
                  </div>
                </div>
                <article className="ov3-team__latest">
                  <div className="ov3-team__meta">
                    {data.updates[0].title && <h3 className="ov3-team__title">{data.updates[0].title}</h3>}
                    <span className="ov3-team__date">{fmtShortDate(data.updates[0].created_at.slice(0, 10))}</span>
                  </div>
                  <div className="ov3-team__body"><AlertBody body={data.updates[0].content} /></div>
                  {data.updates[0].next_up && (
                    <div className="ov3-team__next">
                      <span className="ov3-team__next-label">What&apos;s next</span>
                      <div className="ov3-team__body"><AlertBody body={data.updates[0].next_up} /></div>
                    </div>
                  )}
                </article>
                {data.updates.length > 1 && (
                  <ul className="ov3-team__earlier">
                    {data.updates.slice(1).map(u => (
                      <li key={u.created_at}>
                        <span className="ov3-team__earlier-title">{u.title || alertPlainText(u.content).slice(0, 90)}</span>
                        <span className="ov3-team__date">{fmtShortDate(u.created_at.slice(0, 10))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {kpis.length > 0 && <div className="stat-grid ov2-kpis" data-count={kpis.length}>{kpis}</div>}

            {showChannels && (
              <div className={mixTotal > 0 || hasLeadSources ? 'ov2-row ov2-row--wide' : 'ov2-row'}>
                <section className="card ov2-card ov2-channels" aria-labelledby="ov2-channels-title">
                  <div className="ov2-card-head">
                    <h2 id="ov2-channels-title" className="section-title">{hasLeadSources ? 'Leads by channel' : 'Performance by channel'}</h2>
                    <p className="section-desc">{hasLeadSources ? 'Every lead your CRM recorded, and what brought them in' : <>Where this period&apos;s visits and conversions came from</>}</p>
                  </div>
                  <div className="table-scroll">
                    <table className="data-table ov2-table">
                      <thead>
                        <tr>
                          <th scope="col">Channel</th>
                          <th scope="col" className="num">Cost</th>
                          <th scope="col" className="num ov2-col-visits">Visits</th>
                          <th scope="col" className="num">{hasLeadSources ? 'Leads' : <><span className="ov2-th-long">Conversions</span><span className="ov2-th-short">Conv.</span></>}</th>
                          <th scope="col" className="num">
                            {hasLeadSources
                              ? <><span className="ov2-th-long">Cost per lead</span><span className="ov2-th-short">Per lead</span></>
                              : <><span className="ov2-th-long">Cost per conv.</span><span className="ov2-th-short">Per conv.</span></>}
                          </th>
                          <th scope="col" className="ov2-trend-col">Trend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {channels.map(c => (
                          <tr key={c.key}>
                            <th scope="row">
                              <span className="ov2-chan">
                                <span className="ov2-chan__icon" style={{ color: c.color }}>{c.icon}</span>
                                <span className="ov2-chan__text">
                                  {c.name}
                                  {c.note && <span className="ov2-chan__note">{c.note}</span>}
                                </span>
                              </span>
                            </th>
                            <td className="num">{c.cost == null ? <span className="ov2-muted">—</span> : fmtWholeDollars(c.cost)}</td>
                            <td className="num ov2-col-visits">{c.visits == null ? <span className="ov2-muted">—</span> : fmtInt(c.visits)}</td>
                            <td className="num ov2-strong">{fmtInt(c.leads)}</td>
                            <td className="num">
                              {c.cost != null && c.leads >= 1 ? fmtCurrency(c.cost / c.leads) : <span className="ov2-muted">—</span>}
                            </td>
                            <td className="ov2-trend-col">
                              <div className="ov2-spark"><Sparkline data={c.trend} color={c.color} height={28} /></div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {channels.length > 1 && (
                        <tfoot>
                          <tr>
                            <th scope="row">All channels</th>
                            <td className="num">{totals.cost > 0 ? fmtWholeDollars(totals.cost) : '—'}</td>
                            <td className="num ov2-col-visits">{fmtInt(totals.visits)}</td>
                            <td className="num">{fmtInt(totals.leads)}</td>
                            <td className="num">{totals.cost > 0 && totals.leads >= 1 ? fmtCurrency(totals.cost / totals.leads) : '—'}</td>
                            <td className="ov2-trend-col">
                              <div className="ov2-spark"><Sparkline data={totalTrend} color="var(--text-secondary)" height={28} /></div>
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <p className="ov2-foot">{channelFootnote}</p>
                </section>

                {hasLeadSources ? (
                  <section className="card ov2-card" aria-labelledby="ov2-mix-title">
                    <div className="ov2-card-head">
                      <h2 id="ov2-mix-title" className="section-title">Where your leads came from</h2>
                      <p className="section-desc">How each lead reached you, as tracked in {crmLabel}. An ad on their first or latest visit counts as from ads.</p>
                    </div>
                    <LeadMixDonut
                      slices={[
                        { name: 'From ads',        value: leadSources.paid,      color: 'var(--blue)' },
                        { name: 'On their own',    value: leadSources.organic,   color: 'var(--green)' },
                        { name: 'Not from marketing', value: leadSources.internal, color: 'var(--ov-violet)' },
                        { name: 'No clear source', value: leadSources.untracked, color: 'var(--text-faint)' },
                      ]}
                      total={leadSources.total}
                      centerLabel={leadSources.total === 1 ? 'lead' : 'leads'}
                    />
                    <p className="ov2-foot">
                      {leadSources.internal > 0 && `Not from marketing means ${crmLabel} recorded the contact as arriving in a file import, or as created by someone using it — not from a visit or an ad. `}
                      {leadSources.untracked > 0 && 'No clear source means the lead reached you in a way nothing recorded — often a phone call. '}
                      {!sourcesComplete && 'Some days in this range were synced before sources were tracked, so this covers fewer leads than the total.'}
                    </p>
                  </section>
                ) : mixTotal > 0 && (
                  <section className="card ov2-card" aria-labelledby="ov2-mix-title">
                    <div className="ov2-card-head">
                      <h2 id="ov2-mix-title" className="section-title">Conversion mix</h2>
                      <p className="section-desc">Share of reported conversions by channel</p>
                    </div>
                    <LeadMixDonut slices={mixSlices} total={mixTotal} centerLabel={mixTotal === 1 ? 'conversion' : 'conversions'} />
                  </section>
                )}
              </div>
            )}

            {showDailyChart ? (
              <section className="card ov2-card" aria-labelledby="ov2-daily-title">
                <div className="ov2-card-head">
                  <h2 id="ov2-daily-title" className="section-title">Cost vs leads by day</h2>
                  <p className="section-desc">
                    {hasCrmData
                      ? 'Ad spend by platform, with every lead the CRM recorded that day'
                      : 'Ad spend by platform, with the leads the ads reported that day'}
                  </p>
                </div>
                <CostLeadsChart
                  data={costLeads}
                  leadsLabel={hasCrmData ? 'All leads' : 'Leads from ads'}
                  showGoogle={hasGoogleData}
                  showMeta={hasMetaData}
                />
              </section>
            ) : hasCrmData && leadTrend.length > 1 ? (
              <section className="card ov2-card" aria-labelledby="ov2-daily-title">
                <div className="ov2-card-head">
                  <h2 id="ov2-daily-title" className="section-title">Leads day by day</h2>
                  <p className="section-desc">Phone calls and web forms, {fmtShortDate(iso(fromDate))} – {fmtShortDate(iso(toDate))}</p>
                </div>
                <SpendChart data={leadTrend} spendLabel="Phone calls" conversionsLabel="Web forms" variant="count" />
              </section>
            ) : null}

            {showKeywords && (
              <div className={tracked.length > 0 && topSearches.length > 0 ? 'ov2-row ov2-row--halves' : 'ov2-row'}>
                {tracked.length > 0 && (
                  <section className="card ov2-card" aria-labelledby="ov2-kw-title">
                    <div className="ov2-card-head ov2-card-head--split">
                      <div>
                        <h2 id="ov2-kw-title" className="section-title">Keywords we track</h2>
                        <p className="section-desc">Where you rank on Google for the terms we&apos;re working on</p>
                      </div>
                      <a className="ov2-link ov2-head-link" href={link('/dashboard/seo')}>All keywords</a>
                    </div>
                    <div className="kw-bands">
                      {kwBands.map(b => (
                        <div key={b.label} className={`kw-band kw-band--${b.tone}`}>
                          <span className="kw-band__value">{b.value}</span>
                          <span className="kw-band__label">{b.label}</span>
                        </div>
                      ))}
                    </div>
                    <ul className="kw-list">
                      {trackedShown.map(k => (
                        <li key={k.keyword} className="kw-list__row">
                          <span className="kw-list__term" title={k.keyword}>{k.keyword}</span>
                          <span className="kw-list__meta">{k.search_volume != null ? `${fmtInt(k.search_volume)} searches/mo` : ''}</span>
                          <span className="kw-list__change"><RankChange change={k.position_delta} /></span>
                          <PositionPill position={k.current_position} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {topSearches.length > 0 && (
                  <section className="card ov2-card" aria-labelledby="ov2-searches-title">
                    <div className="ov2-card-head ov2-card-head--split">
                      <div>
                        <h2 id="ov2-searches-title" className="section-title">Top searches on Google</h2>
                        <p className="section-desc">
                          {showCompare && gscPrior
                            ? `What people searched to find you, and how each position moved ${compareNoun}`
                            : 'What people searched to find you, by clicks'}
                        </p>
                      </div>
                      <a className="ov2-link ov2-head-link" href={link('/dashboard/seo')}>All searches</a>
                    </div>
                    <ul className="kw-list">
                      {topSearches.map(q => (
                        <li key={q.query} className="kw-list__row">
                          <span className="kw-list__term" title={q.query}>{q.query}</span>
                          <span className="kw-list__meta">{fmtInt(q.clicks)} {q.clicks === 1 ? 'click' : 'clicks'}</span>
                          <span className="kw-list__change"><RankChange change={q.change} decimals={1} newWhenNull /></span>
                          <PositionPill position={q.position} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {(showWork || showAdHealth) && (
              <div className={showWork && showAdHealth ? 'ov2-row ov2-row--halves' : 'ov2-row'}>
                {showWork && (
                  <section className="card ov2-card" aria-labelledby="ov3-work-title">
                    <div className="ov2-card-head">
                      <h2 id="ov3-work-title" className="section-title">The work behind your results</h2>
                      <p className="section-desc">What&apos;s running and being looked after for you</p>
                    </div>
                    <ul className="ov3-work">
                      {work.map(w => (
                        <li key={w.key} className="ov3-work__item">
                          <span className={`ov3-work__icon ov3-work__icon--${w.key}`} aria-hidden>
                            {w.key === 'posts' ? <FileText size={16} weight="bold" />
                              : w.key === 'keywords' ? <MagnifyingGlass size={16} weight="bold" />
                              : w.key === 'negatives' ? <Prohibit size={16} weight="bold" />
                              : w.key === 'ads' ? <CursorClick size={16} weight="bold" />
                              : <ShieldCheck size={16} weight="bold" />}
                          </span>
                          <span className="ov3-work__body">
                            <span className="ov3-work__label">{w.label}</span>
                            <span className="ov3-work__detail">{w.detail}</span>
                          </span>
                          <span className="ov3-work__figure">{w.figure}</span>
                        </li>
                      ))}
                    </ul>
                    {data.posts.length > 0 && (
                      <div className="ov3-posts">
                        <p className="ov3-posts__title">Published over {periodLabel}</p>
                        <ul className="ov3-posts__list">
                          {data.posts.map(post => (
                            <li key={post.published_url ?? ''} className="ov3-posts__item">
                              <a href={post.published_url ?? undefined} target="_blank" rel="noopener noreferrer" className="ov2-link ov3-posts__link">
                                {post.title || post.published_url}
                              </a>
                              {post.published_at && <span className="ov3-posts__date">{fmtShortDate(post.published_at.slice(0, 10))}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}

                {showAdHealth && (
                  <section className="card ov2-card" aria-labelledby="ov3-health-title">
                    <div className="ov2-card-head">
                      <h2 id="ov3-health-title" className="section-title">Your Google Ads health</h2>
                      <p className="section-desc">What Google weighs when it decides whose ad to show, and where</p>
                    </div>
                    <div className="ov3-health">
                      {coverage.share != null && (
                        <div className="ov3-meter">
                          <div className="ov3-meter__head">
                            <span className="ov3-meter__label">Searches your ads showed up for</span>
                            <span className="ov3-meter__value">
                              {Math.round(coverage.share * 100)}%
                              {coverageUp != null && Math.abs(coverageUp) >= 1 && (
                                <span className={`ov3-meter__delta ov2-tone--${coverageUp > 0 ? 'good' : 'bad'}`}>
                                  {coverageUp > 0 ? '+' : '−'}{Math.abs(Math.round(coverageUp))} pts
                                </span>
                              )}
                            </span>
                          </div>
                          <span className="ov3-meter__track"><span className="ov3-meter__fill" style={{ width: `${Math.min(100, coverage.share * 100)}%` }} /></span>
                          <p className="ov3-meter__note">Out of all the searches your ads were eligible to appear for</p>
                        </div>
                      )}
                      {coverage.top != null && (
                        <div className="ov3-meter">
                          <div className="ov3-meter__head">
                            <span className="ov3-meter__label">Shown above the regular results</span>
                            <span className="ov3-meter__value">{Math.round(coverage.top * 100)}%</span>
                          </div>
                          <span className="ov3-meter__track"><span className="ov3-meter__fill ov3-meter__fill--top" style={{ width: `${Math.min(100, coverage.top * 100)}%` }} /></span>
                          <p className="ov3-meter__note">The top of the page is where most people click</p>
                        </div>
                      )}
                      {ratedAds > 0 && (
                        <div className="ov3-meter">
                          <div className="ov3-meter__head">
                            <span className="ov3-meter__label">Ad strength</span>
                            <span className="ov3-meter__value">{goodAds} of {ratedAds} Good or better</span>
                          </div>
                          <span className="ov3-strength" role="img" aria-label={strengthCounts.filter(st => st.value > 0).map(st => `${st.value} ${st.label}`).join(', ')}>
                            {strengthCounts.filter(st => st.value > 0).map(st => (
                              <span key={st.key} className={`ov3-strength__seg ov3-tone-bg--${st.tone}`} style={{ flexGrow: st.value }} />
                            ))}
                          </span>
                          <ul className="ov3-strength__legend">
                            {strengthCounts.filter(st => st.value > 0).map(st => (
                              <li key={st.key}><span className={`ov3-strength__dot ov3-tone-bg--${st.tone}`} aria-hidden />{st.label} <b>{st.value}</b></li>
                            ))}
                          </ul>
                          <p className="ov3-meter__note">Google&apos;s own rating of how well each ad matches what people search for</p>
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </div>
            )}

            {(showFunnel || showChanges) && (
              <div className={showFunnel && showChanges ? 'ov2-row ov2-row--halves' : 'ov2-row'}>
                {showFunnel && (
                  <section className="card ov2-card" aria-labelledby="ov2-funnel-title">
                    <div className="ov2-card-head">
                      <h2 id="ov2-funnel-title" className="section-title">From lead to job</h2>
                      <p className="section-desc">Leads, opportunities opened and jobs won over {periodLabel}</p>
                    </div>
                    <ol className="ov2-funnel">
                      {funnel.map((s, i) => {
                        const prev = i > 0 ? funnel[i - 1].value : 0
                        const rate = i > 0 && prev > 0 && s.value > 0 && s.value <= prev ? Math.round((s.value / prev) * 100) : null
                        return (
                          <li key={s.label} className="ov2-funnel__step">
                            {i > 0 && (
                              <span className="ov2-funnel__rate" aria-label={rate != null ? `${rate}% of ${funnel[i - 1].label.toLowerCase()}` : undefined}>
                                {rate != null && <span>{rate}%</span>}
                                <ArrowRight size={14} weight="bold" aria-hidden />
                              </span>
                            )}
                            <div className={`ov2-funnel__stage ov2-funnel__stage--${s.tone}`}>
                              <span className="ov2-funnel__label">{s.label}</span>
                              <span className="ov2-funnel__value">{fmtInt(s.value)}</span>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                    {crm.won === 0 && (
                      <p className="ov3-nudge">
                        <Lightbulb size={16} weight="fill" aria-hidden />
                        <span>
                          No jobs have been marked won in {crmLabel} for these dates. When a lead becomes a job, mark it
                          won there. That&apos;s how this page shows which leads turned into work, and what they were worth.
                        </span>
                      </p>
                    )}
                    {crm.won > 0 && crm.wonValue > 0 && (
                      <p className="ov2-funnel__money">
                        Jobs won are worth <b>{fmt$(crm.wonValue)}</b>, about <b>{fmt$(crm.wonValue / crm.won)}</b> each.
                      </p>
                    )}
                  </section>
                )}

                {showChanges && (
                  <section className="card ov2-card" aria-labelledby="ov2-changes-title">
                    <div className="ov2-card-head">
                      <h2 id="ov2-changes-title" className="section-title">What changed</h2>
                      <p className="section-desc">{showCompare ? `The biggest moves ${compareNoun}` : 'Worth knowing about this period'}</p>
                    </div>
                    <ul className="ov2-changes">
                      {changes.map(c => (
                        <li key={c.key} className="ov2-changes__row">
                          <span className={`ov2-changes__icon ov2-tone--${c.tone}`}>
                            {c.kind === 'up'
                              ? <TrendUp size={15} weight="bold" aria-hidden />
                              : c.kind === 'down'
                                ? <TrendDown size={15} weight="bold" aria-hidden />
                                : <Lightbulb size={15} weight="bold" aria-hidden />}
                          </span>
                          <span className="ov2-changes__text">{c.text}</span>
                          <span className="ov2-changes__detail">{c.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {showCalls && (
              <div className="ov2-row ov2-row--wide">
                <section className="card ov2-card" aria-labelledby="ov2-calls-title">
                  <div className="ov2-card-head">
                    <h2 id="ov2-calls-title" className="section-title">Answered vs missed, by day of the week</h2>
                    <p className="section-desc">Incoming calls over {periodLabel}</p>
                  </div>
                  <div className="ov2-legend">
                    <span className="ov2-legend__item"><span className="ov2-legend__bar" style={{ background: 'var(--green)' }} />Answered</span>
                    <span className="ov2-legend__item"><span className="ov2-legend__bar" style={{ background: 'var(--red)' }} />Missed</span>
                  </div>
                  <div
                    className="ov2-week ov2-week-wrap" role="img"
                    aria-label={byWeekday.map((d, i) => `${WEEKDAYS[i]}: ${d.answered} answered, ${d.missed} missed`).join('; ')}
                  >
                    {byWeekday.map((d, i) => (
                      <div key={WEEKDAYS[i]} className="ov2-week__day">
                        <div className="ov2-week__bars">
                          <span className="ov2-week__bar ov2-week__bar--answered" style={{ height: `${(d.answered / weekdayMax) * 100}%` }}>
                            {d.answered > 0 && <span className="ov2-week__val">{d.answered}</span>}
                          </span>
                          <span className="ov2-week__bar ov2-week__bar--missed" style={{ height: `${(d.missed / weekdayMax) * 100}%` }}>
                            {d.missed > 0 && <span className="ov2-week__val">{d.missed}</span>}
                          </span>
                        </div>
                        <span className="ov2-week__label">{WEEKDAYS[i]}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <div className="ov2-tiles">
                  <section className="card ov2-bigstat" aria-label="Answer rate">
                    <span className="ov2-bigstat__label">Answer rate</span>
                    <span className={`ov2-bigstat__value ov2-tone--${answerRate >= 0.9 ? 'good' : answerRate >= 0.75 ? 'warn' : 'bad'}`}>
                      {Math.round(answerRate * 100)}%
                    </span>
                    <span className="ov2-bigstat__sub">{fmtInt(answered)} of {fmtInt(crm.incoming)} incoming calls answered</span>
                    {tileDelta(answerRate, answerRatePrior, { points: true })}
                  </section>
                  <section className="card ov2-bigstat" aria-label="Missed calls">
                    <span className="ov2-bigstat__label">Missed calls</span>
                    <span className={`ov2-bigstat__value ov2-tone--${crm.missed === 0 ? 'good' : 'bad'}`}>{fmtInt(crm.missed)}</span>
                    <span className="ov2-bigstat__sub">incoming calls nobody picked up</span>
                    {tileDelta(crm.missed, crmPrior.incoming > 0 ? crmPrior.missed : null, { lowerIsBetter: true })}
                  </section>
                </div>
              </div>
            )}

            {reputation && (
              <section className="card ov2-card" aria-labelledby="ov2-rep-title">
                <div className="ov2-card-head ov2-card-head--split">
                  <div>
                    <h2 id="ov2-rep-title" className="section-title">What people say about you</h2>
                    <p className="section-desc">
                      {reputation.inPeriod > 0
                        ? <>
                            <b>{fmtInt(reputation.inPeriod)}</b> new {reputation.inPeriod === 1 ? 'review' : 'reviews'} in this period
                            {reputation.periodAvg > 0 && <>, averaging {reputation.periodAvg.toFixed(1)} stars</>}
                          </>
                        : 'Your Google reviews and how quickly they get a reply'}
                    </p>
                  </div>
                  <a className="ov2-link" href={link('/dashboard/reputation')}>All reviews</a>
                </div>

                <ul className="ov3-local">
                  <li className="ov3-local__stat">
                    <span className="metric-label">Rating</span>
                    <span className="ov3-local__value">{reputation.rating > 0 ? reputation.rating.toFixed(1) : '—'}</span>
                    <span className="ov3-local__sub">across {fmtInt(reputation.total)} reviews</span>
                  </li>
                  <li className="ov3-local__stat">
                    <span className="metric-label">New reviews</span>
                    <span className="ov3-local__value">{fmtInt(reputation.inPeriod)}</span>
                    <span className="ov3-local__sub">left in this period</span>
                  </li>
                  <li className="ov3-local__stat">
                    <span className="metric-label">Replied to</span>
                    <span className="ov3-local__value">{reputation.replyRate.toFixed(0)}%</span>
                    <span className="ov3-local__sub">of the reviews we hold</span>
                  </li>
                  <li className="ov3-local__stat">
                    <span className="metric-label">Awaiting a reply</span>
                    <span className="ov3-local__value">{fmtInt(reputation.awaiting)}</span>
                    <span className="ov3-local__sub">{reputation.awaiting === 0 ? 'nothing outstanding' : 'still unanswered'}</span>
                  </li>
                </ul>
              </section>
            )}

            {weekly.length > 1 && (
              <section className="card ov2-card" aria-labelledby="ov2-weekly-title">
                <div className="ov2-card-head">
                  <h2 id="ov2-weekly-title" className="section-title">Leads week by week</h2>
                  <p className="section-desc">The last {ROLLING_WEEKS} weeks, whatever date range is selected above</p>
                </div>
                <WeeklyTrendChart data={weekly} />
              </section>
            )}

            {showLocal && (
              <div className={hasGbpData && (hasGscData || hasAhrefsData) ? 'ov2-row ov2-row--wide' : 'ov2-row'}>
                {hasGbpData && (
                  <section className="card ov2-card" aria-labelledby="ov2-local-title">
                    <div className="ov2-card-head ov2-card-head--split">
                      <div>
                        <h2 id="ov2-local-title" className="section-title">Your Google listing</h2>
                        <p className="section-desc">
                          {gbpViews > 0
                            ? <>Seen <b>{fmtInt(gbpViews)}</b> times on Google — {fmtInt(gbp.search)} in search results, {fmtInt(gbp.maps)} on the map</>
                            : 'Calls and directions from people who found your listing on Google'}
                        </p>
                      </div>
                      <a className="ov2-link" href={link('/dashboard/seo?tab=local')}>Listing report</a>
                    </div>

                    <ul className="ov3-local">
                      <li className="ov3-local__stat">
                        <span className="metric-label">Listing views</span>
                        <span className="ov3-local__value">{fmtInt(gbpViews)}<DeltaPill value={delta(gbpViews, gbpPriorViews)} /></span>
                        <span className="ov3-local__sub">people who saw you on Google</span>
                      </li>
                      <li className="ov3-local__stat">
                        <span className="metric-label">Calls</span>
                        <span className="ov3-local__value">{fmtInt(gbp.calls)}<DeltaPill value={delta(gbp.calls, gbpPrior.calls)} /></span>
                        <span className="ov3-local__sub">tapped your number</span>
                      </li>
                      <li className="ov3-local__stat">
                        <span className="metric-label">Directions</span>
                        <span className="ov3-local__value">{fmtInt(gbp.directions)}<DeltaPill value={delta(gbp.directions, gbpPrior.directions)} /></span>
                        <span className="ov3-local__sub">asked how to get to you</span>
                      </li>
                      <li className="ov3-local__stat">
                        <span className="metric-label">Website visits</span>
                        <span className="ov3-local__value">{fmtInt(gbp.website)}<DeltaPill value={delta(gbp.website, gbpPrior.website)} /></span>
                        <span className="ov3-local__sub">came to your site from it</span>
                      </li>
                    </ul>

                    {gbpDaily.length > 2 && (
                      <div className="ov3-local__spark">
                        <Sparkline data={gbpDaily.map(([, v]) => ({ v }))} color="var(--green)" height={36} />
                      </div>
                    )}

                    {gbpViews > 0 && (
                      <>
                        <div className="ov3-split" role="img" aria-label={`${fmtInt(gbp.search)} views in search results, ${fmtInt(gbp.maps)} on the map`}>
                          <span className="ov3-split__seg ov3-split__seg--search" style={{ flexGrow: Math.max(gbp.search, 1) }} />
                          <span className="ov3-split__seg ov3-split__seg--maps"   style={{ flexGrow: Math.max(gbp.maps, 1) }} />
                        </div>
                        <ul className="ov3-split__legend">
                          <li><span className="ov3-split__dot ov3-split__seg--search" aria-hidden />Google Search <b>{fmtInt(gbp.search)}</b></li>
                          <li><span className="ov3-split__dot ov3-split__seg--maps" aria-hidden />Google Maps <b>{fmtInt(gbp.maps)}</b></li>
                          {reviews.count > 0 && <li className="ov3-split__reviews">★ {reviews.rating.toFixed(1)} across {fmtInt(reviews.count)} reviews</li>}
                        </ul>
                      </>
                    )}

                    <p className="gbp-lag">
                      <Info size={13} weight="fill" className="gbp-lag__icon" aria-hidden />
                      <span>
                        Google finishes counting listing activity a few days after the fact, so the
                        most recent days read lower than they really were
                        {gbpLastDay ? <> — these figures run to {fmtShortDate(gbpLastDay)}</> : null}.
                      </span>
                    </p>
                  </section>
                )}

                {(hasGscData || hasAhrefsData) && (
                  <section className="card ov2-card" aria-labelledby="ov2-search-title">
                    <div className="ov2-card-head ov2-card-head--split">
                      <div>
                        <h2 id="ov2-search-title" className="section-title">Found on Google</h2>
                        <p className="section-desc">
                          {hasGscData ? 'What people searched for, and how often they picked you' : 'How strong your site looks to Google'}
                        </p>
                      </div>
                      <a className="ov2-link" href={link('/dashboard/seo')}>Full SEO report</a>
                    </div>

                    <ul className="ov3-searchstats">
                      {hasGscData && gscCurr && (
                        <>
                          <li>
                            <span className="metric-label">Clicks from search</span>
                            <span className="ov3-local__value">{fmtInt(gscCurr.totals.clicks)}<DeltaPill value={delta(gscCurr.totals.clicks, gscPrior?.totals.clicks ?? 0)} /></span>
                          </li>
                          <li>
                            <span className="metric-label">Times you appeared</span>
                            <span className="ov3-local__value">{fmtInt(gscCurr.totals.impressions)}<DeltaPill value={delta(gscCurr.totals.impressions, gscPrior?.totals.impressions ?? 0)} /></span>
                          </li>
                          <li>
                            <span className="metric-label">Average position</span>
                            <span className="ov3-local__value">{gscCurr.totals.position > 0 ? gscCurr.totals.position.toFixed(1) : '—'}</span>
                          </li>
                        </>
                      )}
                      {hasAhrefsData && (
                        <>
                          <li>
                            <span className="metric-label">Sites linking to you</span>
                            <span className="ov3-local__value">{ahrefsDomains.value != null ? fmtInt(ahrefsDomains.value) : '—'}{ahrefsDomains.delta !== undefined && <DeltaPill value={ahrefsDomains.delta} />}</span>
                          </li>
                          <li>
                            <span className="metric-label">Site strength</span>
                            <span className="ov3-local__value">{ahrefsRating.value != null ? ahrefsRating.value.toFixed(1) : '—'}{ahrefsRating.delta !== undefined && <DeltaPill value={ahrefsRating.delta} />}</span>
                          </li>
                        </>
                      )}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
