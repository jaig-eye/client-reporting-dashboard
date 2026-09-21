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
import SpendChart from '@/components/SpendChart'
import { ConnectorLogo } from '@/components/ConnectorLogo'
import { addLeadSources, summariseLeadSources, LEAD_SOURCES, groupOf, type LeadSourceCounts, type LeadSourceKey } from '@/lib/leadSources'
import Link from 'next/link'
import { alertPlainText } from '@/components/admin/AlertBody'
import {
  Compass, MapPin, LinkSimple, MagnifyingGlass, CursorClick, UsersThree, EnvelopeSimple, Globe,
  Star, Sparkle,
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
  spam_sources?: LeadSourceCounts | null
  /** raw_data->tracking_calls: inbound calls by the channel their dialled number stands for. */
  tracking_calls?: LeadSourceCounts | null
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
    const GHL_COLS    = 'date,contacts_created,spam_leads,total_calls,incoming_calls,missed_calls,forms_submitted,new_opportunities,won_opportunities,won_value,lead_sources:raw_data->lead_sources,spam_sources:raw_data->spam_sources,tracking_calls:raw_data->tracking_calls'
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
        .order('created_at', { ascending: false }).limit(12),
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
    const t = { leads: 0, spam: 0, calls: 0, forms: 0, incoming: 0, missed: 0, newOpps: 0, won: 0, wonValue: 0 }
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
      t.spam  += Number(r.spam_leads) || 0
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

  // ── The same question asked of the calls: which number did they ring? ──────
  // A call is placed by the tracking number it came in on, so this is measured rather than
  // inferred. Calls that arrived on a number we don't recognise are simply absent, which means
  // this can undercount the calls from ads but can never overstate them.
  const callSourceCounts: LeadSourceCounts = {}
  for (const r of data.ghl) {
    if (r.tracking_calls && typeof r.tracking_calls === 'object') {
      addLeadSources(callSourceCounts, r.tracking_calls)
    }
  }
  const callSources    = summariseLeadSources(callSourceCounts)
  const paidCalls      = callSources.paid
  // Only speak for the whole range when every day in it was counted.
  const sourcesComplete = hasLeadSources && sourceDays === data.ghl.length

  const crmDays = Array.from(crm.byDate.entries()).sort(([a], [b]) => a.localeCompare(b))
  const leadTrend: DailyMetric[] = crmDays.map(([date, v]) => ({
    date, spend: v.calls, conversions: v.forms, clicks: 0, roas: 0,
  }))

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
  const hasGa4Data = ga4.sessions > 0

  // ── Search Console (live) + Ahrefs (weekly snapshot) ──────────────────────
  const gscCurr    = gsc.curr  as GSCSummaryResult | null
  const gscPrior   = gsc.prior as GSCSummaryResult | null
  const hasGscData = !!gscCurr && gscCurr.totals.impressions > 0

  // Each figure from the newest week that has it: Ahrefs' newest week often has a rating but no
  // link counts yet. A change only when a comparison is set.

  // ── Deltas — only when a comparison is on, and only when there is a base ───
  const delta = (curr: number, prior: number) => (showCompare ? calcDelta(curr, prior) : undefined)

  const qs = new URLSearchParams({ from: iso(fromDate), to: iso(toDate) })
  if (compare !== 'none') qs.set('compare', compare)

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
    // One row per thing a client would act on, rather than one per value GHL happened to record.
    // Every bundle stays inside a single donut group, so the table and the chart cannot disagree.
    const BUNDLES: { key: LeadSourceKey; also?: LeadSourceKey[]; name?: string }[] = [
      { key: 'other_paid' },
      { key: 'google_business' },
      { key: 'organic_search' },
      { key: 'ai_assistant' },
      // Everything else they did to find you on their own. Ads, the listing, search and AI each
      // keep their own row because each is a thing we work on; these three are not, and as
      // separate rows of three, one and nought they were noise.
      { key: 'direct', also: ['social', 'referral'], name: 'Other ways they found you' },
      // Every lead nothing recorded a source for, however it reached the CRM. The donut counts
      // these as one slice; listing them apart made the same leads look like different answers.
      { key: 'untracked', also: ['call_or_message', 'website_call', 'other'], name: 'No source recorded' },
    ]
    BUNDLES
      .map(b => {
        const keys = [b.key, ...(b.also ?? [])]
        return {
          ...b, keys,
          count: sourceLeads(keys),
          label: b.name ?? LEAD_SOURCES.find(s => s.key === b.key)?.label ?? b.key,
          group: groupOf(b.key),
        }
      })
      .filter(b => b.count > 0)
      .sort((a, b) => b.count - a.count)
      .forEach(b => {
        // Visits come from the Analytics channel that matches, where one does.
        const visits = b.keys.reduce<number | null>((sum, k) => {
          const name = GA4_FOR_SOURCE[k]
          const v = name ? ga4.byChannel.get(name)?.sessions : undefined
          return v == null ? sum : (sum ?? 0) + v
        }, null)
        channels.push({
          key: `crm:${b.key}`, name: b.label, icon: sourceIcon(b.key),
          color: groupColor[b.group] ?? 'var(--text-faint)',
          cost: null,
          visits,
          leads: b.count,
          trend: crmLeadTrend(b.keys),
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

  const crmLabel   = settings.crm_name || 'your CRM'
  // ── Phones ────────────────────────────────────────────────────────────────
  const answered        = Math.max(0, crm.incoming - crm.missed)
  const answerRate      = crm.incoming > 0 ? answered / crm.incoming : 0
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const byWeekday = WEEKDAYS.map(() => ({ answered: 0, missed: 0 }))
  for (const [date, v] of crmDays) {
    const dow = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7
    byWeekday[dow].answered += Math.max(0, v.incoming - v.missed)
    byWeekday[dow].missed   += v.missed
  }



  // ── Keywords ──────────────────────────────────────────────────────────────
  // Two views of "are we being found for the right searches?": the terms the agency tracks (rank
  // tracker), and what people actually typed (Search Console).
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

  // ── Proof of progress ─────────────────────────────────────────────────────
  // A local business owner reads this page for one thing: is this working, and do these people
  // know what they're doing? So besides the results, surface the signals we control — how often
  // their ads show, how Google rates them, reviews, the work delivered — in plain words. Every
  // highlight below is picked only when it is actually true for the chosen dates.

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



  // ── KPI row ───────────────────────────────────────────────────────────────
  const paidDays = allDays
  const kpis: ReactNode[] = []
  if (hasCrmData) {
    kpis.push(
      <SparkMetricCard
        key="leads" label="Leads" value={fmtInt(crm.leads)}
        sub={sourcesComplete ? `${fmtInt(leadSources.paid)} paid, ${fmtInt(leadSources.organic)} organic` : 'new people who got in touch'}
        delta={delta(crm.leads, crmPrior.leads)} delay={0}
        sparkData={crmDays.map(([, v]) => ({ v: v.leads }))} sparkColor="var(--blue)"
      />,
      <SparkMetricCard
        key="calls" label="Phone calls" value={fmtInt(crm.calls)}
        sub={adCallCount > 0
          ? `${fmtInt(adCallCount)} paid calls from your Google Ads`
          : paidCalls > 0
            ? `${fmtInt(paidCalls)} paid calls`
            : 'tracked calls to the business'}
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

  /**
   * How much of "no clear source" the ad calls could account for.
   *
   * A caller who taps the number on an ad never lands on the website, so the CRM records no
   * visit and the lead reads as unsourced. Google counts those calls, which makes the slice
   * explainable rather than mysterious — but only as a bound, for two reasons: Google counts
   * calls where the CRM counts people, so one caller who rang twice is two calls and one lead;
   * and some of those callers were already customers, not new leads. So it is "up to", never
   * "plus", and it is capped by the number of unsourced leads there actually are.
   */

  /**
   * Spam that arrived through an ad. Spam is money when an ad paid for it, and the fix — a
   * negative keyword, a placement exclusion — needs someone to know it is happening.
   */
  const spamCounts: LeadSourceCounts = {}
  for (const row of data.ghl) addLeadSources(spamCounts, row.spam_sources)
  const spamFromAds = summariseLeadSources(spamCounts).paid

  // ── The sentence a business owner reads first ─────────────────────────────
  const headline: ReactNode = hasCrmData ? (
    <>
      You picked up <b>{fmtInt(crm.leads)} {crm.leads === 1 ? 'lead' : 'leads'}</b> over {periodLabel}.
      {/* Deliberately a second sentence, not a dash: these are activity counts, not a split of
          the lead total. Calls counts every inbound call including repeat and existing customers,
          where a lead is a person counted once, so the two never add up to the headline. Joined to
          it with a dash they read as a breakdown, and the arithmetic visibly fails. */}
      {crm.calls + crm.forms > 0 && <> Your phone rang <b>{fmtInt(crm.calls)}</b> {crm.calls === 1 ? 'time' : 'times'} and <b>{fmtInt(crm.forms)}</b> {crm.forms === 1 ? 'enquiry' : 'enquiries'} came through the website.</>}
      {crm.won > 0 && <> <b>{fmtInt(crm.won)}</b> {crm.won === 1 ? 'job was' : 'jobs were'} won{crm.wonValue > 0 && <>, worth <b>{fmt$(crm.wonValue)}</b></>}.</>}
      {/* Said out loud rather than quietly dropped: a client counting their own inbox will see a
          bigger number than this page does, and deserves to know why. */}
      {crm.spam > 0 && <> <b>{fmtInt(crm.spam)}</b> spam {crm.spam === 1 ? 'contact was' : 'contacts were'} left out{spamFromAds > 0 && <>, {fmtInt(spamFromAds)} of {crm.spam === 1 ? 'which came' : 'them through'} your ads</>}.</>}
      {adLeads > 0 && <> Google and Meta reported <b>{fmtInt(adLeads)}</b> {Math.round(adLeads) === 1 ? 'conversion' : 'conversions'} from your ads at <b>{fmtCurrency(adCpl)}</b> each{sourcesComplete && leadSources.paid > 0 && <>, and <b>{fmtInt(leadSources.paid)}</b> of your leads came through an ad</>}.{adCallCount > 0 && <> Google Ads also counted <b>{fmtInt(adCallCount)}</b> {adCallCount === 1 ? 'call' : 'calls'} straight from the ad.</>}</>}
    </>
  ) : adLeads > 0 ? (
    <>
      Your ads reported <b>{fmtInt(adLeads)} {Math.round(adLeads) === 1 ? 'conversion' : 'conversions'}</b> over {periodLabel}, at <b>{fmtCurrency(adCpl)}</b> each
      on <b>{fmt$(adSpend)}</b> of spend.
    </>
  ) : null

  return (
    <div className="ov-scope" style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <PageHeader title="Overview" fromDate={fromDate} toDate={toDate} compare={compare} />

      <main className="page ov-main">
        {noDataForWindow ? (
          <EmptyState
            title="Nothing to show for this period yet"
            description="Once your ads, website and phone tracking are connected, this page shows how many leads each of them brought in. Try a wider date range, or ask your account manager which sources are live."
            icon={<Compass size={22} />}
          />
        ) : (
          <>
            {/* The answer, and what the team has been doing. Side by side, because each is a
                couple of lines and stacking them spent a third of the screen on two sentences. */}
            <div className="ov4-top">
              <section className="ov4-lede" aria-label="Summary">
                {headline
                  ? <p>{headline}</p>
                  : <p>Your results for {periodLabel}.</p>}
              </section>
              {data.updates.length > 0 && (
                <aside className="ov4-team" aria-label="From your team">
                  <div className="ov4-team__head">
                    <span className="ov4-team__label">From your team</span>
                    <span className="ov4-team__count">
                      {data.updates.length} {data.updates.length === 1 ? 'update' : 'updates'}
                    </span>
                  </div>
                  <p className="ov4-team__body">
                    <time dateTime={data.updates[0].created_at.slice(0, 10)}>
                      {fmtShortDate(data.updates[0].created_at.slice(0, 10))}
                    </time>
                    {' — '}
                    {data.updates[0].title
                      ? `${data.updates[0].title}. `
                      : ''}
                    {alertPlainText(data.updates[0].content)}
                  </p>
                </aside>
              )}
            </div>

            {/* Six figures. Everything else on this page explains one of them. */}
            <div className="ov4-figs">
              <div className="ov4-fig">
                <p className="ov4-fig__label">Total leads</p>
                <p className="ov4-fig__value">
                  {fmtInt(crm.leads)}<DeltaPill value={delta(crm.leads, crmPrior.leads)} />
                </p>
                <p className="ov4-fig__sub">
                  {sourcesComplete
                    ? `${fmtInt(leadSources.paid)} paid · ${fmtInt(leadSources.organic)} organic`
                    : `vs ${fmtInt(crmPrior.leads)} last period`}
                </p>
              </div>
              <div className="ov4-fig">
                <p className="ov4-fig__label">Phone calls</p>
                <p className="ov4-fig__value">
                  {fmtInt(crm.calls)}<DeltaPill value={delta(crm.calls, crmPrior.calls)} />
                </p>
                <p className="ov4-fig__sub">
                  {adCallCount > 0 ? `${fmtInt(adCallCount)} came from your ads` : 'tracked to the business'}
                </p>
              </div>
              <div className="ov4-fig">
                <p className="ov4-fig__label">Web forms</p>
                <p className="ov4-fig__value">
                  {fmtInt(crm.forms)}<DeltaPill value={delta(crm.forms, crmPrior.forms)} />
                </p>
                <p className="ov4-fig__sub">sent from your website</p>
              </div>
              <div className="ov4-fig">
                <p className="ov4-fig__label">Opportunities</p>
                <p className="ov4-fig__value">
                  {fmtInt(crm.newOpps)}<DeltaPill value={delta(crm.newOpps, crmPrior.newOpps)} />
                </p>
                <p className="ov4-fig__sub">
                  {crm.leads > 0 ? `${fmtPct((crm.newOpps / crm.leads) * 100)} of leads` : 'opened in your CRM'}
                </p>
              </div>
              <div className="ov4-fig">
                <p className="ov4-fig__label">Calls answered</p>
                <p className="ov4-fig__value">{crm.incoming > 0 ? fmtPct(answerRate * 100) : '—'}</p>
                <p className="ov4-fig__sub">
                  {crm.incoming > 0 ? `${fmtInt(answered)} of ${fmtInt(crm.incoming)} picked up` : 'no incoming calls recorded'}
                </p>
              </div>
              <div className="ov4-fig">
                <p className="ov4-fig__label">Google rating</p>
                <p className="ov4-fig__value">
                  {reviews.rating > 0 ? reviews.rating.toFixed(1) : '—'}
                  {reviews.rating > 0 && <Star size={15} weight="fill" className="ov4-fig__star" aria-hidden />}
                </p>
                <p className="ov4-fig__sub">
                  {reviews.count > 0 ? `across ${fmtInt(reviews.count)} reviews` : 'no reviews yet'}
                </p>
              </div>
            </div>

            {/* How the leads arrived, and where from. */}
            <div className="ov4-split">
              <section className="card ov4-panel" aria-labelledby="ov4-daily-title">
                <div className="ov4-panel__head">
                  <h2 id="ov4-daily-title" className="ov4-panel__title">Leads day by day</h2>
                  <p className="ov4-panel__desc">
                    {fmtInt(crm.leads)} across {periodLabel}
                    {allDays.length > 0 && `, an average of ${(crm.leads / allDays.length).toFixed(1)} a day`}
                  </p>
                </div>
                <div className="ov4-panel__body">
                  <SpendChart
                    data={leadTrend}
                    spendLabel="Leads"
                    conversionsLabel="Web forms"
                    variant="count"
                    height={210}
                  />
                </div>
              </section>

              <section className="card ov4-panel" aria-labelledby="ov4-mix-title">
                <div className="ov4-panel__head">
                  <h2 id="ov4-mix-title" className="ov4-panel__title">Where your leads came from</h2>
                  {sourcesComplete && leadSources.total > 0 && (
                    <p className="ov4-panel__desc">
                      {fmtPct((leadSources.paid / leadSources.total) * 100)} from ads,
                      {' '}{fmtPct((leadSources.organic / leadSources.total) * 100)} found you themselves
                    </p>
                  )}
                </div>
                <div className="ov4-panel__body">
                  {sourcesComplete && leadSources.total > 0 && (
                    <div className="ov4-mixbar" role="img"
                         aria-label={`${fmtInt(leadSources.paid)} from ads, ${fmtInt(leadSources.organic)} organic`}>
                      <span className="ov4-mixbar__seg ov4-mixbar__seg--paid"
                            style={{ width: `${(leadSources.paid / leadSources.total) * 100}%` }} />
                      <span className="ov4-mixbar__seg ov4-mixbar__seg--organic"
                            style={{ width: `${(leadSources.organic / leadSources.total) * 100}%` }} />
                    </div>
                  )}
                  {channels.length > 0 ? (
                    <ul className="ov4-mix">
                      {channels.slice(0, 6).map(c => {
                        const share = crm.leads > 0 ? c.leads / crm.leads : 0
                        return (
                          <li key={c.key} className="ov4-mix__row">
                            <span className="ov4-mix__icon" style={{ color: c.color }}>{c.icon}</span>
                            <span className="ov4-mix__name">{c.name}</span>
                            <span className="ov4-mix__track" aria-hidden>
                              <span
                                className="ov4-mix__fill"
                                style={{ width: `${Math.max(share * 100, 1.5)}%`, background: c.color }}
                              />
                            </span>
                            <span className="ov4-mix__value">{fmtInt(c.leads)}</span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="ov4-empty">No lead sources recorded for these dates.</p>
                  )}
                </div>
              </section>
            </div>

            {/* One card per tab: the figure that matters, and the way through. */}
            <div className="ov4-cards">
              {hasPaidData && (
                <Link href="/dashboard/paid-ads" className="card ov4-card">
                  <span className="ov4-card__head">
                    <span className="ov4-card__title">How your ads did</span>
                    <span className="ov4-card__link">Paid Ads ›</span>
                  </span>
                  <span className="ov4-card__lead">
                    <span className="ov4-card__lead-label">Cost per lead</span>
                    <span className="ov4-card__lead-value">
                      {adLeads > 0 ? fmtCurrency(adCpl) : '—'}
                      <DeltaPill value={delta(adCpl, adCplPrior)} />
                    </span>
                  </span>
                  <span className="ov4-card__rows">
                    <span><span>Ad spend</span><b>{fmt$(adSpend)}</b></span>
                    {sourcesComplete && <span><span>Leads from ads</span><b>{fmtInt(leadSources.paid)}</b></span>}
                    <span><span>Conversions reported</span><b>{fmtInt(adLeads)}</b></span>
                  </span>
                </Link>
              )}

              {hasGbpData && (
                <Link href="/dashboard/seo?tab=local" className="card ov4-card">
                  <span className="ov4-card__head">
                    <span className="ov4-card__title">Your Google listing</span>
                    <span className="ov4-card__link">Listing ›</span>
                  </span>
                  <span className="ov4-card__lead">
                    <span className="ov4-card__lead-label">Listing views</span>
                    <span className="ov4-card__lead-value">
                      {fmtInt(gbpViews)}<DeltaPill value={delta(gbpViews, gbpPriorViews)} />
                    </span>
                  </span>
                  <span className="ov4-card__rows">
                    <span><span>Calls</span><b>{fmtInt(gbp.calls)}</b></span>
                    <span><span>Direction requests</span><b>{fmtInt(gbp.directions)}</b></span>
                    <span><span>Website visits</span><b>{fmtInt(gbp.website)}</b></span>
                  </span>
                </Link>
              )}

              {hasGscData && gscCurr && (
                <Link href="/dashboard/seo?tab=keywords" className="card ov4-card">
                  <span className="ov4-card__head">
                    <span className="ov4-card__title">What people search</span>
                    <span className="ov4-card__link">SEO ›</span>
                  </span>
                  <span className="ov4-card__lead">
                    <span className="ov4-card__lead-label">Clicks from search</span>
                    <span className="ov4-card__lead-value">
                      {fmtInt(gscCurr.totals.clicks)}
                      <DeltaPill value={delta(gscCurr.totals.clicks, gscPrior?.totals.clicks ?? 0)} />
                    </span>
                  </span>
                  <span className="ov4-card__rows">
                    <span><span>Times you appeared</span><b>{fmtInt(gscCurr.totals.impressions)}</b></span>
                    {topSearches.slice(0, 2).map(q => (
                      <span key={q.query}><span className="ov4-card__term">{q.query}</span><b>{fmtInt(q.clicks)}</b></span>
                    ))}
                  </span>
                </Link>
              )}

              {reviews.count > 0 && (
                <Link href="/dashboard/seo?tab=local" className="card ov4-card">
                  <span className="ov4-card__head">
                    <span className="ov4-card__title">What people say</span>
                    <span className="ov4-card__link">Google listing ›</span>
                  </span>
                  <span className="ov4-card__lead">
                    <span className="ov4-card__lead-label">Your rating</span>
                    <span className="ov4-card__lead-value">
                      {reviews.rating.toFixed(1)}
                      <Star size={16} weight="fill" className="ov4-fig__star" aria-hidden />
                    </span>
                  </span>
                  <span className="ov4-card__rows">
                    <span><span>Across</span><b>{fmtInt(reviews.count)} reviews</b></span>
                    <span><span>New this period</span><b>{fmtInt(reviews.gained)}</b></span>
                    {reputation && <span><span>Replied to</span><b>{fmtPct(reputation.replyRate)}</b></span>}
                  </span>
                </Link>
              )}
            </div>

            <p className="ov4-foot">
              Figures cover {fmtShortDate(iso(fromDate))} – {fmtShortDate(iso(toDate))}
              {showCompare && `, compared against the ${dayCount} days before`}.
              {hasGbpData && ' Google finishes counting listing activity a few days after the fact, so the most recent days usually rise a little.'}
            </p>
          </>
        )}
      </main>
    </div>
  )
}
