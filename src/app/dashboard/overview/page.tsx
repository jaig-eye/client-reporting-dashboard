// ─────────────────────────────────────────────────────────────────────────────
// Client Overview — /dashboard/overview   (dashboard v2)
//
// The cross-channel answer to "how is my marketing doing?" for a local service
// business. Leads lead: the KPI row counts the people who got in touch, and the
// channels underneath are read as streams that fed those leads — paid ads first,
// then everything the business earns without paying per click.
//
// Opt-in per client via clients.dashboard_v2. The original Summary page
// (/dashboard) is untouched and still serves every client without the flag.
//
// A card is rendered only when its connector is connected AND has data for the
// window; a stream band with no surviving cards is omitted entirely, so a client
// with only Google Ads sees a page about Google Ads rather than a wall of dashes.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
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
import ChannelSourceCard from './ChannelCard'
import SpendChart from '@/components/SpendChart'
import { ConnectorLogo } from '@/components/ConnectorLogo'
import { Compass, MapPin, LinkSimple } from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

/** Row caps. Every query is bounded so one noisy account can't stall the page. */
const MAX_ROWS = 10_000
const ROLLING_WEEKS = 12

function iso(d: Date) { return d.toISOString().split('T')[0] }
function addDays(d: Date, days: number) { return new Date(d.getTime() + days * 86_400_000) }
function fmtInt(n: number) { return Math.round(n).toLocaleString('en-US') }

/** Drop rows sharing a logical key — two connections to the same ad account double-count. */
function dedupeBy<T>(rows: T[], key: (r: T) => string): T[] {
  const seen = new Set<string>()
  return rows.filter(r => { const k = key(r); if (seen.has(k)) return false; seen.add(k); return true })
}

// ── row shapes ───────────────────────────────────────────────────────────────
type GoogleRow = { campaign_id: string; date: string; spend: number; clicks: number; conversions: number }
type MetaAdRow = {
  ad_id: string; campaign_id: string; date: string; spend: number; clicks: number
  actions: MetaAction[] | null; action_values: MetaAction[] | null
}
type AssignRow  = { campaign_id: string; display_mode: string; hidden: boolean }
type GhlRow     = { date: string; contacts_created: number; spam_leads: number; total_calls: number; forms_submitted: number }
type GbpRow     = { date: string; call_clicks: number; direction_clicks: number }
type Ga4Row     = { date: string; channel_group: string | null; sessions: number; engaged_sessions: number | null; bounce_rate: number | null }
type AhrefsRow  = { date: string; domain_rating: number | null; referring_domains: number | null }

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

    const GOOGLE_COLS = 'campaign_id,date,spend,clicks,conversions'
    const META_COLS   = 'ad_id,campaign_id,date,spend,clicks,actions,action_values'
    const GHL_COLS    = 'date,contacts_created,spam_leads,total_calls,forms_submitted'
    const GBP_COLS    = 'date,call_clicks,direction_clicks'
    const GA4_COLS    = 'date,channel_group,sessions,engaged_sessions,bounce_rate'

    const ga4Query = (a: string, b: string) => {
      const q = db.from('ga4_metrics').select(GA4_COLS)
        .eq('client_id', clientId).gte('date', a).lte('date', b).limit(MAX_ROWS)
      return ga4ConnectionId ? q.eq('connection_id', ga4ConnectionId) : q
    }

    const [
      gRes, gPriorRes, mRes, mPriorRes, gAssignRes, mAssignRes,
      ghlRes, ghlPriorRes, ghlRollRes, gbpRes, gbpPriorRes,
      ga4Res, ga4PriorRes, ahrefsRes,
    ] = await Promise.all([
      has.google
        ? db.from('google_ads_metrics').select(GOOGLE_COLS)
            .eq('client_id', clientId).gte('date', from).lte('date', to).limit(MAX_ROWS)
        : none,
      has.google && showCompare
        ? db.from('google_ads_metrics').select(GOOGLE_COLS)
            .eq('client_id', clientId).gte('date', priorFrom).lte('date', priorTo).limit(MAX_ROWS)
        : none,

      // Meta spend and conversions both come from the ad-level table — campaign-level
      // meta_ads_metrics lags and must never be summed for totals.
      has.meta
        ? db.from('meta_ads_ad_metrics').select(META_COLS)
            .eq('client_id', clientId).gte('date', from).lte('date', to).limit(MAX_ROWS)
        : none,
      has.meta && showCompare
        ? db.from('meta_ads_ad_metrics').select(META_COLS)
            .eq('client_id', clientId).gte('date', priorFrom).lte('date', priorTo).limit(MAX_ROWS)
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

      has.ga4 ? ga4Query(from, to)            : none,
      has.ga4 && showCompare ? ga4Query(priorFrom, priorTo) : none,

      // Ahrefs is a weekly snapshot, so the two most recent rows give value + movement.
      has.ahrefs
        ? db.from('ahrefs_metrics').select('date,domain_rating,referring_domains')
            .eq('client_id', clientId).order('date', { ascending: false }).limit(2)
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
    }
  },
  ['dashboard-overview'],
  { revalidate: 300, tags: ['client-metrics'] },
)

// Search Console has no synced table — it is read live from the API, so it gets its
// own longer cache window (same as the Search Console page).
const _getOverviewGSC = unstable_cache(
  async (connectionId: string, from: string, to: string, priorFrom: string | null, priorTo: string | null) => {
    const [curr, prior] = await Promise.all([
      fetchGSCLiveData(connectionId, from, to, 1),
      priorFrom && priorTo ? fetchGSCLiveData(connectionId, priorFrom, priorTo, 1) : Promise.resolve(null),
    ])
    return { curr, prior }
  },
  ['dashboard-overview-gsc'],
  { revalidate: 900, tags: ['client-metrics'] },
)

// ─── Page ────────────────────────────────────────────────────────────────────
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
  if (!(client as unknown as { dashboard_v2?: boolean | null }).dashboard_v2) redirect('/dashboard')

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
  const rawMode  = cookieStore.get('admin_raw_mode')?.value === '1'
  const adFuelCut = rawMode ? 0 : (client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut ?? 0)
  const billed = (raw: number) => (adFuelCut > 0 ? applyAdFuel(raw, adFuelCut) : raw)

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
  const hasMetaData   = meta.spend   > 0 || meta.leads   > 0

  // ── CRM: who actually got in touch ────────────────────────────────────────
  function sumGhl(rows: GhlRow[]) {
    let leads = 0, calls = 0, forms = 0
    const byDate = new Map<string, { leads: number; calls: number; forms: number }>()
    for (const r of rows) {
      // Spam is excluded from lead counts — GHL's own reporting does the same.
      const l = Math.max(0, (Number(r.contacts_created) || 0) - (Number(r.spam_leads) || 0))
      const c = Number(r.total_calls)     || 0
      const f = Number(r.forms_submitted) || 0
      leads += l; calls += c; forms += f
      const day = byDate.get(r.date) ?? { leads: 0, calls: 0, forms: 0 }
      day.leads += l; day.calls += c; day.forms += f
      byDate.set(r.date, day)
    }
    return { leads, calls, forms, byDate }
  }

  const crm      = sumGhl(data.ghl)
  const crmPrior = sumGhl(data.ghlPrior)
  const hasCrmData = data.ghl.length > 0 && (crm.leads > 0 || crm.calls > 0 || crm.forms > 0)

  const crmDays = Array.from(crm.byDate.entries()).sort(([a], [b]) => a.localeCompare(b))
  const leadTrend: DailyMetric[] = crmDays.map(([date, v]) => ({
    date, spend: v.calls, conversions: v.forms, clicks: 0, roas: 0,
  }))

  // 12 weeks of leads, bucketed to the Monday-agnostic week that ends on the range end.
  const rolling = sumGhl(data.ghlRolling)
  const weekBuckets = new Map<string, { leads: number; calls: number }>()
  for (const [date, v] of Array.from(rolling.byDate.entries())) {
    const offset = Math.floor((new Date(date + 'T00:00:00Z').getTime() - rollingFrom.getTime()) / 86_400_000)
    if (offset < 0) continue
    const weekStart = iso(addDays(rollingFrom, Math.floor(offset / 7) * 7))
    const bucket = weekBuckets.get(weekStart) ?? { leads: 0, calls: 0 }
    bucket.leads += v.leads; bucket.calls += v.calls
    weekBuckets.set(weekStart, bucket)
  }
  const rollingTrend: DailyMetric[] = Array.from(weekBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, spend: v.leads, conversions: v.calls, clicks: 0, roas: 0 }))

  // ── Local: Business Profile ───────────────────────────────────────────────
  const sumGbp = (rows: GbpRow[]) => rows.reduce(
    (acc, r) => ({
      calls:      acc.calls      + (Number(r.call_clicks)      || 0),
      directions: acc.directions + (Number(r.direction_clicks) || 0),
    }),
    { calls: 0, directions: 0 },
  )
  const gbp      = sumGbp(data.gbp)
  const gbpPrior = sumGbp(data.gbpPrior)
  const hasGbpData = data.gbp.length > 0 && (gbp.calls > 0 || gbp.directions > 0)

  // ── Local: GA4 ────────────────────────────────────────────────────────────
  // Rows with an empty channel_group are unattributed sessions GA4 itself leaves out
  // of Traffic Acquisition — including them would not reconcile with the GA4 UI.
  function sumGa4(rows: Ga4Row[]) {
    let sessions = 0, engaged = 0, bounceWeighted = 0
    const byChannel = new Map<string, number>()
    for (const r of rows) {
      if (!r.channel_group) continue
      const s = Number(r.sessions) || 0
      sessions       += s
      engaged        += Number(r.engaged_sessions) || 0
      bounceWeighted += (Number(r.bounce_rate) || 0) * s
      byChannel.set(r.channel_group, (byChannel.get(r.channel_group) ?? 0) + s)
    }
    const engagement = sessions === 0 ? 0
      : engaged > 0 ? engaged / sessions
      : 1 - bounceWeighted / sessions
    return { sessions, engagement, byChannel }
  }
  const ga4      = sumGa4(data.ga4)
  const ga4Prior = sumGa4(data.ga4Prior)
  const hasGa4Data = ga4.sessions > 0

  const channelRows = Array.from(ga4.byChannel.entries())
    .map(([name, sessions]) => ({ name, sessions, share: ga4.sessions > 0 ? sessions / ga4.sessions : 0 }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 6)

  // ── Local: Search Console (live) + Ahrefs (weekly snapshot) ───────────────
  const gscCurr  = gsc.curr  as GSCSummaryResult | null
  const gscPrior = gsc.prior as GSCSummaryResult | null
  const hasGscData = !!gscCurr && gscCurr.totals.impressions > 0

  const ahrefsLatest = data.ahrefs[0]
  const ahrefsPrev   = data.ahrefs[1]
  const hasAhrefsData = !!ahrefsLatest && (ahrefsLatest.referring_domains != null || ahrefsLatest.domain_rating != null)

  // ── Deltas — only when a comparison is on, and only when there is a base ───
  const delta = (curr: number, prior: number) => (showCompare ? calcDelta(curr, prior) : undefined)
  /** For metrics where smaller is better (cost, search position): report the improvement. */
  const deltaLowerIsBetter = (curr: number, prior: number) => {
    const d = delta(curr, prior)
    return d === undefined ? undefined : -d
  }

  const qs = new URLSearchParams({ from: iso(fromDate), to: iso(toDate) })
  if (compare !== 'none') qs.set('compare', compare)
  const link = (path: string) => `${path}?${qs.toString()}`

  const dayCount = Math.max(1, Math.round(periodMs / 86_400_000) + 1)
  const periodLabel = dayCount === 1 ? 'today' : `the last ${dayCount} days`

  // ── Stream bands ──────────────────────────────────────────────────────────
  const paidCards: React.ReactNode[] = []
  if (hasGoogleData) {
    paidCards.push(
      <ChannelSourceCard
        key="google_ads"
        title="Google Ads"
        color="var(--blue)"
        href={link('/dashboard/google-ads')}
        icon={<ConnectorLogo type="google_ads" size={16} aria-hidden />}
        metrics={[
          { label: 'Spend',         value: fmt$(google.spend),  delta: delta(google.spend, googlePrior.spend) },
          { label: 'Leads',         value: fmtInt(google.leads), delta: delta(google.leads, googlePrior.leads) },
          { label: 'Cost per lead', value: google.leads > 0 ? fmtCurrency(google.spend / google.leads) : '—',
            delta: deltaLowerIsBetter(
              google.leads > 0 ? google.spend / google.leads : 0,
              googlePrior.leads > 0 ? googlePrior.spend / googlePrior.leads : 0,
            ) },
          { label: 'Conv. rate',    value: google.clicks > 0 ? `${((google.leads / google.clicks) * 100).toFixed(1)}%` : '—',
            delta: delta(
              google.clicks > 0 ? google.leads / google.clicks : 0,
              googlePrior.clicks > 0 ? googlePrior.leads / googlePrior.clicks : 0,
            ) },
        ]}
      />,
    )
  }
  if (hasMetaData) {
    paidCards.push(
      <ChannelSourceCard
        key="meta_ads"
        title="Meta Ads"
        color="var(--ov-indigo)"
        href={link('/dashboard/meta-ads')}
        icon={<ConnectorLogo type="meta_ads" size={16} aria-hidden />}
        metrics={[
          { label: 'Spend',         value: fmt$(meta.spend),  delta: delta(meta.spend, metaPrior.spend) },
          { label: 'Leads',         value: fmtInt(meta.leads), delta: delta(meta.leads, metaPrior.leads) },
          { label: 'Cost per lead', value: meta.leads > 0 ? fmtCurrency(meta.spend / meta.leads) : '—',
            delta: deltaLowerIsBetter(
              meta.leads > 0 ? meta.spend / meta.leads : 0,
              metaPrior.leads > 0 ? metaPrior.spend / metaPrior.leads : 0,
            ) },
          { label: 'Conv. rate',    value: meta.clicks > 0 ? `${((meta.leads / meta.clicks) * 100).toFixed(1)}%` : '—',
            delta: delta(
              meta.clicks > 0 ? meta.leads / meta.clicks : 0,
              metaPrior.clicks > 0 ? metaPrior.leads / metaPrior.clicks : 0,
            ) },
        ]}
      />,
    )
  }

  const localCards: React.ReactNode[] = []
  if (hasGbpData) {
    localCards.push(
      <ChannelSourceCard
        key="gbp"
        title="Business Profile"
        color="var(--green)"
        href={link('/dashboard/seo/gbp')}
        icon={<MapPin size={16} weight="fill" aria-hidden />}
        metrics={[
          { label: 'Calls',      value: fmtInt(gbp.calls),      delta: delta(gbp.calls, gbpPrior.calls) },
          { label: 'Directions', value: fmtInt(gbp.directions), delta: delta(gbp.directions, gbpPrior.directions) },
        ]}
      />,
    )
  }
  if (hasGscData && gscCurr) {
    localCards.push(
      <ChannelSourceCard
        key="gsc"
        title="Google Search"
        color="var(--ov-teal)"
        href={link('/dashboard/seo/search-console')}
        icon={<ConnectorLogo type="google_search_console" size={16} aria-hidden />}
        metrics={[
          { label: 'Visits from search', value: fmtInt(gscCurr.totals.clicks),
            delta: gscPrior ? delta(gscCurr.totals.clicks, gscPrior.totals.clicks) : undefined },
          { label: 'Avg. position',      value: gscCurr.totals.position > 0 ? gscCurr.totals.position.toFixed(1) : '—',
            delta: gscPrior ? deltaLowerIsBetter(gscCurr.totals.position, gscPrior.totals.position) : undefined },
        ]}
      />,
    )
  }
  if (hasGa4Data) {
    localCards.push(
      <ChannelSourceCard
        key="ga4"
        title="Website"
        color="var(--amber)"
        href={link('/dashboard/analytics')}
        icon={<ConnectorLogo type="google_analytics" size={16} aria-hidden />}
        metrics={[
          { label: 'Sessions', value: fmtInt(ga4.sessions), delta: delta(ga4.sessions, ga4Prior.sessions) },
          { label: 'Engaged',  value: `${(ga4.engagement * 100).toFixed(0)}%`, delta: delta(ga4.engagement, ga4Prior.engagement) },
        ]}
      />,
    )
  }
  if (hasAhrefsData && ahrefsLatest) {
    localCards.push(
      <ChannelSourceCard
        key="ahrefs"
        title="Search visibility"
        color="var(--ov-violet)"
        href={link('/dashboard/seo/authority')}
        icon={<LinkSimple size={16} weight="bold" aria-hidden />}
        metrics={[
          { label: 'Linking sites', value: ahrefsLatest.referring_domains != null ? fmtInt(ahrefsLatest.referring_domains) : '—',
            delta: ahrefsPrev?.referring_domains ? calcDelta(ahrefsLatest.referring_domains ?? 0, ahrefsPrev.referring_domains) : undefined },
          { label: 'Site strength', value: ahrefsLatest.domain_rating != null ? ahrefsLatest.domain_rating.toFixed(1) : '—',
            delta: ahrefsPrev?.domain_rating ? calcDelta(ahrefsLatest.domain_rating ?? 0, ahrefsPrev.domain_rating) : undefined },
        ]}
      />,
    )
  }

  // Ahrefs is a standing snapshot rather than activity inside the window, so it alone is not
  // evidence that there is anything to report — otherwise a client who picks a range from
  // before they joined lands on a single lonely card with nothing to explain it.
  const noDataForWindow = !hasCrmData && !hasGoogleData && !hasMetaData
    && !hasGbpData && !hasGa4Data && !hasGscData

  // Channel swatches: named channels keep a stable hue, anything else rotates.
  const CHANNEL_COLOR: Record<string, string> = {
    'Organic Search': 'var(--green)',
    'Paid Search':    'var(--blue)',
    'Paid Social':    'var(--ov-indigo)',
    'Direct':         'var(--ov-violet)',
    'Referral':       'var(--ov-teal)',
    'Organic Social': 'var(--amber)',
    'Email':          'var(--ov-teal)',
  }
  const FALLBACK_COLORS = ['var(--blue)', 'var(--green)', 'var(--amber)', 'var(--ov-violet)', 'var(--ov-teal)', 'var(--text-faint)']

  // ── KPI row ───────────────────────────────────────────────────────────────
  const kpis: React.ReactNode[] = []
  if (hasCrmData) {
    kpis.push(
      <SparkMetricCard
        key="leads" label="Leads" value={fmtInt(crm.leads)} sub="new people who got in touch"
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
  if (hasGoogleData || hasMetaData) {
    const paidDays = Array.from(new Set(
      [...Array.from(google.byDate.keys()), ...Array.from(meta.byDate.keys())],
    )).sort()
    kpis.push(
      <SparkMetricCard
        key="ad-leads" label="Leads from ads" value={fmtInt(adLeads)}
        // Ad platforms count a conversion their own way, so the paid figure can exceed the
        // CRM's contact count. Claiming "121% of all leads" would just look broken.
        sub={hasCrmData && crm.leads > 0 && adLeads <= crm.leads
          ? `${Math.round((adLeads / crm.leads) * 100)}% of all leads`
          : 'Google + Meta conversions'}
        delta={delta(adLeads, adLeadsPrior)} delay={3}
        sparkData={paidDays.map(d => ({ v: (google.byDate.get(d)?.leads ?? 0) + (meta.byDate.get(d)?.leads ?? 0) }))}
        sparkColor="var(--amber)"
      />,
      <SparkMetricCard
        key="ad-cpl" label="Cost per ad lead" value={adLeads > 0 ? fmtCurrency(adCpl) : '—'}
        sub={`from ${fmt$(adSpend)} of ad spend`}
        delta={delta(adCpl, adCplPrior)} invertDelta delay={4}
        sparkData={paidDays.map(d => ({ v: (google.byDate.get(d)?.spend ?? 0) + (meta.byDate.get(d)?.spend ?? 0) }))}
        sparkColor="var(--ov-teal)"
      />,
    )
  }

  // ── The sentence a business owner reads first ─────────────────────────────
  const headline: React.ReactNode = hasCrmData ? (
    <>
      You picked up <b>{fmtInt(crm.leads)} {crm.leads === 1 ? 'lead' : 'leads'}</b> over {periodLabel}
      {crm.calls + crm.forms > 0 && <> — <b>{fmtInt(crm.calls)}</b> by phone and <b>{fmtInt(crm.forms)}</b> through the website</>}.
      {adLeads > 0 && <> Ads brought in <b>{fmtInt(adLeads)}</b> of them at <b>{fmtCurrency(adCpl)}</b> each.</>}
    </>
  ) : adLeads > 0 ? (
    <>
      Your ads brought in <b>{fmtInt(adLeads)} {adLeads === 1 ? 'lead' : 'leads'}</b> over {periodLabel}, at <b>{fmtCurrency(adCpl)}</b> each
      on <b>{fmt$(adSpend)}</b> of spend.
    </>
  ) : null

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

            {kpis.length > 0 && <div className="stat-grid">{kpis}</div>}

            {(paidCards.length > 0 || localCards.length > 0) && (
              <div className="ov-bands">
                {paidCards.length > 0 && (
                  <section className="ov-band">
                    <div className="ov-band__head">
                      <span className="ov-band__dot" style={{ background: 'var(--blue)' }} aria-hidden />
                      <h2 className="section-label" style={{ color: 'var(--text-secondary)', margin: 0 }}>Paid ads</h2>
                      <span className="ov-band__rule" aria-hidden />
                      <span className="ov-band__note">{fmt$(adSpend)} spent</span>
                    </div>
                    <div className="ov-band__cards">{paidCards}</div>
                  </section>
                )}

                {localCards.length > 0 && (
                  <section className="ov-band">
                    <div className="ov-band__head">
                      <span className="ov-band__dot" style={{ background: 'var(--green)' }} aria-hidden />
                      <h2 className="section-label" style={{ color: 'var(--text-secondary)', margin: 0 }}>Local &amp; organic</h2>
                      <span className="ov-band__rule" aria-hidden />
                      <span className="ov-band__note">nothing paid per click</span>
                    </div>
                    <div className="ov-band__cards">{localCards}</div>
                  </section>
                )}
              </div>
            )}

            {(leadTrend.length > 1 || channelRows.length > 0) && (
              <div className="ov-split">
                {leadTrend.length > 1 && (
                  <section className="card" style={{ padding: '1.25rem' }}>
                    <div className="ov-chart-head">
                      <h2 className="section-title">Leads day by day</h2>
                      <p className="section-desc">Phone calls and web forms, {iso(fromDate)} – {iso(toDate)}</p>
                    </div>
                    <SpendChart
                      data={leadTrend}
                      spendLabel="Phone calls"
                      conversionsLabel="Web forms"
                      variant="count"
                    />
                  </section>
                )}

                {channelRows.length > 0 && (
                  <section className="card ov-panel" style={{ padding: '1.25rem' }}>
                    <div className="ov-chart-head">
                      <h2 className="section-title">Where visitors come from</h2>
                      <p className="section-desc">{fmtInt(ga4.sessions)} website sessions this period</p>
                    </div>
                    <ul className="ov-share">
                      {channelRows.map((c, i) => {
                        const color = CHANNEL_COLOR[c.name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
                        return (
                          <li key={c.name} className="ov-share__row">
                            <span className="ov-share__name">{c.name}</span>
                            <span className="ov-share__val">{(c.share * 100).toFixed(0)}%</span>
                            <span className="ov-share__track">
                              <span className="ov-share__fill" style={{ width: `${Math.max(2, c.share * 100)}%`, background: color }} />
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {rollingTrend.length > 1 && (
              <section className="card" style={{ padding: '1.25rem' }}>
                <div className="ov-chart-head">
                  <h2 className="section-title">Leads week by week</h2>
                  <p className="section-desc">The last {ROLLING_WEEKS} weeks, whatever date range is selected above</p>
                </div>
                <SpendChart
                  data={rollingTrend}
                  spendLabel="Leads that week"
                  conversionsLabel="Phone calls"
                  variant="count"
                />
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
