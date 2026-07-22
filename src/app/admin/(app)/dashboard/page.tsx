// Admin Overview — /admin/dashboard
// Server component: runs only the fast queries (clients, connections, sync_jobs,
// agency_settings) then hands off to DashboardClientShell for metric fetching.

import { unstable_noStore as noStore } from 'next/cache'
import { Suspense }                    from 'react'
import { createAdminClient }           from '@/lib/supabase/server'
import Link                            from 'next/link'
import DateRangePicker                 from '@/components/DateRangePicker'
import AdminDateSync                   from './AdminDateSync'
import DashboardClientShell            from '@/components/admin/DashboardClientShell'
import type { ShellClientRow, ShellConnRow, ShellSyncJob } from '@/components/admin/DashboardClientShell'

export const dynamic = 'force-dynamic'

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function subtractDays(d: Date, n: number) { return new Date(d.getTime() - n * 86_400_000) }

function getMtdFrom() {
  const now = new Date()
  return fmtDate(new Date(now.getFullYear(), now.getMonth(), 1))
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; sort?: string; dir?: string; compare?: string }>
}) {
  noStore()
  const today   = new Date()
  const params  = await searchParams
  const dateFrom = params.from  || getMtdFrom()
  const dateTo   = params.to    || fmtDate(today)
  const sortCol  = params.sort  ?? ''
  const sortDir  = params.dir   === 'asc' ? 'asc' : 'desc'
  const compare  = params.compare ?? 'none'

  // Compute prior-period date range (passed to shell so it can send to API)
  let compareDateFrom = ''
  let compareDateTo   = ''
  if (compare !== 'none') {
    const fromDate = new Date(dateFrom)
    const toDate   = new Date(dateTo)
    if (compare === 'last_year') {
      compareDateFrom = fmtDate(new Date(fromDate.getFullYear() - 1, fromDate.getMonth(), fromDate.getDate()))
      compareDateTo   = fmtDate(new Date(toDate.getFullYear()   - 1, toDate.getMonth(),   toDate.getDate()))
    } else {
      const periodMs  = toDate.getTime() - fromDate.getTime()
      const priorTo   = new Date(fromDate.getTime() - 86_400_000)
      const priorFrom = new Date(priorTo.getTime() - periodMs)
      compareDateFrom = fmtDate(priorFrom)
      compareDateTo   = fmtDate(priorTo)
    }
  }

  const db = createAdminClient()

  // Fast queries only — no metric data here
  const [clientsRes, connectionsRes, syncJobsRes, settingsRes] = await Promise.all([
    db.from('clients')
      .select('id, name, logo_url, benchmark_roas, benchmark_ctr, benchmark_cpc, benchmark_conv_rate, enabled_benchmarks, lead_action, lead_action_fallback, purchase_action, purchase_action_fallback, ad_fuel_cut, historic_bill_day, dashboard_token')
      .order('name'),

    db.from('client_connections')
      .select('client_id, connector:connectors(id, type, label, status)')
      .eq('status', 'active'),

    // Last 7 days of sync jobs — for the status dots and error count
    db.from('sync_jobs')
      .select('id, client_id, status, completed_at')
      .gte('started_at', subtractDays(today, 7).toISOString())
      .order('completed_at', { ascending: false }),

    db.from('agency_settings')
      .select('overview_columns')
      .single(),
  ])

  const clients     = (clientsRes.data     ?? []) as ShellClientRow[]
  const connections = (connectionsRes.data ?? []) as unknown as ShellConnRow[]
  const syncJobs    = (syncJobsRes.data    ?? []) as ShellSyncJob[]

  const rawSettings = settingsRes.data as Record<string, unknown> | null
  const DEFAULT_COLS = ['spend', 'roas', 'cpa', 'conversions', 'ctr', 'sync_status']
  const rawCols: string[] = Array.isArray(rawSettings?.overview_columns)
    ? rawSettings!.overview_columns as string[]
    : DEFAULT_COLS
  // Expand legacy 'roas_cpl' column into separate 'roas' + 'cpa' columns
  const overviewCols: string[] = rawCols.flatMap(c => c === 'roas_cpl' ? ['roas', 'cpa'] : [c])

  const clientsWithErrors = new Set(
    syncJobs.filter(j => j.status === 'error').map(j => j.client_id)
  ).size

  return (
    <div>
      <Suspense fallback={null}>
        <AdminDateSync />
      </Suspense>

      {/* Page header */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="page-title">Clients</h1>
        <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
          <Suspense fallback={null}>
            <DateRangePicker from={dateFrom} to={dateTo} compare={compare} />
          </Suspense>
          <Link href="/admin/clients/new" className="btn btn-primary">+ Add Client</Link>
        </div>
      </div>

      {/* Client shell — renders stat cards + table with progressive metric loading */}
      <DashboardClientShell
        clients={clients}
        connections={connections}
        syncJobs={syncJobs}
        overviewCols={overviewCols}
        totalClientCount={clients.length}
        activeConnectorCount={connections.length}
        clientsWithErrors={clientsWithErrors}
        dateFrom={dateFrom}
        dateTo={dateTo}
        compare={compare}
        compareDateFrom={compareDateFrom}
        compareDateTo={compareDateTo}
        sortCol={sortCol}
        sortDir={sortDir}
      />
    </div>
  )
}
