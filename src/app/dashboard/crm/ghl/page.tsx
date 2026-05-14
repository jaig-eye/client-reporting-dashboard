// GoHighLevel CRM Dashboard — /dashboard/crm/ghl

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getAgencySettings } from '@/lib/agency-settings'
import type { Client } from '@/lib/types'
import DateRangePicker from '@/components/DateRangePicker'
import SparkMetricCard from '@/components/SparkMetricCard'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function fmtNum(n: number) { return n.toLocaleString() }
function fmt$(n: number)   { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }
function pct(missed: number, total: number) {
  if (total === 0) return '—'
  return `${((missed / total) * 100).toFixed(0)}% missed`
}

type FormBreakdownItem = { id: string; name: string; type: string; count: number }

type GhlRow = {
  date:               string
  contacts_created:   number
  total_calls:        number
  missed_calls:       number
  forms_submitted:    number
  reviews_sent:       number
  reviews_received:   number
  spam_leads:         number
  emails_sent:        number
  sms_sent:           number
  new_opportunities:  number
  won_opportunities:  number
  lost_opportunities: number
  won_value:          number
  raw_data:           { form_breakdown?: FormBreakdownItem[] } | null
}

export default async function GhlCrmPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>
}) {
  const cookieStore = await cookies()
  const db          = createAdminClient()
  const params      = await searchParams

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const [{ data: clientData }, settings] = await Promise.all([
    db.from('clients').select('*').eq('dashboard_token', token).single(),
    getAgencySettings(),
  ])
  const client = clientData as Client | null
  if (!client) redirect('/access')

  const crmName = settings.crm_name ?? 'CRM'

  const toDate   = params.to   ? new Date(params.to)   : new Date()
  const fromDate = params.from ? new Date(params.from)  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const compare  = params.compare ?? 'none'

  const showCompare = compare !== 'none'
  const periodMs    = toDate.getTime() - fromDate.getTime()
  let priorTo:   Date
  let priorFrom: Date
  if (compare === 'last_year') {
    priorFrom = new Date(fromDate); priorFrom.setFullYear(priorFrom.getFullYear() - 1)
    priorTo   = new Date(toDate);   priorTo.setFullYear(priorTo.getFullYear() - 1)
  } else {
    priorTo   = new Date(fromDate.getTime() - 86400000)
    priorFrom = new Date(priorTo.getTime() - periodMs)
  }

  const [{ data: rows }, { data: priorRows }] = await Promise.all([
    db.from('ghl_metrics')
      .select('date,contacts_created,total_calls,missed_calls,forms_submitted,reviews_received,spam_leads,emails_sent,sms_sent,new_opportunities,won_opportunities,lost_opportunities,won_value,raw_data')
      .eq('client_id', client.id)
      .gte('date', fmtDate(fromDate)).lte('date', fmtDate(toDate))
      .order('date', { ascending: true }),
    showCompare
      ? db.from('ghl_metrics')
          .select('date,contacts_created,total_calls,missed_calls,forms_submitted,reviews_received,spam_leads,emails_sent,sms_sent,new_opportunities,won_opportunities,lost_opportunities,won_value,raw_data')
          .eq('client_id', client.id)
          .gte('date', fmtDate(priorFrom)).lte('date', fmtDate(priorTo))
          .order('date', { ascending: true })
      : Promise.resolve({ data: [] as GhlRow[] }),
  ])

  const data      = (rows      ?? []) as GhlRow[]
  const priorData = (priorRows ?? []) as GhlRow[]

  function sumRows(arr: GhlRow[]) {
    return arr.reduce((acc, r) => {
      const created = Number(r.contacts_created) || 0
      const spam    = Number(r.spam_leads)        || 0
      return {
        // Exclude spam leads from "New Contacts" — GHL's native report does the same.
        // spam_leads is still tracked separately for display in the table.
        contacts:  acc.contacts  + Math.max(0, created - spam),
        calls:     acc.calls     + (Number(r.total_calls)         || 0),
        missed:    acc.missed    + (Number(r.missed_calls)        || 0),
        forms:     acc.forms     + (Number(r.forms_submitted)     || 0),
        reviews:   acc.reviews   + (Number(r.reviews_received)    || 0),
        spam:      acc.spam      + spam,
        emails:    acc.emails    + (Number(r.emails_sent)         || 0),
        sms:       acc.sms       + (Number(r.sms_sent)            || 0),
        newOpps:   acc.newOpps   + (Number(r.new_opportunities)   || 0),
        wonOpps:   acc.wonOpps   + (Number(r.won_opportunities)   || 0),
        lostOpps:  acc.lostOpps  + (Number(r.lost_opportunities)  || 0),
        wonValue:  acc.wonValue  + (Number(r.won_value)           || 0),
      }
    }, { contacts: 0, calls: 0, missed: 0, forms: 0, reviews: 0, spam: 0, emails: 0, sms: 0, newOpps: 0, wonOpps: 0, lostOpps: 0, wonValue: 0 })
  }

  const totals      = sumRows(data)
  const priorTotals = sumRows(priorData)

  function calcDelta(curr: number, prev: number): number | undefined {
    if (!showCompare || prev === 0) return undefined
    return ((curr - prev) / prev) * 100
  }

  // Aggregate form/survey breakdown across all days
  const formAgg = new Map<string, { name: string; type: string; count: number }>()
  for (const row of data) {
    const breakdown = row.raw_data?.form_breakdown ?? []
    for (const f of breakdown) {
      if (!f.id) continue
      const ex = formAgg.get(f.id) ?? { name: f.name, type: f.type, count: 0 }
      ex.count += f.count
      formAgg.set(f.id, ex)
    }
  }
  const formList = Array.from(formAgg.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count)

  const noData = data.length === 0

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {crmName}
            </h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 3 }}>
              {fmtDate(fromDate)} – {fmtDate(toDate)}
            </p>
          </div>
          <DateRangePicker from={fmtDate(fromDate)} to={fmtDate(toDate)} compare={compare} />
        </div>

        {noData ? (
          <div className="card p-12 text-center">
            <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No CRM data for this period</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Data syncs daily from {crmName}. Try a wider date range.</p>
          </div>
        ) : (
          <>
            {/* Primary KPIs */}
            <div><h2 className="section-title">Leads &amp; Pipeline</h2></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SparkMetricCard
                label="New Contacts"
                value={fmtNum(totals.contacts)}
                sparkData={data.map(r => ({ v: Math.max(0, (Number(r.contacts_created) || 0) - (Number(r.spam_leads) || 0)) }))}
                delta={calcDelta(totals.contacts, priorTotals.contacts)}
                sparkColor="#10b981"
                delay={0}
              />
              <SparkMetricCard
                label="Forms Submitted"
                value={fmtNum(totals.forms)}
                sparkData={data.map(r => ({ v: Number(r.forms_submitted) || 0 }))}
                delta={calcDelta(totals.forms, priorTotals.forms)}
                sparkColor="#3b82f6"
                delay={1}
              />
              <SparkMetricCard
                label="New Opportunities"
                value={fmtNum(totals.newOpps)}
                sparkData={data.map(r => ({ v: Number(r.new_opportunities) || 0 }))}
                delta={calcDelta(totals.newOpps, priorTotals.newOpps)}
                sparkColor="#8b5cf6"
                delay={2}
              />
              <SparkMetricCard
                label="Won"
                value={fmtNum(totals.wonOpps)}
                sparkData={data.map(r => ({ v: Number(r.won_opportunities) || 0 }))}
                delta={calcDelta(totals.wonOpps, priorTotals.wonOpps)}
                sparkColor="#f59e0b"
                sub={totals.wonValue > 0 ? fmt$(totals.wonValue) : undefined}
                delay={3}
              />
            </div>

            {/* Call performance */}
            {totals.calls > 0 && (
              <div className="card p-6">
                <h2 className="section-title mb-4">Call Performance</h2>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <Stat label="Total Calls" value={fmtNum(totals.calls)} />
                  <Stat label="Answered"    value={fmtNum(totals.calls - totals.missed)} />
                  <Stat label="Missed"      value={fmtNum(totals.missed)} sub={pct(totals.missed, totals.calls)} />
                </div>
              </div>
            )}

            {/* Forms & Surveys breakdown */}
            {formList.length > 0 && (
              <div className="card p-6">
                <h2 className="section-title mb-4">Forms &amp; Surveys</h2>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '0.8125rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Name</th>
                        <th style={{ textAlign: 'left' }}>Type</th>
                        <th style={{ textAlign: 'right' }}>Submissions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formList.map(f => (
                        <tr key={f.id}>
                          <td style={{ color: 'var(--text-primary)' }}>{f.name}</td>
                          <td style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{f.type}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(f.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Daily breakdown */}
            {data.length > 0 && (
              <div className="card p-6">
                <h2 className="section-title mb-4">Daily Breakdown</h2>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '0.8125rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Date</th>
                        <th style={{ textAlign: 'right' }}>Contacts</th>
                        <th style={{ textAlign: 'right' }}>Calls</th>
                        <th style={{ textAlign: 'right' }}>Missed</th>
                        <th style={{ textAlign: 'right' }}>Forms</th>
                        <th style={{ textAlign: 'right' }}>New Opps</th>
                        <th style={{ textAlign: 'right' }}>Won</th>
                        <th style={{ textAlign: 'right' }}>Won Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data].reverse().map(r => (
                        <tr key={r.date}>
                          <td style={{ color: 'var(--text-secondary)' }}>{r.date}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(Math.max(0, (Number(r.contacts_created) || 0) - (Number(r.spam_leads) || 0)))}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(Number(r.total_calls) || 0)}</td>
                          <td style={{ textAlign: 'right', color: r.missed_calls > 0 ? 'var(--amber, #f59e0b)' : undefined }}>
                            {fmtNum(Number(r.missed_calls) || 0)}
                          </td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(Number(r.forms_submitted) || 0)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(Number(r.new_opportunities) || 0)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(Number(r.won_opportunities) || 0)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {Number(r.won_value) > 0 ? fmt$(Number(r.won_value)) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{sub}</p>}
    </div>
  )
}
