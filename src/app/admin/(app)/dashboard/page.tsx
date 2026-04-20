// Admin Overview — /admin/dashboard
// Merged clients + overview: sortable table of all clients with key metrics.

import { unstable_noStore as noStore } from 'next/cache'
import { Suspense }                  from 'react'
import { createAdminClient }         from '@/lib/supabase/server'
import Link                          from 'next/link'
import type { ConnectorType }        from '@/lib/types'
import { ConnectorLogo }             from '@/components/ConnectorLogo'
import { GearSix }                   from '@phosphor-icons/react/dist/ssr'
import DateRangePicker               from '@/components/DateRangePicker'
import AdminDateSync                 from './AdminDateSync'
import { calcEfficiencyScore }       from '@/lib/agency-settings'
import type { AgencySettings }       from '@/lib/types'
import { resolveMetaConversions }    from '@/lib/metrics'

export const dynamic = 'force-dynamic'

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function subtractDays(d: Date, n: number) { return new Date(d.getTime() - n * 86_400_000) }

function getMtdFrom() {
  const now = new Date()
  return fmtDate(new Date(now.getFullYear(), now.getMonth(), 1))
}

function fmtSpend(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%` }
function fmtX(n: number)   { return `${n.toFixed(2)}x` }

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; sort?: string; dir?: string }>
}) {
  noStore()
  const today    = new Date()
  const params   = await searchParams
  const dateFrom = params.from  ?? getMtdFrom()
  const dateTo   = params.to    ?? fmtDate(today)
  const sortCol  = params.sort  ?? ''
  const sortDir  = params.dir   === 'asc' ? 'asc' : 'desc'

  const db = createAdminClient()

  const [
    clientsRes,
    connectionsRes,
    syncJobsRes,
    googleMetricsRes,
    metaMetricsRes,
    settingsRes,
    campaignAssignmentsRes,
  ] = await Promise.all([
    db.from('clients')
      .select('id, name, logo_url, benchmark_roas, benchmark_ctr, benchmark_cpc, benchmark_conv_rate, enabled_benchmarks, lead_action, lead_action_fallback, purchase_action, purchase_action_fallback')
      .order('name'),

    db.from('client_connections')
      .select('client_id, connector:connectors(id, type, label, status)')
      .eq('status', 'active'),

    // Fetch recent sync jobs (last 7 days) — we take the most recent per client
    db.from('sync_jobs')
      .select('id, client_id, status, completed_at')
      .gte('started_at', subtractDays(today, 7).toISOString())
      .order('completed_at', { ascending: false }),

    db.from('google_ads_metrics')
      .select('client_id, spend, clicks, impressions, conversions, conversions_value')
      .gte('date', dateFrom)
      .lte('date', dateTo),

    db.from('meta_ads_metrics')
      .select('client_id, campaign_id, spend, clicks, impressions, actions, action_values')
      .gte('date', dateFrom)
      .lte('date', dateTo),

    db.from('agency_settings')
      .select('benchmark_roas, benchmark_ctr, benchmark_cpc, benchmark_conv_rate, overview_columns, default_lead_action, default_lead_action_fallback, default_purchase_action, default_purchase_action_fallback')
      .single(),

    db.from('client_campaign_assignments')
      .select('client_id, campaign_id, display_mode')
      .eq('source', 'meta_ads'),
  ])

  interface ConnRow {
    client_id: string
    connector: { id: string; type: string; label: string; status: string }
  }

  interface SyncJobRow {
    id: string
    client_id: string
    status: string
    completed_at: string | null
  }

  type ClientRow = {
    id: string; name: string; logo_url?: string
    benchmark_roas?: number | null; benchmark_ctr?: number | null
    benchmark_cpc?: number | null; benchmark_conv_rate?: number | null
    enabled_benchmarks?: string[] | null
    lead_action?: string | null; lead_action_fallback?: string | null
    purchase_action?: string | null; purchase_action_fallback?: string | null
  }

  const clients     = (clientsRes.data     ?? []) as ClientRow[]
  const connections = (connectionsRes.data ?? []) as unknown as ConnRow[]
  const syncJobs    = (syncJobsRes.data    ?? []) as SyncJobRow[]
  const googleRows  = googleMetricsRes.data ?? []
  const metaRows    = metaMetricsRes.data   ?? []
  const rawSettings = settingsRes.data as Record<string, unknown> | null
  const globalSettings = (rawSettings as Pick<AgencySettings, 'benchmark_roas' | 'benchmark_ctr' | 'benchmark_cpc' | 'benchmark_conv_rate'> | null) ?? {
    benchmark_roas: 3.0, benchmark_ctr: 0.03, benchmark_cpc: 3.0, benchmark_conv_rate: 0.03,
  }
  const defaultLeadAction         = (rawSettings?.default_lead_action         as string | null) ?? 'onsite_conversion.lead_grouped'
  const defaultLeadFallback       = (rawSettings?.default_lead_action_fallback as string | null) ?? 'lead'
  const defaultPurchaseAction     = (rawSettings?.default_purchase_action      as string | null) ?? 'purchase'
  const defaultPurchaseFallback   = (rawSettings?.default_purchase_action_fallback as string | null) ?? null
  const DEFAULT_COLS = ['spend', 'roas_cpl', 'conversions', 'ctr', 'sync_status']
  const overviewCols: string[] = Array.isArray(rawSettings?.overview_columns)
    ? rawSettings!.overview_columns as string[]
    : DEFAULT_COLS

  // Campaign display_mode map: `${clientId}:${campaignId}` → 'ecommerce' | 'lead_gen'
  const campaignModeMap = new Map<string, string>()
  for (const a of (campaignAssignmentsRes.data ?? []) as { client_id: string; campaign_id: string; display_mode: string }[]) {
    campaignModeMap.set(`${a.client_id}:${a.campaign_id}`, a.display_mode)
  }

  // Build per-client conversion action config (client override → agency default)
  const clientConfigMap = new Map<string, { leadAction: string; leadFallback: string | null; purchaseAction: string; purchaseFallback: string | null }>()
  for (const c of clients) {
    clientConfigMap.set(c.id, {
      leadAction:      c.lead_action      ?? defaultLeadAction,
      leadFallback:    c.lead_action_fallback  ?? defaultLeadFallback,
      purchaseAction:  c.purchase_action   ?? defaultPurchaseAction,
      purchaseFallback: c.purchase_action_fallback ?? defaultPurchaseFallback,
    })
  }


  // Group connections by client_id
  const connsByClient = new Map<string, ConnRow[]>()
  for (const conn of connections) {
    if (!connsByClient.has(conn.client_id)) connsByClient.set(conn.client_id, [])
    connsByClient.get(conn.client_id)!.push(conn)
  }

  // Most recent sync job per client
  const latestSyncByClient = new Map<string, SyncJobRow>()
  for (const job of syncJobs) {
    const cid = job.client_id
    if (!latestSyncByClient.has(cid)) {
      // syncJobs is ordered by completed_at DESC, so first entry per client = most recent
      latestSyncByClient.set(cid, job)
    }
  }

  // Aggregate Google Ads metrics per client
  const googleByClient = new Map<string, { spend: number; clicks: number; conv: number; value: number; impressions: number }>()
  for (const row of googleRows) {
    const cid = row.client_id as string
    if (!googleByClient.has(cid)) googleByClient.set(cid, { spend: 0, clicks: 0, conv: 0, value: 0, impressions: 0 })
    const m = googleByClient.get(cid)!
    m.spend       += (row.spend             as number) ?? 0
    m.clicks      += (row.clicks            as number) ?? 0
    m.conv        += (row.conversions       as number) ?? 0
    m.value       += (row.conversions_value as number) ?? 0
    m.impressions += (row.impressions       as number) ?? 0
  }

  // Aggregate Meta Ads metrics per client — apply per-client conversion mapping
  const metaByClient = new Map<string, { spend: number; clicks: number; conv: number; impressions: number }>()
  for (const row of metaRows) {
    const cid = row.client_id as string
    if (!metaByClient.has(cid)) metaByClient.set(cid, { spend: 0, clicks: 0, conv: 0, impressions: 0 })
    const m = metaByClient.get(cid)!
    m.spend       += (row.spend        as number) ?? 0
    m.clicks      += (row.clicks       as number) ?? 0
    m.impressions += (row.impressions  as number) ?? 0
    // Apply client-specific conversion mapping (same logic as client dashboard)
    const cfg      = clientConfigMap.get(cid)
    const campMode = campaignModeMap.get(`${cid}:${row.campaign_id as string}`) ?? 'lead_gen'
    const isEcom   = campMode === 'ecommerce'
    const primary  = isEcom ? (cfg?.purchaseAction  ?? defaultPurchaseAction)  : (cfg?.leadAction    ?? defaultLeadAction)
    const fallback = isEcom ? (cfg?.purchaseFallback ?? defaultPurchaseFallback) : (cfg?.leadFallback ?? defaultLeadFallback)
    if (Array.isArray(row.actions)) {
      const resolved = resolveMetaConversions(
        row.actions as { action_type: string; value: string }[],
        (row.action_values as { action_type: string; value: string }[] | null) ?? [],
        primary,
        fallback,
      )
      m.conv += resolved.conversions
    }
  }

  // Summary totals
  const googleSpendTotal  = Array.from(googleByClient.values()).reduce((s, m) => s + m.spend, 0)
  const metaSpendTotal    = Array.from(metaByClient.values()).reduce((s, m) => s + m.spend, 0)
  const totalSpend        = googleSpendTotal + metaSpendTotal
  const syncErrorCount    = syncJobs.filter(j => j.status === 'error').length
  const clientsWithErrors = new Set(syncJobs.filter(j => j.status === 'error').map(j => j.client_id)).size

  // Build per-client row data
  let clientRows = clients.map(client => {
    const conns        = connsByClient.get(client.id) ?? []
    const gData        = googleByClient.get(client.id)
    const mData        = metaByClient.get(client.id)
    const spend        = (gData?.spend ?? 0) + (mData?.spend ?? 0)
    const clicks       = (gData?.clicks ?? 0) + (mData?.clicks ?? 0)
    const impressions  = (gData?.impressions ?? 0) + (mData?.impressions ?? 0)
    const conversions  = Math.round((gData?.conv ?? 0) + (mData?.conv ?? 0))
    const enabledBenchmarks = client.enabled_benchmarks ?? null
    const showRoas     = enabledBenchmarks ? enabledBenchmarks.includes('roas') : (gData?.value ?? 0) > 0
    const roas         = showRoas && gData && gData.spend > 0 ? gData.value / gData.spend : null
    const ctr          = impressions > 0 ? clicks / impressions : 0
    const cpl          = conversions > 0 ? spend / conversions : null

    const benchmarks = {
      benchmark_roas:      client.benchmark_roas      ?? globalSettings.benchmark_roas,
      benchmark_ctr:       client.benchmark_ctr       ?? globalSettings.benchmark_ctr,
      benchmark_cpc:       client.benchmark_cpc       ?? globalSettings.benchmark_cpc,
      benchmark_conv_rate: client.benchmark_conv_rate ?? globalSettings.benchmark_conv_rate,
    }

    const efficiencyScore = spend > 0 && (roas !== null || ctr > 0)
      ? calcEfficiencyScore({ roas: roas ?? 0, ctr, cpc: clicks > 0 ? spend / clicks : 0, convRate: clicks > 0 ? conversions / clicks : 0 }, benchmarks)
      : null

    // Use most recent sync job for status dot
    const latestJob = latestSyncByClient.get(client.id) ?? null
    const syncStatus: 'success' | 'error' | 'none' = latestJob
      ? (latestJob.status === 'error' ? 'error' : 'success')
      : 'none'
    const completedAt = latestJob?.completed_at ? new Date(latestJob.completed_at) : null
    const hoursStale  = completedAt ? (Date.now() - completedAt.getTime()) / 3_600_000 : Infinity

    const syncErrCount = syncJobs.filter(j => j.client_id === client.id && j.status === 'error').length

    return {
      id: client.id, name: client.name, logoUrl: client.logo_url ?? null,
      connectors: conns.map(c => ({ type: c.connector.type as ConnectorType, label: c.connector.label })),
      spend, conversions, clicks, impressions, ctr, roas, cpl, showRoas, efficiencyScore, hoursStale, syncStatus, syncErrCount,
    }
  })

  // Sort
  if (sortCol) {
    clientRows = clientRows.sort((a, b) => {
      let av: number, bv: number
      if (sortCol === 'spend') {
        av = a.spend; bv = b.spend
      } else if (sortCol === 'roas_cpl') {
        av = a.roas ?? a.cpl ?? -1; bv = b.roas ?? b.cpl ?? -1
      } else if (sortCol === 'conversions') {
        av = a.conversions; bv = b.conversions
      } else if (sortCol === 'ctr') {
        av = a.ctr; bv = b.ctr
      } else if (sortCol === 'clicks') {
        av = a.clicks; bv = b.clicks
      } else if (sortCol === 'impressions') {
        av = a.impressions; bv = b.impressions
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

  function sortHref(col: string) {
    const newDir = sortCol === col && sortDir === 'desc' ? 'asc' : 'desc'
    const base = new URLSearchParams()
    if (params.from) base.set('from', params.from)
    if (params.to)   base.set('to',   params.to)
    base.set('sort', col)
    base.set('dir',  newDir)
    return `/admin/dashboard?${base}`
  }

  function SortArrow({ col }: { col: string }) {
    if (sortCol !== col) return <span style={{ opacity: 0.3, marginLeft: 3 }}>↕</span>
    return <span style={{ marginLeft: 3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

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
            <DateRangePicker from={dateFrom} to={dateTo} />
          </Suspense>
          <Link href="/admin/clients/new" className="btn btn-primary">+ Add Client</Link>
        </div>
      </div>

      {/* Stat cards — only Sync Errors is clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Clients"        value={String(clients.length)} />
        <StatCard label="Active Connectors"    value={String(connections.length)} color="blue" />
        <StatCard label="Sync Errors (7d)"     value={String(clientsWithErrors)} href="/admin/system" color={clientsWithErrors > 0 ? 'red' : 'default'} />
        <StatCard label="Total Spend (period)" value={fmtSpend(totalSpend)} color="blue" />
      </div>

      {/* Row hover via CSS — server component can't use onMouseEnter/Leave */}
      <style>{`.client-row:hover { background: var(--bg-secondary) !important; }`}</style>

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
                  <SortableTh col="name" label="Client" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                  <th style={TH_STYLE}>Sources</th>
                  {overviewCols.map(col => {
                    if (col === 'spend')       return <SortableTh key={col} col="spend"       label="Spend"      sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'roas_cpl')    return <SortableTh key={col} col="roas_cpl"    label="ROAS / CPL" sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'conversions') return <SortableTh key={col} col="conversions" label="Conv."      sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'ctr')         return <SortableTh key={col} col="ctr"         label="CTR"        sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'clicks')      return <SortableTh key={col} col="clicks"      label="Clicks"     sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'impressions') return <SortableTh key={col} col="impressions" label="Impr."      sortHref={sortHref} sortCol={sortCol} sortDir={sortDir} />
                    if (col === 'sync_status') return <th key={col} style={TH_STYLE}>Sync</th>
                    return null
                  })}
                  <th style={TH_STYLE}></th>
                </tr>
              </thead>
              <tbody>
                {clientRows.map((row, i) => {
                  // Sync dot: green if last job was success within 48h, amber if >48h, red if error/none
                  let syncDot = 'var(--red)'
                  if (row.syncStatus === 'success') {
                    syncDot = row.hoursStale < 48 ? 'var(--green)' : 'var(--amber, #f59e0b)'
                  }

                  return (
                    <tr key={row.id} className="client-row" style={{
                      borderBottom: i < clientRows.length - 1 ? '1px solid var(--border-subtle)' : undefined,
                      transition: 'background 0.15s',
                    }}>
                      {/* Client name + logo */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <a href={`/api/admin/preview/${row.id}`}
                          style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {row.logoUrl ? (
                              <img src={row.logoUrl} alt="" style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'contain', flexShrink: 0 }} />
                            ) : (
                              <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                {row.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span>{row.name}</span>
                          </div>
                        </a>
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

                      {/* Dynamic columns in saved order */}
                      {overviewCols.map(col => {
                        if (col === 'spend') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {row.spend > 0 ? fmtSpend(row.spend) : <Dash />}
                          </td>
                        )
                        if (col === 'roas_cpl') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {row.showRoas && row.roas !== null
                              ? <span style={{ color: 'var(--text-primary)' }}>{fmtX(row.roas)}</span>
                              : row.cpl !== null
                                ? <span style={{ color: 'var(--text-primary)' }}>{fmtSpend(row.cpl)}</span>
                                : <Dash />
                            }
                          </td>
                        )
                        if (col === 'conversions') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {row.conversions > 0 ? row.conversions.toLocaleString() : <Dash />}
                          </td>
                        )
                        if (col === 'ctr') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {row.ctr > 0 ? fmtPct(row.ctr) : <Dash />}
                          </td>
                        )
                        if (col === 'clicks') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {row.clicks > 0 ? row.clicks.toLocaleString() : <Dash />}
                          </td>
                        )
                        if (col === 'impressions') return (
                          <td key={col} style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {row.impressions > 0 ? row.impressions.toLocaleString() : <Dash />}
                          </td>
                        )
                        if (col === 'sync_status') return (
                          <td key={col} style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ width: 9, height: 9, borderRadius: '50%', background: syncDot, display: 'inline-block', flexShrink: 0 }} />
                              {row.syncErrCount > 0 && (
                                <span style={{ background: 'var(--red-subtle)', color: 'var(--red)', borderRadius: 4, padding: '0 0.3rem', fontSize: '0.6875rem', fontWeight: 600 }}>
                                  {row.syncErrCount}
                                </span>
                              )}
                            </div>
                          </td>
                        )
                        return null
                      })}

                      {/* Actions — gear icon */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <Link
                          href={`/admin/clients/${row.id}`}
                          title="Client Settings"
                          style={{ display: 'inline-flex', alignItems: 'center', padding: '0.3rem', borderRadius: 6, color: 'var(--text-muted)', textDecoration: 'none', transition: 'background 0.1s, color 0.1s' }}
                        >
                          <GearSix size={16} aria-hidden />
                        </Link>
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

// ─── sub-components ───────────────────────────────────────────────────────────

const TH_STYLE: React.CSSProperties = {
  padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.6875rem',
  color: 'var(--text-faint)', whiteSpace: 'nowrap', background: 'var(--bg-secondary)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}

function SortableTh({ col, label, sortHref, sortCol, sortDir }: {
  col: string; label: string
  sortHref: (col: string) => string
  sortCol: string; sortDir: string
}) {
  const active = sortCol === col
  return (
    <th style={{ ...TH_STYLE, cursor: 'pointer' }}>
      <a href={sortHref(col)} style={{ textDecoration: 'none', color: active ? 'var(--text-primary)' : 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
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

function StatCard({
  label, value, href, color = 'default',
}: {
  label: string; value: string; href?: string; color?: 'blue' | 'green' | 'red' | 'default'
}) {
  const colors = { blue: 'var(--blue)', green: 'var(--green)', red: 'var(--red)', default: 'var(--text-primary)' }
  const inner = (
    <div className="card p-5">
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-3xl font-bold" style={{ color: colors[color], fontVariantNumeric: 'tabular-nums' }}>{value}</p>
    </div>
  )
  if (!href) return inner
  return <Link href={href} className="card-hover block" style={{ textDecoration: 'none', borderRadius: 12, overflow: 'hidden' }}>{inner}</Link>
}
