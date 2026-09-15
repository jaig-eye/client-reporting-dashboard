// ─────────────────────────────────────────────────────────────────────────────
// CRM — /dashboard/crm
//
// The lead-and-customer report a local business owner actually asks for: how many
// people got in touch, whether we picked up the phone, which forms they used, and
// how much work it turned into. The old /dashboard/crm/ghl page opened with a
// 30-row date table and made the reader do the arithmetic; this one leads with the
// answer and keeps the day-by-day detail underneath for anyone who wants to check.
//
// Every figure comes from `ghl_metrics`. The vendor is never named — the agency's
// white-label `crm_name` is, because clients know it by that name.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveDashboardRange } from '@/lib/dateRange'
import { getAgencySettings } from '@/lib/agency-settings'
import type { Client, DailyMetric } from '@/lib/types'
import PageHeader from '@/components/dashboard/PageHeader'
import EmptyState from '@/components/dashboard/EmptyState'
import SparkMetricCard from '@/components/SparkMetricCard'
import SpendChart from '@/components/SpendChart'
import { UsersThree } from '@phosphor-icons/react/dist/ssr'
import { addLeadSources, summariseLeadSources, type LeadSourceCounts, type LeadSourceGroup } from '@/lib/leadSources'

export const dynamic = 'force-dynamic'

// Only the columns this page renders. Verified against `ghl_metrics`.
const GHL_SELECT = [
  'date', 'contacts_created', 'spam_leads',
  'total_calls', 'incoming_calls', 'outgoing_calls', 'missed_calls',
  'forms_submitted', 'reviews_sent', 'reviews_received',
  'emails_sent', 'sms_sent',
  'new_opportunities', 'won_opportunities', 'lost_opportunities', 'won_value',
  'raw_data',
].join(',')

// A date range on this page is at most a couple of years of daily rows; the cap
// stops a hand-edited `?from=1970-01-01` from pulling the whole table.
const ROW_CAP = 1000

// Cached for 10 minutes, busted by revalidateTag('client-metrics') in the sync cron.
const _getCachedCrmMetrics = unstable_cache(
  async (
    clientId: string,
    from: string, to: string,
    priorFrom: string, priorTo: string,
    showCompare: boolean,
  ) => {
    const db = createAdminClient()
    const [{ data: rows }, { data: priorRows }] = await Promise.all([
      db.from('ghl_metrics').select(GHL_SELECT)
        .eq('client_id', clientId).gte('date', from).lte('date', to)
        .order('date', { ascending: true }).limit(ROW_CAP),
      showCompare
        ? db.from('ghl_metrics').select(GHL_SELECT)
            .eq('client_id', clientId).gte('date', priorFrom).lte('date', priorTo)
            .order('date', { ascending: true }).limit(ROW_CAP)
        : Promise.resolve({ data: [] as unknown[] }),
    ])
    return { rows: rows ?? [], priorRows: priorRows ?? [] }
  },
  ['dashboard-crm'],
  { revalidate: 600, tags: ['client-metrics'] }
)

const iso     = (d: Date) => d.toISOString().split('T')[0]
const fmtNum  = (n: number) => n.toLocaleString()
const fmt$    = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
const num     = (v: unknown) => Number(v) || 0

/** "Aug 15" — the date form an owner reads, not the ISO one. */
function prettyDate(value: string) {
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function share(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : 0
}

type FormBreakdownItem = { id: string; name: string; type: string; count: number }

type GhlRow = {
  date:               string
  contacts_created:   number
  spam_leads:         number
  total_calls:        number
  incoming_calls:     number
  outgoing_calls:     number
  missed_calls:       number
  forms_submitted:    number
  reviews_sent:       number
  reviews_received:   number
  emails_sent:        number
  sms_sent:           number
  new_opportunities:  number
  won_opportunities:  number
  lost_opportunities: number
  won_value:          number | string
  raw_data:           { form_breakdown?: FormBreakdownItem[]; lead_sources?: LeadSourceCounts } | null
}

/** Spam is excluded from the lead count the same way the CRM's own report excludes it. */
const realLeads = (r: GhlRow) => Math.max(0, num(r.contacts_created) - num(r.spam_leads))

function sumRows(arr: GhlRow[]) {
  return arr.reduce((a, r) => ({
    leads:    a.leads    + realLeads(r),
    spam:     a.spam     + num(r.spam_leads),
    calls:    a.calls    + num(r.total_calls),
    incoming: a.incoming + num(r.incoming_calls),
    outgoing: a.outgoing + num(r.outgoing_calls),
    missed:   a.missed   + num(r.missed_calls),
    forms:    a.forms    + num(r.forms_submitted),
    reviews:  a.reviews  + num(r.reviews_received),
    reviewsSent: a.reviewsSent + num(r.reviews_sent),
    emails:   a.emails   + num(r.emails_sent),
    sms:      a.sms      + num(r.sms_sent),
    newOpps:  a.newOpps  + num(r.new_opportunities),
    wonOpps:  a.wonOpps  + num(r.won_opportunities),
    lostOpps: a.lostOpps + num(r.lost_opportunities),
    wonValue: a.wonValue + num(r.won_value),
  }), {
    leads: 0, spam: 0, calls: 0, incoming: 0, outgoing: 0, missed: 0, forms: 0,
    reviews: 0, reviewsSent: 0, emails: 0, sms: 0,
    newOpps: 0, wonOpps: 0, lostOpps: 0, wonValue: 0,
  })
}

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>
}) {
  const cookieStore = await cookies()
  const params      = await searchParams

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const db = createAdminClient()
  const [{ data: clientData }, settings] = await Promise.all([
    db.from('clients').select('*').eq('dashboard_token', token).maybeSingle(),
    getAgencySettings(),
  ])
  const client = clientData as Client | null
  if (!client) redirect('/access')

  const crmName = settings.crm_name ?? 'CRM'

  const { fromDate, toDate } = resolveDashboardRange(params)
  const compare     = params.compare ?? 'none'
  const showCompare = compare !== 'none'

  const periodMs = toDate.getTime() - fromDate.getTime()
  const dayCount = Math.max(1, Math.round(periodMs / 86_400_000) + 1)
  let priorFrom: Date
  let priorTo:   Date
  if (compare === 'last_year') {
    priorFrom = new Date(fromDate); priorFrom.setFullYear(priorFrom.getFullYear() - 1)
    priorTo   = new Date(toDate);   priorTo.setFullYear(priorTo.getFullYear() - 1)
  } else {
    priorTo   = new Date(fromDate.getTime() - 86_400_000)
    priorFrom = new Date(priorTo.getTime() - periodMs)
  }
  const priorLabel = compare === 'last_year' ? 'the same period last year' : `the previous ${dayCount} days`

  const { rows, priorRows } = await _getCachedCrmMetrics(
    client.id,
    iso(fromDate), iso(toDate),
    iso(priorFrom), iso(priorTo),
    showCompare,
  )

  const data      = rows      as unknown as GhlRow[]
  const priorData = priorRows as unknown as GhlRow[]

  const t  = sumRows(data)
  const pt = sumRows(priorData)

  /** Percent change vs the compare period, or undefined when there is nothing to compare to. */
  function delta(curr: number, prev: number): number | undefined {
    if (!showCompare || prev === 0) return undefined
    return ((curr - prev) / prev) * 100
  }

  // ── Derived answers ───────────────────────────────────────────────────────
  const answered   = Math.max(0, t.incoming - t.missed)
  const missedRate = share(t.missed, t.incoming)
  const closable   = t.wonOpps + t.lostOpps
  const winRate    = share(t.wonOpps, closable)
  const avgJob     = t.wonOpps > 0 ? t.wonValue / t.wonOpps : 0
  const spamShare  = share(t.spam, t.leads + t.spam)
  const leadDelta  = delta(t.leads, pt.leads)
  const busiest    = data.reduce<GhlRow | null>((best, r) => (!best || realLeads(r) > realLeads(best) ? r : best), null)

  // Forms and surveys, aggregated across every day in the range.
  const formAgg = new Map<string, { name: string; type: string; count: number }>()
  for (const row of data) {
    for (const f of row.raw_data?.form_breakdown ?? []) {
      if (!f.id) continue
      const ex = formAgg.get(f.id) ?? { name: f.name, type: f.type, count: 0 }
      ex.count += num(f.count)
      formAgg.set(f.id, ex)
    }
  }
  const formList = Array.from(formAgg, ([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count)
  const formListTotal = formList.reduce((s, f) => s + f.count, 0)

  // Lead sources, from how each contact first reached the business. Days synced before
  // sources were recorded have no lead_sources key and are left out rather than counted as zero.
  const sourceCounts: LeadSourceCounts = {}
  const sourceDates: string[] = []
  for (const row of data) {
    if (row.raw_data?.lead_sources && typeof row.raw_data.lead_sources === 'object') {
      sourceDates.push(row.date)
      addLeadSources(sourceCounts, row.raw_data.lead_sources)
    }
  }
  const sources         = summariseLeadSources(sourceCounts)
  const hasSources      = sources.total > 0
  const sourcesComplete = sourceDates.length === data.length
  const GROUP_LABEL: Record<LeadSourceGroup, string> = { paid: 'Clicked an ad', organic: 'Found you on their own', untracked: 'No source recorded' }
  const sourceGroups = (['paid', 'organic', 'untracked'] as const)
    .map(g => ({ key: g, label: GROUP_LABEL[g], count: sources[g] }))
    .filter(g => g.count > 0)
  const leadWord = (n: number) => (n === 1 ? 'lead' : 'leads')

  // Trend: new leads as bars, phone calls as the line, on the shared chart. When the client
  // has picked a comparison the previous period rides along behind it, named after the window
  // it actually covers rather than the generic 'prior'.
  const toTrend = (arr: GhlRow[]): DailyMetric[] => arr.map(r => ({
    date: r.date, spend: realLeads(r), conversions: num(r.total_calls), clicks: 0, roas: 0,
  }))
  const trend      = toTrend(data)
  const priorTrend = showCompare && priorData.length > 0 ? toTrend(priorData) : undefined
  const priorNoun  = compare === 'last_year' ? 'last year' : 'previous period'

  const hasCalls    = t.calls > 0 || t.missed > 0
  const hasPipeline = t.newOpps > 0 || closable > 0 || t.wonValue > 0
  const hasReviews  = t.reviews > 0 || t.reviewsSent > 0
  const hasOutreach = t.emails > 0 || t.sms > 0

  const header = (
    <PageHeader title="Leads & Customers" accent="var(--crm-lead)" fromDate={fromDate} toDate={toDate} compare={compare}>
      <span className="badge badge-gray">{crmName}</span>
    </PageHeader>
  )

  if (data.length === 0) {
    return (
      <div className="crm-report min-h-screen" style={{ background: 'var(--bg-base)' }}>
        {header}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <EmptyState
            title="No leads recorded in this date range"
            description={`Once enquiries start arriving in ${crmName}, this page will show your new leads, phone calls, form submissions and won jobs. Try a wider date range — the newest day is usually yesterday.`}
            icon={<UsersThree size={22} />}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="crm-report min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {header}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 sm:space-y-5">

        {/* ── The answer, before any table ──────────────────────────────── */}
        <section className="card crm-headline">
          <div className="crm-headline__main">
            <p className="section-label">New leads · {prettyDate(iso(fromDate))} – {prettyDate(iso(toDate))}</p>
            <div className="crm-headline__figure">
              <span className="crm-headline__value">{fmtNum(t.leads)}</span>
              {leadDelta !== undefined && (
                <span className={`badge ${leadDelta >= 0 ? 'badge-green' : 'badge-red'}`}>
                  {leadDelta >= 0 ? '▲' : '▼'} {Math.abs(leadDelta).toFixed(1)}%
                </span>
              )}
            </div>
            <p className="crm-headline__sub">
              {leadDelta !== undefined
                ? `${leadDelta >= 0 ? 'Up' : 'Down'} from ${fmtNum(pt.leads)} in ${priorLabel}.`
                : `That's about ${(t.leads / dayCount).toFixed(1)} new leads a day.`}
              {t.spam > 0 && ` ${fmtNum(t.spam)} spam ${t.spam === 1 ? 'contact was' : 'contacts were'} filtered out (${spamShare.toFixed(0)}% of everything that came in).`}
            </p>
          </div>

          <ul className="crm-headline__facts">
            <li>
              <span className="crm-fact__label">Calls answered</span>
              <span className="crm-fact__value">{hasCalls ? fmtNum(answered) : '—'}</span>
            </li>
            <li>
              <span className="crm-fact__label">Missed calls</span>
              <span className="crm-fact__value" style={{ color: t.missed > 0 ? 'var(--crm-missed)' : undefined }}>
                {hasCalls ? fmtNum(t.missed) : '—'}
              </span>
            </li>
            <li>
              <span className="crm-fact__label">Jobs won</span>
              <span className="crm-fact__value">{hasPipeline ? fmtNum(t.wonOpps) : '—'}</span>
            </li>
          </ul>
        </section>

        {/* ── Headline metrics with their own trend ─────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <SparkMetricCard
            label="New leads"
            value={fmtNum(t.leads)}
            sub={t.spam > 0 ? `${fmtNum(t.spam)} spam excluded` : undefined}
            sparkData={data.map(r => ({ v: realLeads(r) }))}
            sparkColor="var(--crm-lead)"
            delta={leadDelta}
            delay={0}
          />
          <SparkMetricCard
            label="Phone calls"
            value={fmtNum(t.calls)}
            sub={t.incoming > 0 ? `${fmtNum(t.incoming)} incoming` : undefined}
            sparkData={data.map(r => ({ v: num(r.total_calls) }))}
            sparkColor="var(--crm-call)"
            delta={delta(t.calls, pt.calls)}
            delay={1}
          />
          <SparkMetricCard
            label="Form submissions"
            value={fmtNum(t.forms)}
            sub={formList.length > 0 ? `across ${formList.length} ${formList.length === 1 ? 'form' : 'forms'}` : undefined}
            sparkData={data.map(r => ({ v: num(r.forms_submitted) }))}
            sparkColor="var(--crm-form)"
            delta={delta(t.forms, pt.forms)}
            delay={2}
          />
          <SparkMetricCard
            label="Jobs won"
            value={fmtNum(t.wonOpps)}
            sub={t.wonValue > 0 ? `${fmt$(t.wonValue)} in value` : undefined}
            sparkData={data.map(r => ({ v: num(r.won_opportunities) }))}
            sparkColor="var(--crm-won)"
            delta={delta(t.wonOpps, pt.wonOpps)}
            delay={3}
          />
        </div>

        {/* ── Lead sources ──────────────────────────────────────────────── */}
        {hasSources && (
          <section className="card p-4 sm:p-6" aria-labelledby="crm-sources-title">
            <h2 id="crm-sources-title" className="section-title">Where your leads came from</h2>
            <p className="section-desc">
              {sources.paid > 0
                ? `${fmtNum(sources.paid)} of ${fmtNum(sources.total)} ${leadWord(sources.total)} clicked one of your ads first. `
                : `None of these ${fmtNum(sources.total)} ${leadWord(sources.total)} came from an ad. `}
              {sources.organic > 0 && `${fmtNum(sources.organic)} found you on their own.`}
            </p>

            <div className="lead-src-split" role="img"
              aria-label={sourceGroups.map(g => `${g.label}: ${fmtNum(g.count)}`).join(', ')}>
              {sourceGroups.map(g => (
                <span key={g.key} className={`lead-src-split__seg lead-src--${g.key}`} style={{ flexGrow: g.count }} />
              ))}
            </div>

            <ul className="lead-src-groups">
              {sourceGroups.map(g => (
                <li key={g.key} className="lead-src-group">
                  <span className="lead-src-group__label"><span className={`lead-src-dot lead-src--${g.key}`} aria-hidden />{g.label}</span>
                  <span className="lead-src-group__value">{fmtNum(g.count)}</span>
                  <span className="lead-src-group__pct">{share(g.count, sources.total).toFixed(0)}% of tracked leads</span>
                </li>
              ))}
            </ul>

            <div className="table-scroll crm-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Source</th>
                    <th className="lead-src-col-type" style={{ textAlign: 'left' }}>Type</th>
                    <th style={{ textAlign: 'right' }}>Leads</th>
                    <th className="crm-col-share" style={{ textAlign: 'right' }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.channels.map(c => (
                    <tr key={c.key}>
                      <td style={{ fontWeight: 500 }}>
                        <span className="lead-src-name"><span className={`lead-src-dot lead-src-dot--inline lead-src--${c.group}`} aria-hidden />{c.label}</span>
                      </td>
                      <td className="lead-src-col-type">
                        <span className="lead-src-type"><span className={`lead-src-dot lead-src--${c.group}`} aria-hidden />{c.group === 'paid' ? 'Ad' : c.group === 'organic' ? 'Organic' : 'Unknown'}</span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(c.count)}</td>
                      <td className="crm-col-share" style={{ textAlign: 'right' }}>
                        <span className="crm-share">
                          <span className="crm-share__track">
                            <span className={`crm-share__fill lead-src--${c.group}`} style={{ width: `${share(c.count, sources.total)}%` }} />
                          </span>
                          <span className="crm-share__num">{share(c.count, sources.total).toFixed(0)}%</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {share(sources.untracked, sources.total) >= 40 && (
              <p className="crm-insight crm-insight--warn">
                {`${share(sources.untracked, sources.total).toFixed(0)}% of leads have no source. That happens when contacts are added by hand or imported into ${crmName}, or when an enquiry arrives through something ${crmName} can't track.`}
              </p>
            )}
            {!sourcesComplete && (
              <p className="crm-insight">
                {`Sources were first recorded on ${prettyDate(sourceDates[0])}, so earlier leads in this range aren't included here.`}
              </p>
            )}
          </section>
        )}

        {/* ── Trend ─────────────────────────────────────────────────────── */}
        <section className="card p-4 sm:p-6">
          <div className="mb-4">
            <h2 className="section-title">New leads and phone calls, day by day</h2>
            <p className="section-desc">
              {busiest && realLeads(busiest) > 0
                ? `Your busiest day was ${prettyDate(busiest.date)} with ${fmtNum(realLeads(busiest))} new ${realLeads(busiest) === 1 ? 'lead' : 'leads'}.`
                : `${prettyDate(iso(fromDate))} – ${prettyDate(iso(toDate))}`}
            </p>
          </div>
          <SpendChart
            data={trend}
            priorData={priorTrend}
            spendLabel="New leads"
            conversionsLabel="Phone calls"
            priorSpendLabel={`New leads, ${priorNoun}`}
            priorConversionsLabel={`Phone calls, ${priorNoun}`}
            colorSpend="var(--crm-lead-soft)"
            colorPriorSpend="var(--text-faint)"
            colorConversions="var(--crm-call)"
            colorPriorConversions="var(--text-muted)"
            variant="count"
          />
        </section>

        {/* ── Calls + pipeline, side by side ────────────────────────────── */}
        <div className="crm-split">
          {hasCalls && (
            <section className="card p-4 sm:p-6">
              <h2 className="section-title">Phone calls</h2>
              <p className="section-desc">
                {t.incoming > 0
                  ? `You missed ${missedRate.toFixed(0)}% of the calls that came in.`
                  : `${crmName} isn't reporting which calls came in or were missed yet, only the total.`}
              </p>

              {t.incoming > 0 && (
                <>
                  <div className="crm-bar" role="img" aria-label={`${fmtNum(answered)} answered, ${fmtNum(t.missed)} missed`}>
                    <span className="crm-bar__seg crm-bar__seg--good" style={{ width: `${share(answered, t.incoming)}%` }} />
                    <span className="crm-bar__seg crm-bar__seg--bad"  style={{ width: `${missedRate}%` }} />
                  </div>
                  <div className="crm-legend">
                    <span><i className="crm-dot crm-dot--good" />Answered {fmtNum(answered)}</span>
                    <span><i className="crm-dot crm-dot--bad" />Missed {fmtNum(t.missed)}</span>
                  </div>
                </>
              )}

              <div className="metric-row metric-row--dense crm-stats">
                <Stat label="Total calls"    value={fmtNum(t.calls)} />
                {t.incoming > 0 && (
                  <>
                    <Stat label="Calls in"       value={fmtNum(t.incoming)} sub={t.outgoing > 0 ? `${fmtNum(t.outgoing)} out` : undefined} />
                    <Stat label="Missed"         value={fmtNum(t.missed)} sub={`${missedRate.toFixed(0)}% of calls in`} tone={t.missed > 0 ? 'warn' : undefined} />
                  </>
                )}
              </div>

              {t.missed > 0 && missedRate >= 10 && (
                <p className="crm-insight crm-insight--warn">
                  {fmtNum(t.missed)} {t.missed === 1 ? 'caller' : 'callers'} didn&apos;t get through. Callers who don&apos;t reach anyone usually ring the next business on the list.
                </p>
              )}
            </section>
          )}

          {hasPipeline && (
            <section className="card p-4 sm:p-6">
              <h2 className="section-title">Quotes and jobs</h2>
              <p className="section-desc">
                {closable > 0
                  ? `You won ${winRate.toFixed(0)}% of the ${fmtNum(closable)} ${closable === 1 ? 'quote' : 'quotes'} that were decided.`
                  : 'No quotes have been marked won or lost yet.'}
              </p>

              {closable === 0 && (
                <p className="crm-insight crm-insight--warn">
                  Mark each quote as won or lost in {crmName} when you hear back. That&apos;s the only way this page can
                  show your win rate and the value of the jobs you&apos;ve won.
                  {t.newOpps > 0 && <> Right now we can see quotes going out, but not which ones turned into work.</>}
                </p>
              )}

              {closable > 0 && (
                <>
                  <div className="crm-bar" role="img" aria-label={`${fmtNum(t.wonOpps)} won, ${fmtNum(t.lostOpps)} lost`}>
                    <span className="crm-bar__seg crm-bar__seg--won"  style={{ width: `${winRate}%` }} />
                    <span className="crm-bar__seg crm-bar__seg--lost" style={{ width: `${share(t.lostOpps, closable)}%` }} />
                  </div>
                  <div className="crm-legend">
                    <span><i className="crm-dot crm-dot--won" />Won {fmtNum(t.wonOpps)}</span>
                    <span><i className="crm-dot crm-dot--lost" />Lost {fmtNum(t.lostOpps)}</span>
                  </div>
                </>
              )}

              <div className="metric-row metric-row--dense crm-stats">
                <Stat label="New quotes"  value={fmtNum(t.newOpps)} />
                <Stat label="Jobs won"    value={fmtNum(t.wonOpps)} sub={closable > 0 ? `${winRate.toFixed(0)}% win rate` : undefined} />
                <Stat label="Value won"   value={t.wonValue > 0 ? fmt$(t.wonValue) : '—'} sub={avgJob > 0 ? `${fmt$(avgJob)} per job` : undefined} />
              </div>
            </section>
          )}
        </div>

        {/* ── Forms ─────────────────────────────────────────────────────── */}
        <section className="card p-4 sm:p-6">
          <h2 className="section-title">Where people filled out a form</h2>
          <p className="section-desc">
            {t.forms > 0
              ? `${fmtNum(t.forms)} ${t.forms === 1 ? 'submission' : 'submissions'} in this period.`
              : 'No form submissions in this period.'}
          </p>

          {formList.length > 0 ? (
            <div className="table-scroll crm-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Form</th>
                    <th style={{ textAlign: 'left' }}>Type</th>
                    <th style={{ textAlign: 'right' }}>Submissions</th>
                    <th className="crm-col-share" style={{ textAlign: 'right' }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {formList.map(f => (
                    <tr key={f.id}>
                      <td style={{ fontWeight: 500 }}>{f.name}</td>
                      <td style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{f.type || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(f.count)}</td>
                      <td className="crm-col-share" style={{ textAlign: 'right' }}>
                        <span className="crm-share">
                          <span className="crm-share__track">
                            <span className="crm-share__fill" style={{ width: `${share(f.count, formListTotal)}%` }} />
                          </span>
                          <span className="crm-share__num">{share(f.count, formListTotal).toFixed(0)}%</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 600 }}>All forms</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtNum(formListTotal)}</td>
                    <td className="crm-col-share" />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="crm-insight">
              {t.forms > 0
                ? `${crmName} recorded the submissions but didn't say which form they came from.`
                : 'Nothing yet. Form fills from your website land here as soon as they arrive.'}
            </p>
          )}
        </section>

        {/* ── Reviews and follow-up ─────────────────────────────────────── */}
        {(hasReviews || hasOutreach) && (
          <section className="card p-4 sm:p-6">
            <h2 className="section-title">Reviews and follow-up</h2>
            <p className="section-desc">What went out to your customers in this period.</p>
            <div className="metric-row metric-row--dense crm-stats">
              {hasReviews && <Stat label="Reviews received" value={fmtNum(t.reviews)} sub={t.reviewsSent > 0 ? `${fmtNum(t.reviewsSent)} requests sent` : undefined} tone="good" />}
              {t.emails > 0 && <Stat label="Emails sent" value={fmtNum(t.emails)} />}
              {t.sms > 0     && <Stat label="Texts sent"  value={fmtNum(t.sms)} />}
            </div>
          </section>
        )}

        {/* ── The detail, last ──────────────────────────────────────────── */}
        <section className="card p-4 sm:p-6">
          <h2 className="section-title">Day by day</h2>
          <p className="section-desc">Every day in the range, newest first.</p>
          <div className="table-scroll crm-table-wrap">
            <table className="data-table data-table--compact" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Date</th>
                  <th style={{ textAlign: 'right' }}>New leads</th>
                  <th style={{ textAlign: 'right' }}>Spam</th>
                  <th style={{ textAlign: 'right' }}>Calls</th>
                  <th style={{ textAlign: 'right' }}>Missed</th>
                  <th style={{ textAlign: 'right' }}>Forms</th>
                  <th style={{ textAlign: 'right' }}>New quotes</th>
                  <th style={{ textAlign: 'right' }}>Jobs won</th>
                  <th style={{ textAlign: 'right' }}>Value won</th>
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map(r => (
                  <tr key={r.date}>
                    <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{prettyDate(r.date)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(realLeads(r))}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-faint)' }}>{num(r.spam_leads) > 0 ? fmtNum(num(r.spam_leads)) : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(num(r.total_calls))}</td>
                    <td style={{ textAlign: 'right', color: num(r.missed_calls) > 0 ? 'var(--crm-missed)' : 'var(--text-faint)' }}>
                      {num(r.missed_calls) > 0 ? fmtNum(num(r.missed_calls)) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(num(r.forms_submitted))}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(num(r.new_opportunities))}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(num(r.won_opportunities))}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{num(r.won_value) > 0 ? fmt$(num(r.won_value)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 600 }}>Total</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtNum(t.leads)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{t.spam > 0 ? fmtNum(t.spam) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(t.calls)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{t.missed > 0 ? fmtNum(t.missed) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(t.forms)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(t.newOpps)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(t.wonOpps)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{t.wonValue > 0 ? fmt$(t.wonValue) : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <p className="crm-footnote">
          Figures come from {crmName} and update once a day. Spam contacts are excluded from your lead count.
        </p>
      </main>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' }) {
  const color = tone === 'good' ? 'var(--crm-won)' : tone === 'warn' ? 'var(--crm-missed)' : undefined
  return (
    <div>
      <p className="metric-row__label metric-label">{label}</p>
      <p className="metric-row__value" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="crm-stat__sub">{sub}</p>}
    </div>
  )
}
