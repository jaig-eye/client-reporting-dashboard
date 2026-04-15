// Admin Overview — /admin/dashboard
// Merged clients + overview: sortable table of all clients with key metrics.

import { Suspense }                  from 'react'
import { createAdminClient }         from '@/lib/supabase/server'
import Link                          from 'next/link'
import type { ConnectorType }        from '@/lib/types'
import { getConnectorDef }           from '@/lib/connectors/registry'
import DateRangePicker               from '@/components/DateRangePicker'
import AdminDateSync                 from './AdminDateSync'
import { calcEfficiencyScore }       from '@/lib/agency-settings'
import type { AgencySettings }       from '@/lib/types'

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
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const today    = new Date()
  const params   = await searchParams
  const dateFrom = params.from ?? getMtdFrom()
  const dateTo   = params.to   ?? fmtDate(today)

  const db = createAdminClient()

  const [
    clientsRes,
    connectionsRes,
    syncErrorsRes,
    googleMetricsRes,
    metaMetricsRes,
    settingsRes,
  ] = await Promise.all([
    db.from('clients')
      .select('id, name, logo_url, benchmark_roas, benchmark_ctr, benchmark_cpc, benchmark_conv_rate, enabled_benchmarks')
      .order('name'),

    db.from('client_connections')
      .select('client_id, last_synced_at, connector:connectors(id, type, label, status)')
      .eq('status', 'active'),

    db.from('sync_jobs')
      .select('id, client_id, status')
      .eq('status', 'error')
      .gte('started_at', subtractDays(today, 7).toISOString()),

    db.from('google_ads_metrics')
      .select('client_id, spend, clicks, impressions, conversions, conversions_value')
      .gte('date', dateFrom)
      .lte('date', dateTo),

    db.from('meta_ads_metrics')
      .select('client_id, spend, clicks, impressions, conversions')
      .gte('date', dateFrom)
      .lte('date', dateTo),

    db.from('agency_settings')
      .select('benchmark_roas, benchmark_ctr, benchmark_cpc, benchmark_conv_rate')
      .single(),
  ])

  interface ConnRow {
    client_id: string
    last_synced_at: string | null | undefined
    connector: { id: string; type: string; label: string; status: string }
  }

  type ClientRow = {
    id: string; name: string; logo_url?: string
    benchmark_roas?: number | null; benchmark_ctr?: number | null
    benchmark_cpc?: number | null; benchmark_conv_rate?: number | null
    enabled_benchmarks?: string[] | null
  }

  const clients     = (clientsRes.data     ?? []) as ClientRow[]
  const connections = (connectionsRes.data ?? []) as unknown as ConnRow[]
  const syncErrors  = syncErrorsRes.data   ?? []
  const googleRows  = googleMetricsRes.data ?? []
  const metaRows    = metaMetricsRes.data   ?? []
  const globalSettings = (settingsRes.data as Pick<AgencySettings, 'benchmark_roas' | 'benchmark_ctr' | 'benchmark_cpc' | 'benchmark_conv_rate'> | null) ?? {
    benchmark_roas: 3.0, benchmark_ctr: 0.03, benchmark_cpc: 3.0, benchmark_conv_rate: 0.03,
  }

  // Group connections by client_id
  const connsByClient = new Map<string, ConnRow[]>()
  for (const conn of connections) {
    if (!connsByClient.has(conn.client_id)) connsByClient.set(conn.client_id, [])
    connsByClient.get(conn.client_id)!.push(conn)
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

  // Aggregate Meta Ads metrics per client
  const metaByClient = new Map<string, { spend: number; clicks: number; conv: number; impressions: number }>()
  for (const row of metaRows) {
    const cid = row.client_id as string
    if (!metaByClient.has(cid)) metaByClient.set(cid, { spend: 0, clicks: 0, conv: 0, impressions: 0 })
    const m = metaByClient.get(cid)!
    m.spend       += (row.spend        as number) ?? 0
    m.clicks      += (row.clicks       as number) ?? 0
    m.conv        += (row.conversions  as number) ?? 0
    m.impressions += (row.impressions  as number) ?? 0
  }

  // Summary totals
  const googleSpendTotal  = Array.from(googleByClient.values()).reduce((s, m) => s + m.spend, 0)
  const metaSpendTotal    = Array.from(metaByClient.values()).reduce((s, m) => s + m.spend, 0)
  const totalSpend        = googleSpendTotal + metaSpendTotal
  const clientsWithErrors = new Set(syncErrors.map(j => j.client_id as string)).size

  // Build per-client row data
  const clientRows = clients.map(client => {
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

    const lastSyncedAt = conns
      .filter(c => c.last_synced_at)
      .sort((a, b) => new Date(b.last_synced_at!).getTime() - new Date(a.last_synced_at!).getTime())[0]
      ?.last_synced_at ?? null

    const hoursStale = lastSyncedAt
      ? (Date.now() - new Date(lastSyncedAt).getTime()) / 3_600_000
      : Infinity

    const syncErrCount = syncErrors.filter(j => j.client_id === client.id).length

    return {
      id: client.id, name: client.name, logoUrl: client.logo_url ?? null,
      connectors: conns.map(c => ({ type: c.connector.type, label: getConnectorDef(c.connector.type as ConnectorType).label })),
      spend, conversions, ctr, roas, cpl, showRoas, efficiencyScore, lastSyncedAt, hoursStale, syncErrCount,
    }
  })

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

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Clients"        value={String(clients.length)}     href="/admin/connections" />
        <StatCard label="Active Connectors"    value={String(connections.length)} href="/admin/connections" color="blue" />
        <StatCard label="Sync Errors (7d)"     value={String(clientsWithErrors)}  href="/admin/system"      color={clientsWithErrors > 0 ? 'red' : 'default'} />
        <StatCard label="Total Spend (period)" value={fmtSpend(totalSpend)}       href="#"                  color="blue" />
      </div>

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
                  {['Client', 'Sources', 'Spend', 'ROAS / CPL', 'Conversions', 'CTR', 'Sync Status', ''].map(h => (
                    <th key={h} style={{
                      padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem',
                      color: 'var(--text-muted)', whiteSpace: 'nowrap', background: 'var(--bg-secondary)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientRows.map((row, i) => {
                  const syncDot = row.hoursStale < 24 ? 'var(--green)' : row.hoursStale < 72 ? 'var(--amber, #f59e0b)' : 'var(--red)'
                  const syncLabel = row.lastSyncedAt
                    ? new Date(row.lastSyncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'Never'

                  return (
                    <tr key={row.id} style={{
                      borderBottom: i < clientRows.length - 1 ? '1px solid var(--border-subtle)' : undefined,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      {/* Client name */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <a
                          href={`/api/admin/preview/${row.id}`}
                          style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {row.logoUrl ? (
                              <img src={row.logoUrl} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'contain' }} />
                            ) : (
                              <div style={{ width: 22, height: 22, borderRadius: 4, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                {row.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            {row.name}
                          </div>
                        </a>
                      </td>

                      {/* Data sources */}
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {row.connectors.length === 0 ? (
                          <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>None</span>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {row.connectors.map((c, ci) => (
                              <span key={ci} title={c.label} style={{
                                display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: 4, fontSize: '0.6875rem', fontWeight: 500,
                                background: 'var(--bg-tertiary, var(--border-subtle))', color: 'var(--text-secondary)',
                              }}>{c.label}</span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Spend */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {row.spend > 0 ? fmtSpend(row.spend) : <Dash />}
                      </td>

                      {/* ROAS / CPL */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {row.showRoas && row.roas !== null
                          ? <span style={{ color: 'var(--text-primary)' }}>{fmtX(row.roas)}</span>
                          : row.cpl !== null
                            ? <span style={{ color: 'var(--text-primary)' }}>{fmtSpend(row.cpl)}</span>
                            : <Dash />
                        }
                      </td>

                      {/* Conversions */}
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {row.conversions > 0 ? row.conversions.toLocaleString() : <Dash />}
                      </td>

                      {/* CTR */}
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {row.ctr > 0 ? fmtPct(row.ctr) : <Dash />}
                      </td>

                      {/* Sync status */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: syncDot, display: 'inline-block', flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{syncLabel}</span>
                          {row.syncErrCount > 0 && (
                            <span style={{ background: 'var(--red-subtle)', color: 'var(--red)', borderRadius: 4, padding: '0 0.3rem', fontSize: '0.6875rem', fontWeight: 600 }}>
                              {row.syncErrCount} err
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <Link
                            href={`/admin/clients/${row.id}`}
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                          >
                            Settings
                          </Link>
                        </div>
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

function Dash() {
  return <span style={{ color: 'var(--text-faint)' }}>—</span>
}

function StatCard({
  label, value, href, color = 'default',
}: {
  label: string; value: string; href: string; color?: 'blue' | 'green' | 'red' | 'default'
}) {
  const colors = { blue: 'var(--blue)', green: 'var(--green)', red: 'var(--red)', default: 'var(--text-primary)' }
  const inner = (
    <div className="card p-5">
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-3xl font-bold" style={{ color: colors[color], fontVariantNumeric: 'tabular-nums' }}>{value}</p>
    </div>
  )
  if (href === '#') return inner
  return <Link href={href} className="card-hover block" style={{ textDecoration: 'none' }}>{inner}</Link>
}
