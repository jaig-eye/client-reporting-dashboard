// GoHighLevel CRM Dashboard — /dashboard/crm/ghl

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import type { Client } from '@/lib/types'
import DateRangePicker from '@/components/DateRangePicker'
import SparkMetricCard from '@/components/SparkMetricCard'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function fmtNum(n: number) { return n.toLocaleString() }
function pct(missed: number, total: number) {
  if (total === 0) return '—'
  return `${((missed / total) * 100).toFixed(0)}% missed`
}

type GhlRow = {
  date: string
  contacts_created: number
  total_calls: number
  missed_calls: number
  forms_submitted: number
  reviews_sent: number
  reviews_received: number
  spam_leads: number
  emails_sent: number
  sms_sent: number
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

  const { data: clientData } = await db.from('clients').select('*').eq('dashboard_token', token).single()
  const client = clientData as Client | null
  if (!client) redirect('/access')

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
    db.from('ghl_metrics').select('*')
      .eq('client_id', client.id)
      .gte('date', fmtDate(fromDate)).lte('date', fmtDate(toDate))
      .order('date', { ascending: true }),
    showCompare
      ? db.from('ghl_metrics').select('*')
          .eq('client_id', client.id)
          .gte('date', fmtDate(priorFrom)).lte('date', fmtDate(priorTo))
          .order('date', { ascending: true })
      : Promise.resolve({ data: [] as GhlRow[] }),
  ])

  const data      = (rows      ?? []) as GhlRow[]
  const priorData = (priorRows ?? []) as GhlRow[]

  function sumRows(arr: GhlRow[]) {
    return arr.reduce((acc, r) => ({
      contacts:     acc.contacts     + (Number(r.contacts_created)  || 0),
      calls:        acc.calls        + (Number(r.total_calls)        || 0),
      missed:       acc.missed       + (Number(r.missed_calls)       || 0),
      forms:        acc.forms        + (Number(r.forms_submitted)    || 0),
      reviews:      acc.reviews      + (Number(r.reviews_received)   || 0),
      spam:         acc.spam         + (Number(r.spam_leads)         || 0),
      emails:       acc.emails       + (Number(r.emails_sent)        || 0),
      sms:          acc.sms          + (Number(r.sms_sent)           || 0),
    }), { contacts: 0, calls: 0, missed: 0, forms: 0, reviews: 0, spam: 0, emails: 0, sms: 0 })
  }

  const totals      = sumRows(data)
  const priorTotals = sumRows(priorData)

  function calcDelta(curr: number, prev: number): number | undefined {
    if (!showCompare || prev === 0) return undefined
    return ((curr - prev) / prev) * 100
  }

  // Daily trend data for contacts created chart
  const contactsSpark = data.map(r => ({ v: Number(r.contacts_created) || 0 }))

  const noData = data.length === 0

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              CRM — GoHighLevel
            </h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 3 }}>
              {fmtDate(fromDate)} – {fmtDate(toDate)}
            </p>
          </div>
          <DateRangePicker
            from={fmtDate(fromDate)}
            to={fmtDate(toDate)}
            compare={compare}
          />
        </div>

        {noData ? (
          <div className="card p-12 text-center">
            <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No CRM data for this period</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Data syncs daily from GoHighLevel. Try a wider date range.</p>
          </div>
        ) : (
          <>
            {/* Primary KPIs */}
            <div>
              <h2 className="section-title">Leads &amp; Engagement</h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SparkMetricCard
                label="New Contacts"
                value={fmtNum(totals.contacts)}
                sparkData={contactsSpark}
                delta={calcDelta(totals.contacts, priorTotals.contacts)}
                sparkColor="#10b981"
                delay={0}
              />
              <SparkMetricCard
                label="Total Calls"
                value={fmtNum(totals.calls)}
                sparkData={data.map(r => ({ v: Number(r.total_calls) || 0 }))}
                delta={calcDelta(totals.calls, priorTotals.calls)}
                sparkColor="#3b82f6"
                delay={1}
              />
              <SparkMetricCard
                label="Missed Calls"
                value={fmtNum(totals.missed)}
                sparkData={data.map(r => ({ v: Number(r.missed_calls) || 0 }))}
                delta={calcDelta(totals.missed, priorTotals.missed)}
                invertDelta
                sparkColor="#f59e0b"
                delay={2}
              />
              <SparkMetricCard
                label="Forms Submitted"
                value={fmtNum(totals.forms)}
                sparkData={data.map(r => ({ v: Number(r.forms_submitted) || 0 }))}
                delta={calcDelta(totals.forms, priorTotals.forms)}
                sparkColor="#6366f1"
                delay={3}
              />
            </div>

            {/* Secondary metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Reviews Received', value: fmtNum(totals.reviews), hint: undefined },
                { label: 'Spam Leads',        value: fmtNum(totals.spam),    hint: undefined },
                { label: 'Emails Sent',        value: fmtNum(totals.emails),  hint: undefined },
                { label: 'SMS Sent',           value: fmtNum(totals.sms),     hint: undefined },
              ].map(({ label, value, hint }) => (
                <div key={label} className="card" style={{ padding: '1rem 1.25rem' }}>
                  <p className="metric-label" style={{ marginBottom: '0.25rem' }}>{label}</p>
                  <p className="metric-value" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>{value}</p>
                  {hint && <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
                </div>
              ))}
            </div>

            {/* Call answer rate */}
            {totals.calls > 0 && (
              <div className="card p-6">
                <h2 className="section-title mb-4">Call Performance</h2>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <Stat label="Total Calls"   value={fmtNum(totals.calls)} />
                  <Stat label="Answered"      value={fmtNum(totals.calls - totals.missed)} />
                  <Stat label="Missed"        value={fmtNum(totals.missed)} sub={pct(totals.missed, totals.calls)} />
                </div>
              </div>
            )}

            {/* Daily trend table */}
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
                        <th style={{ textAlign: 'right' }}>Emails</th>
                        <th style={{ textAlign: 'right' }}>SMS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data].reverse().map(r => (
                        <tr key={r.date}>
                          <td style={{ color: 'var(--text-secondary)' }}>{r.date}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(Number(r.contacts_created) || 0)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(Number(r.total_calls)      || 0)}</td>
                          <td style={{ textAlign: 'right', color: r.missed_calls > 0 ? 'var(--amber, #f59e0b)' : undefined }}>
                            {fmtNum(Number(r.missed_calls) || 0)}
                          </td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(Number(r.forms_submitted) || 0)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(Number(r.emails_sent)    || 0)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtNum(Number(r.sms_sent)       || 0)}</td>
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
