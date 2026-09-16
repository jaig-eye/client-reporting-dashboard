// ─────────────────────────────────────────────────────────────────────────────
// Period Comparison — /dashboard/comparison
//
// One page that puts this period beside the one before it, for every channel a client has:
// Google Ads, Meta Ads, Google Analytics, Search Console, their Google listing and the CRM.
// The other pages answer "how are we doing"; this one answers "compared with what".
//
// A smaller cost is an improvement, so cost per lead, cost per click, cost per thousand and
// average position are marked lowerIsBetter and coloured the other way round.
//
// Every figure follows the rules the rest of the dashboard uses: Meta spend and conversions come
// from the ad-level table through resolveMetaConversions, hidden campaigns are left out, and spend
// is billed with the client's Ad Fuel cut.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies }              from 'next/headers'
import { redirect }             from 'next/navigation'
import { unstable_cache }       from 'next/cache'
import { createAdminClient }    from '@/lib/supabase/server'
import { resolveDashboardRange } from '@/lib/dateRange'
import { getAgencySettings }    from '@/lib/agency-settings'
import { applyAdFuel, resolveMetaConversions } from '@/lib/metrics'
import { fetchAllRows }         from '@/lib/fetchAllRows'
import { fetchGSCLiveData }     from '@/lib/gsc-live'
import type { GSCSummaryResult } from '@/lib/gsc-live'
import type { Client, ClientConnection, Connector, MetaAction } from '@/lib/types'
import PageHeader               from '@/components/dashboard/PageHeader'
import EmptyState               from '@/components/dashboard/EmptyState'
import ComparisonTable from './ComparisonTable'
import { formatMetric, percentChange, isImprovement, type ComparisonSection, type ComparisonMetric } from './format'
import { ChartBar }             from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 5000

const iso = (d: Date) => d.toISOString().split('T')[0]
const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const rangeLabel = (a: Date, b: Date) => `${fmtDay(a)} – ${fmtDay(b)}`

type GoogleRow = { campaign_id: string; date: string; spend: number; clicks: number; impressions: number; conversions: number }
type MetaAdRow = { ad_id: string; campaign_id: string; date: string; spend: number; clicks: number; impressions: number; actions: MetaAction[] | null; action_values: MetaAction[] | null }
type AssignRow = { campaign_id: string; display_mode: string; hidden: boolean }
type Ga4Row    = { date: string; sessions: number; users: number; page_views: number; conversions: number | null; engaged_sessions: number | null; avg_session_duration: number | null }
type GhlRow    = { date: string; contacts_created: number; spam_leads: number; total_calls: number; incoming_calls: number; missed_calls: number; forms_submitted: number; won_opportunities: number; won_value: number | string }
type GbpRow    = { date: string; views_search: number | null; views_maps: number | null; call_clicks: number; direction_clicks: number; website_clicks: number | null }
type CallRow   = { phone_calls: number; calls_from_ad: number }

const num = (v: unknown) => Number(v) || 0

function dedupeBy<T>(rows: T[], key: (r: T) => string): T[] {
  const seen = new Set<string>()
  return rows.filter(r => { const k = key(r); if (seen.has(k)) return false; seen.add(k); return true })
}

interface Connected { google: boolean; meta: boolean; ghl: boolean; gbp: boolean; ga4: boolean }

// Cached 5 minutes, busted by revalidateTag('client-metrics') in the sync cron.
const _getComparisonData = unstable_cache(
  async (
    clientId: string,
    ga4ConnectionId: string | null,
    from: string, to: string,
    priorFrom: string, priorTo: string,
    has: Connected,
  ) => {
    const db   = createAdminClient()
    const none = Promise.resolve({ data: [] as never[] })

    const GOOGLE_COLS = 'campaign_id,date,spend,clicks,impressions,conversions'
    const META_COLS   = 'ad_id,campaign_id,date,spend,clicks,impressions,actions,action_values'
    const GA4_COLS    = 'date,sessions,users,page_views,conversions,engaged_sessions,avg_session_duration'
    const GHL_COLS    = 'date,contacts_created,spam_leads,total_calls,incoming_calls,missed_calls,forms_submitted,won_opportunities,won_value'
    const GBP_COLS    = 'date,views_search,views_maps,call_clicks,direction_clicks,website_clicks'
    const CALL_COLS   = 'phone_calls,calls_from_ad'

    // Campaigns × days passes the API's 1000-row cap, so the ad tables are read a page at a time.
    const paged = <T,>(table: string, cols: string, a: string, b: string) =>
      fetchAllRows<T>((lo, hi) => db.from(table).select(cols)
        .eq('client_id', clientId).gte('date', a).lte('date', b)
        .order('date').order('id').range(lo, hi), { maxRows: 50_000 }).then(data => ({ data }))

    const ga4Query = (a: string, b: string) => {
      const q = db.from('ga4_metrics').select(GA4_COLS)
        .eq('client_id', clientId).gte('date', a).lte('date', b).limit(MAX_ROWS)
      return ga4ConnectionId ? q.eq('connection_id', ga4ConnectionId) : q
    }
    const simple = (table: string, cols: string, a: string, b: string) =>
      db.from(table).select(cols).eq('client_id', clientId).gte('date', a).lte('date', b).limit(MAX_ROWS)

    const [
      gRes, gPriorRes, mRes, mPriorRes, assignRes,
      ga4Res, ga4PriorRes, ghlRes, ghlPriorRes,
      gbpRes, gbpPriorRes, callsRes, callsPriorRes,
    ] = await Promise.all([
      has.google ? paged<GoogleRow>('google_ads_metrics', GOOGLE_COLS, from, to) : none,
      has.google ? paged<GoogleRow>('google_ads_metrics', GOOGLE_COLS, priorFrom, priorTo) : none,
      has.meta   ? paged<MetaAdRow>('meta_ads_ad_metrics', META_COLS, from, to) : none,
      has.meta   ? paged<MetaAdRow>('meta_ads_ad_metrics', META_COLS, priorFrom, priorTo) : none,
      has.google || has.meta
        ? db.from('client_campaign_assignments').select('campaign_id,display_mode,hidden').eq('client_id', clientId).limit(2000)
        : none,
      has.ga4 ? ga4Query(from, to) : none,
      has.ga4 ? ga4Query(priorFrom, priorTo) : none,
      has.ghl ? simple('ghl_metrics', GHL_COLS, from, to) : none,
      has.ghl ? simple('ghl_metrics', GHL_COLS, priorFrom, priorTo) : none,
      has.gbp ? simple('gbp_metrics', GBP_COLS, from, to) : none,
      has.gbp ? simple('gbp_metrics', GBP_COLS, priorFrom, priorTo) : none,
      // Calls straight from a Google ad (migration 218). Before that table exists the read fails
      // quietly and the row is left out.
      has.google ? simple('google_ads_call_metrics', CALL_COLS, from, to) : none,
      has.google ? simple('google_ads_call_metrics', CALL_COLS, priorFrom, priorTo) : none,
    ])

    return {
      google:      (gRes.data      ?? []) as unknown as GoogleRow[],
      googlePrior: (gPriorRes.data ?? []) as unknown as GoogleRow[],
      meta:        (mRes.data      ?? []) as unknown as MetaAdRow[],
      metaPrior:   (mPriorRes.data ?? []) as unknown as MetaAdRow[],
      assignments: (assignRes.data ?? []) as unknown as AssignRow[],
      ga4:         (ga4Res.data      ?? []) as unknown as Ga4Row[],
      ga4Prior:    (ga4PriorRes.data ?? []) as unknown as Ga4Row[],
      ghl:         (ghlRes.data      ?? []) as unknown as GhlRow[],
      ghlPrior:    (ghlPriorRes.data ?? []) as unknown as GhlRow[],
      gbp:         (gbpRes.data      ?? []) as unknown as GbpRow[],
      gbpPrior:    (gbpPriorRes.data ?? []) as unknown as GbpRow[],
      calls:       (callsRes.data      ?? []) as unknown as CallRow[],
      callsPrior:  (callsPriorRes.data ?? []) as unknown as CallRow[],
    }
  },
  ['dashboard-comparison-v1'],
  { revalidate: 300, tags: ['client-metrics'] },
)

// Search Console is read live from its API, so it keeps its own longer window.
const _getComparisonGSC = unstable_cache(
  async (connectionId: string, from: string, to: string, priorFrom: string, priorTo: string) => {
    const [curr, prior] = await Promise.all([
      fetchGSCLiveData(connectionId, from, to, 1),
      fetchGSCLiveData(connectionId, priorFrom, priorTo, 1),
    ])
    return { curr, prior }
  },
  ['dashboard-comparison-gsc-v1'],
  { revalidate: 900, tags: ['client-metrics'] },
)

export default async function ComparisonPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>
}) {
  const cookieStore = await cookies()
  const params      = await searchParams
  const token       = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const db = createAdminClient()
  const [{ data: clientData }, settings] = await Promise.all([
    db.from('clients').select('*').eq('dashboard_token', token).maybeSingle(),
    getAgencySettings(),
  ])
  const client = clientData as Client | null
  if (!client) redirect('/access')

  const { data: connectionsData } = await db
    .from('client_connections')
    .select('*, connector:connectors(id, type, label)')
    .eq('client_id', client.id)
    .eq('status', 'active')

  const connections = (connectionsData ?? []) as (ClientConnection & { connector: Pick<Connector, 'id' | 'type' | 'label'> })[]
  const hiddenTypes = new Set<string>(settings.hidden_connector_types ?? [])
  const isOn = (type: string) => !hiddenTypes.has(type) && connections.some(c => c.connector.type === type)
  const has: Connected = {
    google: isOn('google_ads'),
    meta:   isOn('meta_ads'),
    ghl:    isOn('ghl'),
    gbp:    isOn('google_business_profile'),
    ga4:    isOn('google_analytics'),
  }
  const ga4ConnectionId = connections
    .filter(c => c.connector.type === 'google_analytics')
    .sort((a, b) => (b.last_synced_at ?? '').localeCompare(a.last_synced_at ?? ''))[0]?.id ?? null
  const gscConnectionId = hiddenTypes.has('google_search_console')
    ? null
    : connections.find(c => c.connector.type === 'google_search_console')?.id ?? null

  const { fromDate, toDate } = resolveDashboardRange(params)
  // This page only exists to compare, so with no comparison chosen it uses the period before.
  const compare  = params.compare === 'last_year' ? 'last_year' : 'prior_period'
  const periodMs = toDate.getTime() - fromDate.getTime()
  let priorFrom: Date, priorTo: Date
  if (compare === 'last_year') {
    priorFrom = new Date(fromDate); priorFrom.setFullYear(priorFrom.getFullYear() - 1)
    priorTo   = new Date(toDate);   priorTo.setFullYear(priorTo.getFullYear() - 1)
  } else {
    priorTo   = new Date(fromDate.getTime() - 86_400_000)
    priorFrom = new Date(priorTo.getTime() - periodMs)
  }

  const [data, gsc] = await Promise.all([
    _getComparisonData(client.id, ga4ConnectionId, iso(fromDate), iso(toDate), iso(priorFrom), iso(priorTo), has),
    gscConnectionId
      ? _getComparisonGSC(gscConnectionId, iso(fromDate), iso(toDate), iso(priorFrom), iso(priorTo))
      : Promise.resolve({ curr: null, prior: null }),
  ])

  const rawMode   = cookieStore.get('admin_raw_mode')?.value === '1'
  const adFuelCut = rawMode ? 0 : (client.ad_fuel_cut != null ? client.ad_fuel_cut : settings.ad_fuel_cut ?? 0)
  const billed    = (raw: number) => (adFuelCut > 0 ? applyAdFuel(raw, adFuelCut) : raw)
  const assignmentMap = new Map(data.assignments.map(a => [a.campaign_id, a]))

  // ── Totals per channel ─────────────────────────────────────────────────────
  const sumGoogle = (rows: GoogleRow[]) => dedupeBy(rows, r => `${r.campaign_id}_${r.date}`).reduce(
    (acc, r) => {
      if (assignmentMap.get(String(r.campaign_id || ''))?.hidden) return acc
      return {
        spend:       acc.spend       + billed(num(r.spend)),
        clicks:      acc.clicks      + num(r.clicks),
        impressions: acc.impressions + num(r.impressions),
        conversions: acc.conversions + num(r.conversions),
      }
    },
    { spend: 0, clicks: 0, impressions: 0, conversions: 0 },
  )

  const sumMeta = (rows: MetaAdRow[]) => dedupeBy(rows, r => `${r.ad_id}_${r.date}`).reduce(
    (acc, r) => {
      const assignment = assignmentMap.get(String(r.campaign_id || ''))
      if (assignment?.hidden) return acc
      const isEcom  = (assignment?.display_mode ?? 'lead_gen') === 'ecommerce'
      const primary = isEcom
        ? (client.purchase_action ?? settings.default_purchase_action ?? 'purchase')
        : (client.lead_action ?? settings.default_lead_action ?? 'onsite_conversion.lead_grouped')
      const fallback = isEcom
        ? (client.purchase_action_fallback ?? settings.default_purchase_action_fallback ?? null)
        : (client.lead_action_fallback ?? settings.default_lead_action_fallback ?? 'lead')
      const { conversions } = resolveMetaConversions(r.actions, r.action_values, primary, fallback)
      return {
        spend:       acc.spend       + billed(num(r.spend)),
        clicks:      acc.clicks      + num(r.clicks),
        impressions: acc.impressions + num(r.impressions),
        conversions: acc.conversions + conversions,
      }
    },
    { spend: 0, clicks: 0, impressions: 0, conversions: 0 },
  )

  const sumGa4 = (rows: Ga4Row[]) => rows.reduce(
    (acc, r) => {
      const sessions = num(r.sessions)
      return {
        sessions,
        total:       acc.total       + sessions,
        users:       acc.users       + num(r.users),
        pageViews:   acc.pageViews   + num(r.page_views),
        conversions: acc.conversions + num(r.conversions),
        engaged:     acc.engaged     + num(r.engaged_sessions),
        durationWeighted: acc.durationWeighted + num(r.avg_session_duration) * sessions,
      }
    },
    { sessions: 0, total: 0, users: 0, pageViews: 0, conversions: 0, engaged: 0, durationWeighted: 0 },
  )

  const sumGhl = (rows: GhlRow[]) => rows.reduce(
    (acc, r) => ({
      leads:    acc.leads    + Math.max(0, num(r.contacts_created) - num(r.spam_leads)),
      calls:    acc.calls    + num(r.total_calls),
      missed:   acc.missed   + num(r.missed_calls),
      forms:    acc.forms    + num(r.forms_submitted),
      won:      acc.won      + num(r.won_opportunities),
      wonValue: acc.wonValue + num(r.won_value),
    }),
    { leads: 0, calls: 0, missed: 0, forms: 0, won: 0, wonValue: 0 },
  )

  const sumGbp = (rows: GbpRow[]) => rows.reduce(
    (acc, r) => ({
      views:      acc.views      + num(r.views_search) + num(r.views_maps),
      calls:      acc.calls      + num(r.call_clicks),
      directions: acc.directions + num(r.direction_clicks),
      website:    acc.website    + num(r.website_clicks),
    }),
    { views: 0, calls: 0, directions: 0, website: 0 },
  )

  // Google's own count and the per-call report cover slightly different calls; the larger is the
  // safer figure to show, the same rule the Overview uses.
  const sumCalls = (rows: CallRow[]) =>
    rows.reduce((acc, r) => acc + Math.max(num(r.phone_calls), num(r.calls_from_ad)), 0)

  const g = sumGoogle(data.google), gPrev = sumGoogle(data.googlePrior)
  const m = sumMeta(data.meta),     mPrev = sumMeta(data.metaPrior)
  const a = sumGa4(data.ga4),       aPrev = sumGa4(data.ga4Prior)
  const c = sumGhl(data.ghl),       cPrev = sumGhl(data.ghlPrior)
  const b = sumGbp(data.gbp),       bPrev = sumGbp(data.gbpPrior)
  const adCalls = sumCalls(data.calls), adCallsPrev = sumCalls(data.callsPrior)
  const gscCurr  = gsc.curr  as GSCSummaryResult | null
  const gscPrior = gsc.prior as GSCSummaryResult | null

  const per = (n: number, d: number) => (d > 0 ? n / d : 0)

  // ── Sections ───────────────────────────────────────────────────────────────
  const sections: ComparisonSection[] = []
  const metric = (
    label: string, current: number, previous: number,
    format: ComparisonMetric['format'],
    opts: { lowerIsBetter?: boolean; key?: boolean } = {},
  ): ComparisonMetric => ({ label, current, previous, format, ...opts })

  if (g.spend > 0 || g.clicks > 0 || gPrev.spend > 0) {
    sections.push({
      id: 'google_ads', name: 'Google Ads', color: 'var(--chan-google)',
      metrics: [
        metric('Spend',              g.spend,       gPrev.spend,       'money',  { key: true }),
        metric('Conversions',        g.conversions, gPrev.conversions, 'number', { key: true }),
        metric('Cost per conversion', per(g.spend, g.conversions), per(gPrev.spend, gPrev.conversions), 'money', { lowerIsBetter: true, key: true }),
        ...(adCalls > 0 || adCallsPrev > 0 ? [metric('Calls from the ad', adCalls, adCallsPrev, 'number', { key: true })] : []),
        metric('Clicks',             g.clicks,      gPrev.clicks,      'number'),
        metric('Impressions',        g.impressions, gPrev.impressions, 'number'),
        metric('Click-through rate', per(g.clicks, g.impressions), per(gPrev.clicks, gPrev.impressions), 'percent'),
        metric('Cost per click',     per(g.spend, g.clicks), per(gPrev.spend, gPrev.clicks), 'money', { lowerIsBetter: true }),
      ],
    })
  }

  if (m.spend > 0 || m.clicks > 0 || mPrev.spend > 0) {
    sections.push({
      id: 'meta_ads', name: 'Meta Ads', color: 'var(--chan-meta)',
      metrics: [
        metric('Spend',              m.spend,       mPrev.spend,       'money',  { key: true }),
        metric('Conversions',        m.conversions, mPrev.conversions, 'number', { key: true }),
        metric('Cost per conversion', per(m.spend, m.conversions), per(mPrev.spend, mPrev.conversions), 'money', { lowerIsBetter: true, key: true }),
        metric('Link clicks',        m.clicks,      mPrev.clicks,      'number'),
        metric('Impressions',        m.impressions, mPrev.impressions, 'number'),
        metric('Click-through rate', per(m.clicks, m.impressions), per(mPrev.clicks, mPrev.impressions), 'percent'),
        metric('Cost per 1,000 shown', per(m.spend, m.impressions) * 1000, per(mPrev.spend, mPrev.impressions) * 1000, 'money', { lowerIsBetter: true }),
      ],
    })
  }

  if (a.total > 0 || aPrev.total > 0) {
    sections.push({
      id: 'ga4', name: 'Website traffic', color: 'var(--chan-ga4)',
      metrics: [
        metric('Visitors',      a.users,       aPrev.users,       'number', { key: true }),
        metric('Visits',        a.total,       aPrev.total,       'number', { key: true }),
        metric('Conversions',   a.conversions, aPrev.conversions, 'number', { key: true }),
        metric('Pages viewed',  a.pageViews,   aPrev.pageViews,   'number'),
        metric('Engagement rate', per(a.engaged, a.total), per(aPrev.engaged, aPrev.total), 'percent'),
        metric('Time on site',  per(a.durationWeighted, a.total), per(aPrev.durationWeighted, aPrev.total), 'duration'),
      ],
    })
  }

  if (gscCurr && (gscCurr.totals.impressions > 0 || (gscPrior?.totals.impressions ?? 0) > 0)) {
    sections.push({
      id: 'search_console', name: 'Google search results', color: 'var(--chan-crm)',
      metrics: [
        metric('Clicks from search', gscCurr.totals.clicks,      gscPrior?.totals.clicks ?? 0,      'number', { key: true }),
        metric('Times you appeared', gscCurr.totals.impressions, gscPrior?.totals.impressions ?? 0, 'number', { key: true }),
        metric('Click-through rate', gscCurr.totals.ctr,         gscPrior?.totals.ctr ?? 0,         'percent'),
        metric('Average position',   gscCurr.totals.position,    gscPrior?.totals.position ?? 0,    'position', { lowerIsBetter: true, key: true }),
      ],
    })
  }

  if (b.views > 0 || b.calls > 0 || bPrev.calls > 0) {
    sections.push({
      id: 'business_profile', name: 'Google listing', color: 'var(--chan-listing)',
      metrics: [
        metric('Listing views',  b.views,      bPrev.views,      'number', { key: true }),
        metric('Calls',          b.calls,      bPrev.calls,      'number', { key: true }),
        metric('Directions',     b.directions, bPrev.directions, 'number', { key: true }),
        metric('Website visits', b.website,    bPrev.website,    'number'),
      ],
    })
  }

  const crmName = settings.crm_name ?? 'CRM'
  if (c.leads > 0 || cPrev.leads > 0) {
    sections.push({
      id: 'crm', name: crmName, color: 'var(--chan-google)',
      metrics: [
        metric('Leads',        c.leads,    cPrev.leads,    'number', { key: true }),
        metric('Phone calls',  c.calls,    cPrev.calls,    'number', { key: true }),
        metric('Web forms',    c.forms,    cPrev.forms,    'number', { key: true }),
        metric('Jobs won',     c.won,      cPrev.won,      'number', { key: true }),
        metric('Value of work won', c.wonValue, cPrev.wonValue, 'money'),
        metric('Missed calls', c.missed,   cPrev.missed,   'number', { lowerIsBetter: true }),
      ],
    })
  }

  // ── The four figures above the table ───────────────────────────────────────
  const adSpend      = g.spend + m.spend
  const adSpendPrev  = gPrev.spend + mPrev.spend
  const leads        = c.leads > 0 ? c.leads : g.conversions + m.conversions
  const leadsPrev    = cPrev.leads > 0 ? cPrev.leads : gPrev.conversions + mPrev.conversions
  const leadsLabel   = c.leads > 0 ? 'Total leads' : 'Reported conversions'
  const kpiList: ComparisonMetric[] = [
    { label: leadsLabel,   current: leads,    previous: leadsPrev,   format: 'number' },
    { label: 'Ad spend',   current: adSpend,  previous: adSpendPrev, format: 'money' },
    { label: c.leads > 0 ? 'Cost per lead' : 'Cost per conversion', current: per(adSpend, leads), previous: per(adSpendPrev, leadsPrev), format: 'money', lowerIsBetter: true },
    { label: 'Website conversions', current: a.conversions, previous: aPrev.conversions, format: 'number' },
  ]
  const kpis = kpiList.filter(k => k.current > 0 || k.previous > 0)

  const currentLabel  = rangeLabel(fromDate, toDate)
  const previousLabel = rangeLabel(priorFrom, priorTo)

  const header = (
    <PageHeader title="Period Comparison" accent="var(--ov-indigo)" fromDate={fromDate} toDate={toDate} compare={compare} />
  )

  if (sections.length === 0) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        {header}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <EmptyState
            title="Nothing to compare for these dates"
            description="Once a channel has figures for this period and the one before it, they appear here side by side. Try a wider date range."
            icon={<ChartBar size={22} />}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {header}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 sm:space-y-5">
        <p className="cmp-lede">
          <b>{currentLabel}</b> compared with <b>{previousLabel}</b>
          {params.compare === 'none' || !params.compare ? ' — the period before this one.' : '.'}
        </p>

        {kpis.length > 0 && (
          <section className="card cmp-kpis" aria-label="Headline comparison">
            {kpis.map(k => {
              const pct = percentChange(k.current, k.previous)
              const good = pct != null && isImprovement(pct, k.lowerIsBetter)
              return (
                <div key={k.label} className="cmp-kpi">
                  <p className="metric-label">{k.label}</p>
                  <p className="cmp-kpi__value">{formatMetric(k.current, k.format)}</p>
                  <p className="cmp-kpi__prev">
                    vs {formatMetric(k.previous, k.format)}
                    {pct != null && Math.abs(pct) >= 0.05 && (
                      <span className={`cmp-pill ${good ? 'cmp-pill--good' : 'cmp-pill--bad'}`}>
                        {pct > 0 ? '+' : '−'}{Math.abs(pct).toFixed(1)}%
                      </span>
                    )}
                  </p>
                </div>
              )
            })}
          </section>
        )}

        <ComparisonTable
          sections={sections}
          currentLabel={currentLabel}
          previousLabel={previousLabel}
          clientName={client.name}
        />
      </main>
    </div>
  )
}
