// Admin Overview — /admin
// Client health report with per-client spend, conversions, ROAS, and sync status.

import { createAdminClient }      from '@/lib/supabase/server'
import Link                        from 'next/link'
import type { Client, ClientConnection, Connector } from '@/lib/types'
import { getConnectorDef }         from '@/lib/connectors/registry'
import type { ConnectorType }       from '@/lib/types'
import PreviewButton               from '@/components/admin/PreviewButton'

export const dynamic = 'force-dynamic'

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function subtractDays(d: Date, n: number) { return new Date(d.getTime() - n * 86_400_000) }

function timeSince(isoString: string): string {
  const hours = (Date.now() - new Date(isoString).getTime()) / 3_600_000
  if (hours < 1)    return 'Just now'
  if (hours < 24)   return `${Math.floor(hours)}h ago`
  const days = hours / 24
  if (days  < 7)    return `${Math.floor(days)}d ago`
  return `${Math.floor(days / 7)}w ago`
}

type SyncHealth = 'green' | 'amber' | 'red'
function syncHealth(lastSynced: string | null | undefined): SyncHealth {
  if (!lastSynced) return 'red'
  const hours = (Date.now() - new Date(lastSynced).getTime()) / 3_600_000
  if (hours < 24)  return 'green'
  if (hours < 72)  return 'amber'
  return 'red'
}

function fmtSpend(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string }
}) {
  const today     = new Date()
  const dateFrom  = searchParams.from ?? fmtDate(subtractDays(today, 30))
  const dateTo    = searchParams.to   ?? fmtDate(today)

  const db = createAdminClient()

  const [
    clientsRes,
    connectionsRes,
    syncErrorsRes,
    googleMetricsRes,
    metaMetricsRes,
  ] = await Promise.all([
    db.from('clients').select('id, name, logo_url').order('name'),

    db.from('client_connections')
      .select('client_id, last_synced_at, connector:connectors(id, type, label, status)')
      .eq('status', 'active'),

    db.from('sync_jobs')
      .select('id, client_id, status')
      .eq('status', 'error')
      .gte('started_at', subtractDays(today, 7).toISOString()),

    db.from('google_ads_metrics')
      .select('client_id, spend, conversions, conversions_value')
      .gte('date', dateFrom)
      .lte('date', dateTo),

    db.from('meta_ads_metrics')
      .select('client_id, spend')
      .gte('date', dateFrom)
      .lte('date', dateTo),
  ])

  interface ConnRow {
    client_id: string
    last_synced_at: string | null | undefined
    connector: { id: string; type: string; label: string; status: string }
  }

  const clients     = (clientsRes.data     ?? []) as { id: string; name: string; logo_url?: string }[]
  const connections = (connectionsRes.data ?? []) as unknown as ConnRow[]
  const syncErrors  = syncErrorsRes.data   ?? []
  const googleRows  = googleMetricsRes.data ?? []
  const metaRows    = metaMetricsRes.data   ?? []

  // Group connections by client_id
  const connsByClient = new Map<string, ConnRow[]>()
  for (const conn of connections) {
    if (!connsByClient.has(conn.client_id)) connsByClient.set(conn.client_id, [])
    connsByClient.get(conn.client_id)!.push(conn)
  }

  // Aggregate Google Ads metrics per client
  const googleByClient = new Map<string, { spend: number; conv: number; value: number }>()
  for (const row of googleRows) {
    const cid = row.client_id as string
    if (!googleByClient.has(cid)) googleByClient.set(cid, { spend: 0, conv: 0, value: 0 })
    const m = googleByClient.get(cid)!
    m.spend += (row.spend             as number) ?? 0
    m.conv  += (row.conversions       as number) ?? 0
    m.value += (row.conversions_value as number) ?? 0
  }

  // Aggregate Meta Ads spend per client
  const metaByClient = new Map<string, number>()
  for (const row of metaRows) {
    const cid = row.client_id as string
    metaByClient.set(cid, (metaByClient.get(cid) ?? 0) + ((row.spend as number) ?? 0))
  }

  // Summary totals
  const googleSpendTotal = Array.from(googleByClient.values()).reduce((s, m) => s + m.spend, 0)
  const metaSpendTotal   = Array.from(metaByClient.values()).reduce((s, v) => s + v, 0)
  const totalSpend = googleSpendTotal + metaSpendTotal
  const clientsWithErrors = new Set(syncErrors.map(j => j.client_id as string)).size

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Page header */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="page-title">Agency Overview</h1>
        <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
          <form method="GET" className="flex items-center gap-2">
            <label htmlFor="from" className="sr-only">From date</label>
            <input
              id="from"
              type="date"
              name="from"
              defaultValue={dateFrom}
              className="input text-sm"
              style={{ padding: '0.3rem 0.6rem', width: '140px' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>to</span>
            <label htmlFor="to" className="sr-only">To date</label>
            <input
              id="to"
              type="date"
              name="to"
              defaultValue={dateTo}
              className="input text-sm"
              style={{ padding: '0.3rem 0.6rem', width: '140px' }}
            />
            <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.3rem 0.75rem' }}>
              Apply
            </button>
          </form>
          <Link href="/admin/clients/new" className="btn btn-primary">+ Add Client</Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Clients"        value={String(clients.length)}       href="/admin/clients"     />
        <StatCard label="Active Connectors"    value={String(connections.length)}   href="/admin/connections" color="blue" />
        <StatCard label="Sync Errors (7d)"     value={String(clientsWithErrors)}    href="/admin/connections" color={clientsWithErrors > 0 ? 'red' : 'default'} />
        <StatCard label="Total Spend (period)" value={fmtSpend(totalSpend)}         href="#"                  color="blue" />
      </div>

      {/* Client health list */}
      {clients.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No clients yet</p>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Add your first client to start managing their data connections.
          </p>
          <Link href="/admin/clients/new" className="btn btn-primary">+ Add Client</Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Sources</th>
                <th style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>Spend</th>
                <th style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>Conversions</th>
                <th style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>ROAS</th>
                <th>Last Sync</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clients.map(client => {
                const conns       = connsByClient.get(client.id) ?? []
                const gData       = googleByClient.get(client.id)
                const metaSpend   = metaByClient.get(client.id) ?? 0
                const totalClientSpend = (gData?.spend ?? 0) + metaSpend
                const conversions = gData?.conv  ?? 0
                const roas        = gData && gData.spend > 0 ? gData.value / gData.spend : null

                const lastSyncedAt = conns
                  .filter(c => c.last_synced_at)
                  .sort((a, b) => new Date(b.last_synced_at!).getTime() - new Date(a.last_synced_at!).getTime())[0]
                  ?.last_synced_at ?? null

                const health = syncHealth(lastSyncedAt)
                const healthColors: Record<SyncHealth, string> = {
                  green: 'var(--green)',
                  amber: 'var(--amber, #f59e0b)',
                  red:   'var(--red)',
                }

                return (
                  <tr key={client.id}>
                    {/* Client name */}
                    <td>
                      <Link
                        href={`/admin/clients/${client.id}`}
                        style={{ textDecoration: 'none', color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.875rem' }}
                      >
                        {client.name}
                      </Link>
                    </td>

                    {/* Active connector badges */}
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {conns.length === 0 ? (
                          <span className="badge badge-gray">None</span>
                        ) : (
                          conns.map(conn => {
                            const def = getConnectorDef(conn.connector.type as ConnectorType)
                            return (
                              <span key={conn.connector.id} className="badge badge-blue" style={{ fontSize: '0.6875rem' }}>
                                {def.label}
                              </span>
                            )
                          })
                        )}
                      </div>
                    </td>

                    {/* Spend */}
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.875rem' }}>
                      {totalClientSpend > 0 ? fmtSpend(totalClientSpend) : (
                        <span style={{ color: 'var(--text-faint)' }}>—</span>
                      )}
                    </td>

                    {/* Conversions (Google only) */}
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.875rem' }}>
                      {conversions > 0 ? conversions.toLocaleString() : (
                        <span style={{ color: 'var(--text-faint)' }}>—</span>
                      )}
                    </td>

                    {/* ROAS */}
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.875rem' }}>
                      {roas !== null ? (
                        <span style={{ color: roas >= 1 ? 'var(--green)' : 'var(--red)' }}>
                          {roas.toFixed(2)}x
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-faint)' }}>—</span>
                      )}
                    </td>

                    {/* Last sync + status dot */}
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: healthColors[health],
                            flexShrink: 0,
                            display: 'inline-block',
                          }}
                        />
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {lastSyncedAt ? timeSince(lastSyncedAt) : 'Never'}
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <PreviewButton clientId={client.id} />
                        <Link
                          href={`/admin/clients/${client.id}`}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}
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
      )}
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  href,
  color = 'default',
}: {
  label: string
  value: string
  href: string
  color?: 'blue' | 'green' | 'red' | 'default'
}) {
  const colors = {
    blue:    'var(--blue)',
    green:   'var(--green)',
    red:     'var(--red)',
    default: 'var(--text-primary)',
  }
  const inner = (
    <div className="card p-5" style={{ textDecoration: 'none' }}>
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-3xl font-bold" style={{ color: colors[color], fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
    </div>
  )
  if (href === '#') return inner
  return (
    <Link href={href} className="card-hover block" style={{ textDecoration: 'none' }}>
      {inner}
    </Link>
  )
}
