'use client'

import { useState, useEffect }  from 'react'
import Link                      from 'next/link'
import { ConnectorLogo }         from '@/components/ConnectorLogo'
import { PresentationChart, BookOpen, Check } from '@phosphor-icons/react/dist/ssr'
import type { ConnectorType }    from '@/lib/types'
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

// ─── props ────────────────────────────────────────────────────────────────────

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

// ─── formatting helpers ───────────────────────────────────────────────────────

function fmtSpend(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%` }
function fmtX(n: number)   { return `${n.toFixed(2)}x` }
function fmtBalance(n: number) {
  const neg = n < 0
  const abs = Math.abs(n)
  const str = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(1)}M`
             : abs >= 1_000    ? `$${(abs / 1_000).toFixed(1)}k`
             : `$${Math.round(abs).toLocaleString()}`
  return neg ? `-${str}` : str
}

// ─── sub-components ───────────────────────────────────────────────────────────

const TH_STYLE: React.CSSProperties = {
  padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.6875rem',
  color: 'var(--text-faint)', whiteSpace: 'nowrap', background: 'var(--bg-secondary)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}

function SortableTh({ col, label, href, sortCol, sortDir, align = 'left' }: {
  col: string; label: string; href: string
  sortCol: string; sortDir: string; align?: 'left' | 'right'
}) {
  const active = sortCol === col
  return (
    <th style={{ ...TH_STYLE, cursor: 'pointer', textAlign: align }}>
      <a href={href} style={{
        textDecoration: 'none',
        color: active ? 'var(--text-primary)' : 'var(--text-faint)',
        display: 'inline-flex', alignItems: 'center',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        gap: 2, width: '100%',
      }}>
        {label}
        <span style={{ opacity: active ? 1 : 0.35, fontSize: '0.7rem' }}>
          {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </a>
    </th>
  )
}

function Dash() {
  return <span style={{ color: 'var(--text-faint)' }}>—</span>
}

function DeltaBadge({
  delta, inverse = false, neutral = false,
}: {
  delta: number | undefined; inverse?: boolean; neutral?: boolean
}) {
  if (delta == null || !isFinite(delta)) return null
  const up    = delta > 0
  const good  = neutral ? null : (inverse ? !up : up)
  const color = good === null ? 'var(--text-faint)' : good ? '#16a34a' : '#dc2626'
  return (
    <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 600, lineHeight: 1, marginTop: 2, color }}>
      {up ? '+' : ''}{delta.toFixed(1)}%
    </span>
  )
}

function SkeletonCell({ width = 60 }: { width?: number }) {
  return (
    <span style={{
      display: 'inline-block',
      width,
      height: 14,
      borderRadius: 4,
      background: 'var(--border, #e5e7eb)',
      animation: 'pulse 1.5s ease-in-out infinite',
    }} />
  )
}

function StatCard({
  label, value, href, color = 'default',
}: {
  label: string; value: string | null; href?: string; color?: 'blue' | 'green' | 'red' | 'default'
}) {
  const colors = {
    blue: 'var(--blue)', green: 'var(--green)',
    red: 'var(--red)', default: 'var(--text-primary)',
  }
  const inner = (
    <div className="card p-5">
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-3xl font-bold" style={{ color: colors[color], fontVariantNumeric: 'tabular-nums' }}>
        {value === null ? (
          <span style={{
            display: 'inline-block', width: 80, height: 28, borderRadius: 4,
            background: 'var(--border, #e5e7eb)',
            animation: 'pulse 1.5s ease-in-out infinite',
            verticalAlign: 'middle',
          }} />
        ) : value}
      </p>
    </div>
  )
  if (!href) return inner
  return (
    <Link href={href} className="card-hover block" style={{ textDecoration: 'none', borderRadius: 12, overflow: 'hidden' }}>
      {inner}
    </Link>
  )
}

// ─── built row type ───────────────────────────────────────────────────────────

type BuiltRow = {
  id: string
  name: string
  logoUrl: string | null
  dashboard_token: string | null
  connectors: { type: ConnectorType; label: string }[]
  syncStatus: 'success' | 'error' | 'none'
  syncErrCount: number
  hoursStale: number
} & Pick<ClientMetricData,
  | 'spend' | 'conversions' | 'clicks' | 'impressions' | 'ctr'
  | 'roas' | 'cpl' | 'showRoas' | 'efficiencyScore'
  | 'deltaSpend' | 'deltaConv' | 'deltaCtr' | 'deltaClicks'
  | 'deltaImpr' | 'deltaRoas' | 'deltaCpl'
  | 'afBalance' | 'hasAfLedger' | 'pendingAch'
>

// ─── main component ───────────────────────────────────────────────────────────

export default function DashboardClientShell({
  clients,
  connections,
  syncJobs,
  overviewCols,
  totalClientCount,
  activeConnectorCount,
  clientsWithErrors,
  dateFrom,
  dateTo,
  compare,
  compareDateFrom,
  compareDateTo,
  sortCol,
  sortDir,
}: Props) {
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [metricsData,    setMetricsData]    = useState<MetricsApiResponse | null>(null)
  const [metricsError,   setMetricsError]   = useState(false)
  const [copiedId,       setCopiedId]       = useState<string | null>(null)

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
      .then((data: MetricsApiResponse) => {
        setMetricsData(data)
        setMetricsLoading(false)
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return
        setMetricsError(true)
        setMetricsLoading(false)
      })

    return () => controller.abort()
  }, [dateFrom, dateTo, compare, compareDateFrom, compareDateTo])

  // ── build lookup maps from fast server data ──────────────────────────────
  const connsByClient = new Map<string, ShellConnRow[]>()
  for (const conn of connections) {
    if (!connsByClient.has(conn.client_id)) connsByClient.set(conn.client_id, [])
    connsByClient.get(conn.client_id)!.push(conn)
  }

  const latestSyncByClient = new Map<string, ShellSyncJob>()
  for (const job of syncJobs) {
    // syncJobs is ordered by completed_at DESC, first entry per client = most recent
    if (!latestSyncByClient.has(job.client_id)) latestSyncByClient.set(job.client_id, job)
  }

  // ── sort href builder ────────────────────────────────────────────────────
  function sortHref(col: string): string {
    const newDir = sortCol === col && sortDir === 'desc' ? 'asc' : 'desc'
    const base = new URLSearchParams()
    if (dateFrom)           base.set('from',    dateFrom)
    if (dateTo)             base.set('to',      dateTo)
    if (compare !== 'none') base.set('compare', compare)
    base.set('sort', col)
    base.set('dir',  newDir)
    return `/admin/dashboard?${base}`
  }

  // ── build client rows ────────────────────────────────────────────────────
  let clientRows: BuiltRow[] = clients.map(client => {
    const conns      = connsByClient.get(client.id) ?? []
    const latestJob  = latestSyncByClient.get(client.id) ?? null
    const syncStatus: 'success' | 'error' | 'none' = latestJob
      ? (latestJob.status === 'error' ? 'error' : 'success')
      : 'none'
    const completedAt  = latestJob?.completed_at ? new Date(latestJob.completed_at) : null
    const hoursStale   = completedAt ? (Date.now() - completedAt.getTime()) / 3_600_000 : Infinity
    const syncErrCount = syncJobs.filter(j => j.client_id === client.id && j.status === 'error').length

    const metrics = metricsData?.clientMetrics[client.id]

    return {
      id:              client.id,
      name:            client.name,
      logoUrl:         client.logo_url ?? null,
      dashboard_token: client.dashboard_token ?? null,
      connectors: conns.map(c => ({
        type:  c.connector.type as ConnectorType,
        label: c.connector.label,
      })),
      syncStatus,
      syncErrCount,
      hoursStale,
      spend:           metrics?.spend           ?? 0,
      conversions:     metrics?.conversions      ?? 0,
      clicks:          metrics?.clicks           ?? 0,
      impressions:     metrics?.impressions      ?? 0,
      ctr:             metrics?.ctr              ?? 0,
      roas:            metrics?.roas             ?? null,
      cpl:             metrics?.cpl              ?? null,
      showRoas:        metrics?.showRoas         ?? false,
      efficiencyScore: metrics?.efficiencyScore  ?? null,
      deltaSpend:      metrics?.deltaSpend,
      deltaConv:       metrics?.deltaConv,
      deltaCtr:        metrics?.deltaCtr,
      deltaClicks:     metrics?.deltaClicks,
      deltaImpr:       metrics?.deltaImpr,
      deltaRoas:       metrics?.deltaRoas,
      deltaCpl:        metrics?.deltaCpl,
      afBalance:       metrics?.afBalance        ?? 0,
      pendingAch:      metrics?.pendingAch       ?? 0,
      hasAfLedger:     metrics?.hasAfLedger      ?? false,
    }
  })

  // ── sort (only meaningful once metrics have loaded) ──────────────────────
  if (sortCol && metricsData) {
    clientRows = [...clientRows].sort((a, b) => {
      let av: number, bv: number
      if (sortCol === 'spend') {
        av = a.spend; bv = b.spend
      } else if (sortCol === 'roas_cpl' || sortCol === 'roas') {
        av = a.roas ?? -1; bv = b.roas ?? -1
      } else if (sortCol === 'cpa') {
        av = a.cpl ?? Infinity; bv = b.cpl ?? Infinity
      } else if (sortCol === 'conversions') {
        av = a.conversions; bv = b.conversions
      } else if (sortCol === 'ctr') {
        av = a.ctr; bv = b.ctr
      } else if (sortCol === 'clicks') {
        av = a.clicks; bv = b.clicks
      } else if (sortCol === 'impressions') {
        av = a.impressions; bv = b.impressions
      } else if (sortCol === 'ad_fuel') {
        av = a.hasAfLedger ? a.afBalance : -Infinity
        bv = b.hasAfLedger ? b.afBalance : -Infinity
      } else if (sortCol === 'name') {
        return sortDir === 'asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name)
      } else {
        return 0
      }
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }

  // ── summary values ───────────────────────────────────────────────────────
  const totalSpend        = metricsData?.totalSpend        ?? 0
  const totalAdFuelBalance = metricsData?.totalAdFuelBalance ?? 0
  const afBalColor: 'green' | 'red' | 'default' =
    metricsLoading   ? 'default'
    : totalAdFuelBalance > 500  ? 'green'
    : totalAdFuelBalance < 0    ? 'red'
    : 'default'

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Pulse keyframe — defined once here to avoid a separate CSS file */}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>

      {/* Metrics error banner */}
      {metricsError && (
        <div style={{
          marginBottom: '1rem', padding: '0.625rem 1rem', borderRadius: 8,
          background: 'var(--red-subtle)', border: '1px solid var(--red)',
          display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8125rem',
        }}>
          <span style={{ color: 'var(--red)', fontWeight: 600 }}>⚠</span>
          <span style={{ color: 'var(--red)' }}>
            Metric data failed to load. Spend and ROAS figures may be unavailable.
          </span>
          <button
            style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--red)', background: 'none', border: '1px solid var(--red)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
            onClick={() => { setMetricsError(false); setMetricsLoading(true); setMetricsData(null) }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <StatCard label="Total Clients"        value={String(totalClientCount)} />
        <StatCard label="Active Connectors"    value={String(activeConnectorCount)} color="blue" />
        <StatCard
          label="Sync Errors (7d)"
          value={String(clientsWithErrors)}
          href="/admin/system"
          color={clientsWithErrors > 0 ? 'red' : 'default'}
        />
        <StatCard
          label="Total Spend (period)"
          value={metricsLoading ? null : fmtSpend(totalSpend)}
          color="blue"
        />
        <StatCard
          label="Total Ad Fuel"
          value={metricsLoading ? null : fmtBalance(totalAdFuelBalance)}
          color={afBalColor}
          href="/admin/ad-fuel"
        />
      </div>

      {/* Row hover via CSS */}
      <style>{`.client-row:hover { background: var(--bg-muted) !important; }`}</style>

      {/* Client table */}
      {clients.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No clients yet</p>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Add your first client to start managing their data connections.
          </p>
          <Link href="/admin/clients/new" className="btn btn-primary">+ Add Client</Link>
        </div>
      ) : (
        <div className="card overflow-hidden" style={{ padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <SortableTh col="name" label="Client" href={sortHref('name')} sortCol={sortCol} sortDir={sortDir} />
                  <th style={TH_STYLE}>Sources</th>

                  {overviewCols.map(col => {
                    if (col === 'spend')       return <SortableTh key={col} col="spend"       label="Spend"      align="right" href={sortHref('spend')}       sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'roas_cpl')    return <SortableTh key={col} col="roas"        label="ROAS / CPA" align="right" href={sortHref('roas')}        sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'roas')        return <SortableTh key={col} col="roas"        label="ROAS"       align="right" href={sortHref('roas')}        sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'cpa')         return <SortableTh key={col} col="cpa"         label="CPA"        align="right" href={sortHref('cpa')}         sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'conversions') return <SortableTh key={col} col="conversions" label="Conv."      align="right" href={sortHref('conversions')} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'ctr')         return <SortableTh key={col} col="ctr"         label="CTR"        align="right" href={sortHref('ctr')}         sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'clicks')      return <SortableTh key={col} col="clicks"      label="Clicks"     align="right" href={sortHref('clicks')}      sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'impressions') return <SortableTh key={col} col="impressions" label="Impr."      align="right" href={sortHref('impressions')} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'sync_status') return <th key={col} style={TH_STYLE}>Sync</th>
                    if (col === 'ad_fuel')     return <SortableTh key={col} col="ad_fuel"     label="Ad Fuel"    align="right" href={sortHref('ad_fuel')}     sortCol={sortCol} sortDir={sortDir} />
                    return null
                  })}

                  <th style={TH_STYLE} />
                </tr>
              </thead>

              <tbody>
                {clientRows.map((row, i) => {
                  let syncDot = 'var(--red)'
                  if (row.syncStatus === 'success') {
                    syncDot = row.hoursStale < 48 ? 'var(--green)' : 'var(--amber, #f59e0b)'
                  }

                  return (
                    <tr
                      key={row.id}
                      className="client-row"
                      style={{
                        borderBottom: i < clientRows.length - 1 ? '1px solid var(--border-subtle)' : undefined,
                        background:   i % 2 === 1 ? 'var(--bg-subtle)' : undefined,
                        transition:   'background 0.15s',
                      }}
                    >
                      {/* Client name + logo */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <Link
                          href={`/admin/clients/${row.id}`}
                          style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {row.logoUrl ? (
                              <img
                                src={row.logoUrl}
                                alt=""
                                style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'contain', flexShrink: 0 }}
                              />
                            ) : (
                              <div style={{
                                width: 26, height: 26, borderRadius: 6, background: 'var(--accent)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.625rem', fontWeight: 700, color: '#fff', flexShrink: 0,
                              }}>
                                {row.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span>{row.name}</span>
                          </div>
                        </Link>
                      </td>

                      {/* Data sources — connector logo icons */}
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {row.connectors.length === 0 ? (
                          <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            {row.connectors.map((c, ci) => (
                              <span key={ci} title={c.label} style={{ display: 'flex', alignItems: 'center' }}>
                                <ConnectorLogo type={c.type} size={16} aria-hidden />
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Dynamic metric columns */}
                      {overviewCols.map(col => {
                        if (col === 'spend') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {metricsLoading ? <SkeletonCell /> : (
                              <>
                                {row.spend > 0 ? fmtSpend(row.spend) : <Dash />}
                                <DeltaBadge delta={row.deltaSpend} neutral />
                              </>
                            )}
                          </td>
                        )

                        if (col === 'roas_cpl') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {metricsLoading ? <SkeletonCell /> : (
                              row.showRoas && row.roas !== null
                                ? <><span style={{ color: 'var(--text-primary)' }}>{fmtX(row.roas)}</span><DeltaBadge delta={row.deltaRoas} /></>
                                : row.cpl !== null
                                  ? <><span style={{ color: 'var(--text-primary)' }}>{fmtSpend(row.cpl)}</span><DeltaBadge delta={row.deltaCpl} inverse /></>
                                  : <Dash />
                            )}
                          </td>
                        )

                        if (col === 'roas') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {metricsLoading ? <SkeletonCell /> : (
                              <>
                                {row.roas !== null ? <span style={{ color: 'var(--text-primary)' }}>{fmtX(row.roas)}</span> : <Dash />}
                                <DeltaBadge delta={row.deltaRoas} />
                              </>
                            )}
                          </td>
                        )

                        if (col === 'cpa') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {metricsLoading ? <SkeletonCell /> : (
                              <>
                                {row.cpl !== null ? <span style={{ color: 'var(--text-primary)' }}>{fmtSpend(row.cpl)}</span> : <Dash />}
                                <DeltaBadge delta={row.deltaCpl} inverse />
                              </>
                            )}
                          </td>
                        )

                        if (col === 'conversions') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {metricsLoading ? <SkeletonCell /> : (
                              <>
                                {row.conversions > 0 ? row.conversions.toLocaleString() : <Dash />}
                                <DeltaBadge delta={row.deltaConv} />
                              </>
                            )}
                          </td>
                        )

                        if (col === 'ctr') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {metricsLoading ? <SkeletonCell /> : (
                              <>
                                {row.ctr > 0 ? fmtPct(row.ctr) : <Dash />}
                                <DeltaBadge delta={row.deltaCtr} />
                              </>
                            )}
                          </td>
                        )

                        if (col === 'clicks') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {metricsLoading ? <SkeletonCell /> : (
                              <>
                                {row.clicks > 0 ? row.clicks.toLocaleString() : <Dash />}
                                <DeltaBadge delta={row.deltaClicks} />
                              </>
                            )}
                          </td>
                        )

                        if (col === 'impressions') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {metricsLoading ? <SkeletonCell /> : (
                              <>
                                {row.impressions > 0 ? row.impressions.toLocaleString() : <Dash />}
                                <DeltaBadge delta={row.deltaImpr} />
                              </>
                            )}
                          </td>
                        )

                        if (col === 'sync_status') return (
                          <td key={col} style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{
                                width: 9, height: 9, borderRadius: '50%',
                                background: syncDot, display: 'inline-block', flexShrink: 0,
                              }} />
                              {row.syncErrCount > 0 && (
                                <span style={{
                                  background: 'var(--red-subtle)', color: 'var(--red)',
                                  borderRadius: 4, padding: '0 0.3rem',
                                  fontSize: '0.6875rem', fontWeight: 600,
                                }}>
                                  {row.syncErrCount}
                                </span>
                              )}
                            </div>
                          </td>
                        )

                        if (col === 'ad_fuel') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {metricsLoading ? <SkeletonCell /> : (
                              row.hasAfLedger ? (
                                <div>
                                  <span style={{
                                    color:      row.afBalance > 500 ? 'var(--green)' : row.afBalance < 0 ? 'var(--red)' : 'var(--amber, #f59e0b)',
                                    fontWeight: 600,
                                  }}>
                                    {fmtBalance(row.afBalance)}
                                  </span>
                                  {(row.pendingAch ?? 0) > 0 && (() => {
                                    const proj = row.afBalance + (row.pendingAch ?? 0)
                                    return (
                                      <div style={{ fontSize: '0.7rem', fontWeight: 400, marginTop: 1, color: proj >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                        {fmtBalance(proj)} proj.
                                      </div>
                                    )
                                  })()}
                                </div>
                              ) : <Dash />
                            )}
                          </td>
                        )

                        return null
                      })}

                      {/* Actions — ad library copy + gear icon */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 2 }}>
                        {row.dashboard_token && (
                          <button
                            title="Copy Ad Library link"
                            onClick={() => {
                              void navigator.clipboard.writeText(`${window.location.origin}/share/ads?token=${row.dashboard_token}`)
                              setCopiedId(row.id)
                              setTimeout(() => setCopiedId(c => c === row.id ? null : c), 1500)
                            }}
                            style={{
                              display: 'inline-flex', alignItems: 'center',
                              padding: '0.3rem', borderRadius: 6,
                              border: 'none', background: 'none',
                              color: copiedId === row.id ? 'var(--green)' : 'var(--text-muted)',
                              cursor: 'pointer', transition: 'color 0.15s',
                            }}
                          >
                            {copiedId === row.id
                              ? <Check size={16} aria-hidden />
                              : <BookOpen size={16} aria-hidden />}
                          </button>
                        )}
                        <a
                          href={`/api/admin/preview/${row.id}`}
                          title="View Client Dashboard"
                          style={{
                            display: 'inline-flex', alignItems: 'center',
                            padding: '0.3rem', borderRadius: 6,
                            color: 'var(--text-muted)', textDecoration: 'none',
                            transition: 'background 0.1s, color 0.1s',
                          }}
                        >
                          <PresentationChart size={16} aria-hidden />
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
