'use client'

// The Clients page body: the period's totals, then every client — spend and results for the
// period, the services connected, sync health, and the ⋯ links menu. A table on a laptop; on a
// phone the same clients as a list of rows. Metrics load after the page (they are the slow part),
// so names, sources and sync show at once and the numbers shimmer in.

import { useState, useEffect, useMemo }  from 'react'
import Link                      from 'next/link'
import { CaretDown, CaretUp, CaretRight, ArrowsDownUp, Plus, Buildings } from '@phosphor-icons/react'
import ClientLinksMenu           from '@/components/admin/ClientLinksMenu'
import BrandLogo, { BRAND_NAMES } from '@/components/ui/BrandLogo'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import EmptyState                from '@/components/ui/EmptyState'
import { Sk }                    from '@/components/ui/Skeleton'
import type { MetricsApiResponse, ClientMetricData } from '@/app/api/admin/dashboard/metrics/route'

// ─── exported row types (used by the server page to build props) ──────────────

export type ShellClientRow = {
  id: string
  name: string
  logo_url?: string | null
  benchmark_roas?: number | null
  benchmark_ctr?: number | null
  benchmark_cpc?: number | null
  benchmark_conv_rate?: number | null
  enabled_benchmarks?: string[] | null
  lead_action?: string | null
  lead_action_fallback?: string | null
  purchase_action?: string | null
  purchase_action_fallback?: string | null
  ad_fuel_cut?: number | null
  historic_bill_day?: number | null
  dashboard_token?: string | null
}

export type ShellConnRow = {
  client_id: string
  connector: { id: string; type: string; label: string; status: string }
}

export type ShellSyncJob = {
  id: string
  client_id: string
  status: string
  completed_at: string | null
}

interface Props {
  clients: ShellClientRow[]
  connections: ShellConnRow[]
  syncJobs: ShellSyncJob[]
  overviewCols: string[]
  totalClientCount: number
  activeConnectorCount: number
  clientsWithErrors: number
  dateFrom: string
  dateTo: string
  compare: string
  compareDateFrom: string
  compareDateTo: string
  sortCol: string
  sortDir: string
}

// ─── formatting ───────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%` }
function fmtX(n: number)   { return `${n.toFixed(2)}x` }
function fmtBalance(n: number) {
  const abs = Math.abs(n)
  const str = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(1)}M`
             : abs >= 1_000    ? `$${(abs / 1_000).toFixed(1)}k`
             : `$${Math.round(abs).toLocaleString()}`
  return n < 0 ? `-${str}` : str
}
function ago(hours: number): string {
  if (!isFinite(hours)) return 'never'
  if (hours < 1) return 'just now'
  if (hours < 24) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// ─── columns ──────────────────────────────────────────────────────────────────

type Col = 'spend' | 'roas' | 'cpa' | 'conversions' | 'ctr' | 'clicks' | 'impressions' | 'sync_status' | 'ad_fuel'
const COL_LABEL: Record<Col, string> = {
  spend: 'Spend', roas: 'ROAS', cpa: 'CPA', conversions: 'Conv.', ctr: 'CTR', clicks: 'Clicks',
  impressions: 'Impr.', sync_status: 'Sync', ad_fuel: 'Ad Fuel',
}
const SORTABLE = new Set(['name', 'spend', 'roas', 'cpa', 'conversions', 'ctr', 'clicks', 'impressions', 'ad_fuel'])

type BuiltRow = {
  id: string
  name: string
  logoUrl: string | null
  dashboard_token: string | null
  connectors: { type: string; label: string }[]
  sync: { tone: StatusTone; label: string; detail: string }
} & Pick<ClientMetricData,
  | 'spend' | 'conversions' | 'clicks' | 'impressions' | 'ctr'
  | 'roas' | 'cpl' | 'showRoas'
  | 'deltaSpend' | 'deltaConv' | 'deltaCtr' | 'deltaClicks'
  | 'deltaImpr' | 'deltaRoas' | 'deltaCpl'
  | 'afBalance' | 'hasAfLedger' | 'pendingAch'
>

// ─── small pieces ─────────────────────────────────────────────────────────────

const Dash = () => <span className="cl-dash">—</span>

function Delta({ delta, inverse = false, neutral = false }: { delta: number | undefined; inverse?: boolean; neutral?: boolean }) {
  if (delta == null || !isFinite(delta)) return null
  const up = delta > 0
  const good = neutral ? null : (inverse ? !up : up)
  return (
    <span className={`cl-delta${good === null ? '' : good ? ' cl-delta--good' : ' cl-delta--bad'}`}>
      {up ? '+' : ''}{delta.toFixed(1)}%
    </span>
  )
}

function ClientMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return logoUrl
    ? <span className="ui-tile ui-tile--logo cl-mark"><img src={logoUrl} alt="" /></span>
    : <span className="ui-tile ui-tile--accent cl-mark" aria-hidden>{name.charAt(0).toUpperCase()}</span>
}

function Sources({ list, max = 6 }: { list: { type: string; label: string }[]; max?: number }) {
  if (list.length === 0) return <span className="cl-none">None connected</span>
  const unique = Array.from(new Map(list.map(c => [c.type, c])).values())
  const shown = unique.slice(0, max)
  return (
    <span className="cl-sources" title={unique.map(c => BRAND_NAMES[c.type] ?? c.label).join(', ')}>
      {shown.map(c => <BrandLogo key={c.type} type={c.type} size={16} />)}
      {unique.length > max && <span className="cl-more">+{unique.length - max}</span>}
    </span>
  )
}

// ─── main ─────────────────────────────────────────────────────────────────────

export default function DashboardClientShell({
  clients, connections, syncJobs, overviewCols,
  totalClientCount, activeConnectorCount, clientsWithErrors,
  dateFrom, dateTo, compare, compareDateFrom, compareDateTo,
  sortCol: initialSort, sortDir: initialDir,
}: Props) {
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [metricsData,    setMetricsData]    = useState<MetricsApiResponse | null>(null)
  const [metricsError,   setMetricsError]   = useState(false)
  const [attempt,        setAttempt]        = useState(0)
  // Sorting happens here, on data already loaded. It used to be a link per header, so every sort
  // reloaded the whole app; the URL still records it, for sharing and the back button.
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: initialSort, dir: initialDir === 'asc' ? 'asc' : 'desc' })

  useEffect(() => {
    setMetricsLoading(true)
    setMetricsData(null)
    setMetricsError(false)
    const controller = new AbortController()
    const params = new URLSearchParams({ from: dateFrom, to: dateTo })
    if (compare !== 'none' && compareDateFrom && compareDateTo) {
      params.set('compare_from', compareDateFrom)
      params.set('compare_to',   compareDateTo)
    }
    fetch(`/api/admin/dashboard/metrics?${params}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data: MetricsApiResponse) => { setMetricsData(data); setMetricsLoading(false) })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return
        setMetricsError(true)
        setMetricsLoading(false)
      })
    return () => controller.abort()
  // `attempt` is the Retry button: the old one cleared the error without fetching again.
  }, [dateFrom, dateTo, compare, compareDateFrom, compareDateTo, attempt])

  function sortBy(col: string) {
    const dir: 'asc' | 'desc' = sort.col === col && sort.dir === 'desc' ? 'asc' : 'desc'
    setSort({ col, dir })
    const url = new URL(window.location.href)
    url.searchParams.set('sort', col)
    url.searchParams.set('dir', dir)
    window.history.replaceState(window.history.state, '', url)
  }

  const cols = overviewCols.filter((c): c is Col => c in COL_LABEL)

  const rows: BuiltRow[] = useMemo(() => {
    const connsByClient = new Map<string, ShellConnRow[]>()
    for (const conn of connections) {
      const list = connsByClient.get(conn.client_id)
      if (list) list.push(conn); else connsByClient.set(conn.client_id, [conn])
    }
    const jobsByClient = new Map<string, ShellSyncJob[]>()
    for (const job of syncJobs) {
      const list = jobsByClient.get(job.client_id)
      if (list) list.push(job); else jobsByClient.set(job.client_id, [job])
    }

    const built: BuiltRow[] = clients.map(client => {
      const conns  = connsByClient.get(client.id) ?? []
      const jobs   = jobsByClient.get(client.id) ?? []   // newest first
      const latest = jobs[0] ?? null
      const errors = jobs.filter(j => j.status === 'error').length
      const hours  = latest?.completed_at ? (Date.now() - new Date(latest.completed_at).getTime()) / 3_600_000 : Infinity
      const sync: BuiltRow['sync'] =
        !latest                     ? { tone: 'neutral', label: 'No syncs', detail: 'No sync in the last 7 days' }
        : latest.status === 'error' ? { tone: 'danger',  label: errors > 1 ? `${errors} errors` : 'Failed', detail: `Last sync failed${errors > 1 ? `; ${errors} errors in 7 days` : ''}` }
        : hours >= 48               ? { tone: 'warning', label: 'Stale', detail: `Last synced ${ago(hours)}` }
        : errors > 0                ? { tone: 'warning', label: `${errors} error${errors === 1 ? '' : 's'}`, detail: `Synced ${ago(hours)}, ${errors} failed in 7 days` }
        :                             { tone: 'success', label: 'Synced', detail: `Synced ${ago(hours)}` }
      const m = metricsData?.clientMetrics[client.id]
      return {
        id: client.id, name: client.name, logoUrl: client.logo_url ?? null, dashboard_token: client.dashboard_token ?? null,
        connectors: conns.map(c => ({ type: c.connector.type, label: c.connector.label })),
        sync,
        spend: m?.spend ?? 0, conversions: m?.conversions ?? 0, clicks: m?.clicks ?? 0, impressions: m?.impressions ?? 0,
        ctr: m?.ctr ?? 0, roas: m?.roas ?? null, cpl: m?.cpl ?? null, showRoas: m?.showRoas ?? false,
        deltaSpend: m?.deltaSpend, deltaConv: m?.deltaConv, deltaCtr: m?.deltaCtr, deltaClicks: m?.deltaClicks,
        deltaImpr: m?.deltaImpr, deltaRoas: m?.deltaRoas, deltaCpl: m?.deltaCpl,
        afBalance: m?.afBalance ?? 0, pendingAch: m?.pendingAch ?? 0, hasAfLedger: m?.hasAfLedger ?? false,
      }
    })

    if (!sort.col || (!metricsData && sort.col !== 'name')) return built
    const val = (r: BuiltRow): number => {
      switch (sort.col) {
        case 'spend': return r.spend
        case 'roas': case 'roas_cpl': return r.roas ?? -1
        case 'cpa': return r.cpl ?? Infinity
        case 'conversions': return r.conversions
        case 'ctr': return r.ctr
        case 'clicks': return r.clicks
        case 'impressions': return r.impressions
        case 'ad_fuel': return r.hasAfLedger ? r.afBalance : -Infinity
        default: return 0
      }
    }
    return [...built].sort((a, b) => {
      if (sort.col === 'name') return sort.dir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      const d = val(a) - val(b)
      return sort.dir === 'asc' ? d : -d
    })
  }, [clients, connections, syncJobs, metricsData, sort])

  const totalSpend = metricsData?.totalSpend ?? 0
  const totalAf    = metricsData?.totalAdFuelBalance ?? 0

  function cell(row: BuiltRow, col: Col) {
    if (col === 'sync_status') {
      return <StatusBadge tone={row.sync.tone} title={row.sync.detail}>{row.sync.label}</StatusBadge>
    }
    if (metricsLoading) return <Sk w={56} h={12} style={{ marginLeft: 'auto' }} />
    switch (col) {
      case 'spend':       return row.spend > 0 ? <>{fmtMoney(row.spend)}<Delta delta={row.deltaSpend} neutral /></> : <Dash />
      case 'roas':        return row.roas !== null ? <>{fmtX(row.roas)}<Delta delta={row.deltaRoas} /></> : <Dash />
      case 'cpa':         return row.cpl !== null ? <>{fmtMoney(row.cpl)}<Delta delta={row.deltaCpl} inverse /></> : <Dash />
      case 'conversions': return row.conversions > 0 ? <>{row.conversions.toLocaleString()}<Delta delta={row.deltaConv} /></> : <Dash />
      case 'ctr':         return row.ctr > 0 ? <>{fmtPct(row.ctr)}<Delta delta={row.deltaCtr} /></> : <Dash />
      case 'clicks':      return row.clicks > 0 ? <>{row.clicks.toLocaleString()}<Delta delta={row.deltaClicks} /></> : <Dash />
      case 'impressions': return row.impressions > 0 ? <>{row.impressions.toLocaleString()}<Delta delta={row.deltaImpr} /></> : <Dash />
      case 'ad_fuel': {
        if (!row.hasAfLedger) return <Dash />
        const proj = row.afBalance + (row.pendingAch ?? 0)
        return (
          <>
            <span className={row.afBalance < 0 ? 'cl-neg' : row.afBalance > 500 ? 'cl-pos' : 'cl-warn'}>{fmtBalance(row.afBalance)}</span>
            {(row.pendingAch ?? 0) > 0 && <span className={`cl-delta ${proj >= 0 ? 'cl-delta--good' : 'cl-delta--bad'}`}>{fmtBalance(proj)} after ACH</span>}
          </>
        )
      }
    }
  }

  /** The one or two figures a phone row shows. */
  function headline(row: BuiltRow) {
    if (metricsLoading) return <Sk w={120} h={11} />
    const parts: string[] = []
    if (row.spend > 0) parts.push(`${fmtMoney(row.spend)} spend`)
    if (row.showRoas && row.roas !== null) parts.push(`${fmtX(row.roas)} ROAS`)
    else if (row.cpl !== null) parts.push(`${fmtMoney(row.cpl)} CPA`)
    else if (row.conversions > 0) parts.push(`${row.conversions.toLocaleString()} conv.`)
    return parts.length ? parts.join(', ') : 'No spend this period'
  }

  const SortHead = ({ col, label, right }: { col: string; label: string; right?: boolean }) => {
    const on = sort.col === col
    return (
      <th className={right ? 'cl-r' : undefined} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={`cl-sort${on ? ' cl-sort--on' : ''}`} onClick={() => sortBy(col)}>
          {label}
          {on ? (sort.dir === 'asc' ? <CaretUp size={11} weight="bold" aria-hidden /> : <CaretDown size={11} weight="bold" aria-hidden />)
              : <ArrowsDownUp size={11} className="cl-sort-idle" aria-hidden />}
        </button>
      </th>
    )
  }

  return (
    <div>
      {metricsError && (
        <div className="ui-notice ui-notice--danger" role="alert">
          <span>Spend and results couldn’t load, so those columns are empty.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt(a => a + 1)}>Retry</button>
        </div>
      )}

      {/* The period at a glance. */}
      <section className="card cl-stats" aria-label="Totals">
        <div className="cl-stat">
          <span className="cl-stat-label">Clients</span>
          <span className="cl-stat-value">{totalClientCount}</span>
        </div>
        <div className="cl-stat">
          <span className="cl-stat-label">Active connections</span>
          <span className="cl-stat-value">{activeConnectorCount}</span>
        </div>
        <Link href="/admin/system" className="cl-stat cl-stat--link">
          <span className="cl-stat-label">Sync errors, 7 days <CaretRight size={11} weight="bold" aria-hidden /></span>
          <span className={`cl-stat-value${clientsWithErrors > 0 ? ' cl-neg' : ''}`}>{clientsWithErrors}</span>
        </Link>
        <div className="cl-stat">
          <span className="cl-stat-label">Spend this period</span>
          <span className="cl-stat-value">{metricsLoading ? <Sk w={84} h={24} r={6} /> : fmtMoney(totalSpend)}</span>
        </div>
        <Link href="/admin/ad-fuel" className="cl-stat cl-stat--link">
          <span className="cl-stat-label">Ad Fuel balance <CaretRight size={11} weight="bold" aria-hidden /></span>
          <span className={`cl-stat-value${!metricsLoading && totalAf < 0 ? ' cl-neg' : ''}`}>{metricsLoading ? <Sk w={84} h={24} r={6} /> : fmtBalance(totalAf)}</span>
        </Link>
      </section>

      {clients.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Buildings size={20} />}
            title="No clients yet"
            actions={<Link href="/admin/clients/new" className="btn btn-primary"><Plus size={15} weight="bold" aria-hidden />Add client</Link>}
          >
            Add a client, then connect their ad accounts and site to see spend and results here.
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Laptop: the table. */}
          <div className="card cl-table-card">
            <div className="ui-scroll-x">
              <table className="cl-table">
                <thead>
                  <tr>
                    <SortHead col="name" label="Client" />
                    <th>Sources</th>
                    {cols.map(c => c === 'sync_status'
                      ? <th key={c}>Sync</th>
                      : SORTABLE.has(c) ? <SortHead key={c} col={c} label={COL_LABEL[c]} right /> : <th key={c} className="cl-r">{COL_LABEL[c]}</th>)}
                    <th aria-label="Links" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/admin/clients/${row.id}`} className="cl-client">
                          <ClientMark name={row.name} logoUrl={row.logoUrl} />
                          <span className="cl-name">{row.name}</span>
                        </Link>
                      </td>
                      <td><Sources list={row.connectors} /></td>
                      {cols.map(c => <td key={c} className={c === 'sync_status' ? undefined : 'cl-r cl-num'}>{cell(row, c)}</td>)}
                      <td className="cl-r cl-menu">
                        <ClientLinksMenu clientId={row.id} clientName={row.name} dashboardToken={row.dashboard_token} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Phone: one row per client. */}
          <div className="card cl-list">
            {rows.map(row => (
              <div key={row.id} className="ui-row cl-list-row">
                <Link href={`/admin/clients/${row.id}`} className="cl-list-main">
                  <ClientMark name={row.name} logoUrl={row.logoUrl} />
                  <span className="ui-row-text">
                    <span className="ui-row-title">{row.name}</span>
                    <span className="ui-row-sub">{headline(row)}</span>
                    <span className="cl-list-meta">
                      <Sources list={row.connectors} max={5} />
                      <StatusBadge tone={row.sync.tone} title={row.sync.detail}>{row.sync.label}</StatusBadge>
                    </span>
                  </span>
                </Link>
                <ClientLinksMenu clientId={row.id} clientName={row.name} dashboardToken={row.dashboard_token} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
