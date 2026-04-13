// Admin Overview — /admin
// Client health cards with efficiency scores, KPIs, insights, and sync status.

import { Suspense }                  from 'react'
import { createAdminClient }         from '@/lib/supabase/server'
import Link                          from 'next/link'
import type { ConnectorType }        from '@/lib/types'
import { getConnectorDef }           from '@/lib/connectors/registry'
import DateRangePicker               from '@/components/DateRangePicker'
import AdminDateSync                 from './AdminDateSync'
import ClientHealthCard              from '@/components/admin/ClientHealthCard'
import type { ClientHealthCardProps } from '@/components/admin/ClientHealthCard'
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
      .select('id, name, logo_url, benchmark_roas, benchmark_ctr, benchmark_cpc, benchmark_conv_rate')
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
      .select('client_id, spend')
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

  // Aggregate Google Ads metrics per client (sum across all campaigns/days)
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

  // Aggregate Meta Ads spend per client
  const metaByClient = new Map<string, number>()
  for (const row of metaRows) {
    const cid = row.client_id as string
    metaByClient.set(cid, (metaByClient.get(cid) ?? 0) + ((row.spend as number) ?? 0))
  }

  // Summary totals
  const googleSpendTotal     = Array.from(googleByClient.values()).reduce((s, m) => s + m.spend, 0)
  const metaSpendTotal       = Array.from(metaByClient.values()).reduce((s, v) => s + v, 0)
  const totalSpend           = googleSpendTotal + metaSpendTotal
  const clientsWithErrors    = new Set(syncErrors.map(j => j.client_id as string)).size

  // ── Build per-client card data ──────────────────────────────────────────────

  const clientCards: ClientHealthCardProps[] = clients.map((client, i) => {
    const conns        = connsByClient.get(client.id) ?? []
    const gData        = googleByClient.get(client.id)
    const metaSpend    = metaByClient.get(client.id) ?? 0
    const spend        = (gData?.spend ?? 0) + metaSpend
    const conversions  = Math.round(gData?.conv ?? 0)
    const clicks       = gData?.clicks ?? 0
    const impressions  = gData?.impressions ?? 0
    const hasEcomData  = (gData?.value ?? 0) > 0
    const roas         = hasEcomData && gData && gData.spend > 0 ? gData.value / gData.spend : null
    // Compute from aggregated totals — more accurate than averaging per-row values
    const ctr          = impressions > 0 ? clicks / impressions : 0
    const cpc          = clicks > 0 ? (gData?.spend ?? 0) / clicks : 0
    const convRate     = clicks > 0 ? conversions / clicks : 0
    const cpl          = conversions > 0 ? spend / conversions : null

    // Resolve benchmarks: client-level overrides first, then agency defaults
    const benchmarks = {
      benchmark_roas:      client.benchmark_roas      ?? globalSettings.benchmark_roas,
      benchmark_ctr:       client.benchmark_ctr       ?? globalSettings.benchmark_ctr,
      benchmark_cpc:       client.benchmark_cpc       ?? globalSettings.benchmark_cpc,
      benchmark_conv_rate: client.benchmark_conv_rate ?? globalSettings.benchmark_conv_rate,
    }

    // Only compute score when there's meaningful data (some spend + conversion signals)
    const efficiencyScore = spend > 0 && (roas !== null || ctr > 0)
      ? calcEfficiencyScore({ roas: roas ?? 0, ctr, cpc, convRate }, benchmarks)
      : null

    // Insight chips (max 2)
    const insights: string[] = []
    if (conns.length === 0) {
      insights.push('No data sources')
    } else if (spend === 0) {
      insights.push('No spend recorded')
    } else {
      if (hasEcomData && roas !== null && roas > 0 && roas < benchmarks.benchmark_roas) {
        insights.push(`ROAS ${roas.toFixed(1)}x below ${benchmarks.benchmark_roas}x target`)
      }
      if (convRate > 0 && convRate < benchmarks.benchmark_conv_rate / 2) {
        insights.push('Conv rate critically low')
      }
    }

    const lastSyncedAt = conns
      .filter(c => c.last_synced_at)
      .sort((a, b) => new Date(b.last_synced_at!).getTime() - new Date(a.last_synced_at!).getTime())[0]
      ?.last_synced_at ?? null

    const hoursStale = lastSyncedAt
      ? (Date.now() - new Date(lastSyncedAt).getTime()) / 3_600_000
      : Infinity
    if (hoursStale > 48 && conns.length > 0 && insights.length < 2) {
      insights.push('Data may be stale')
    }

    const syncErrors7d = syncErrors.filter(j => j.client_id === client.id).length

    return {
      id:              client.id,
      name:            client.name,
      logoUrl:         client.logo_url ?? null,
      connectors:      conns.map(c => ({
        id:    c.connector.id,
        type:  c.connector.type,
        label: getConnectorDef(c.connector.type as ConnectorType).label,
      })),
      efficiencyScore,
      totalSpend:  spend,
      hasEcomData,
      roas,
      ctr,
      conversions,
      cpl,
      insights:    insights.slice(0, 2),
      lastSyncedAt,
      syncErrors7d,
      delay: i,
    }
  })

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Restore / persist date range via localStorage */}
      <Suspense fallback={null}>
        <AdminDateSync />
      </Suspense>

      {/* Page header */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="page-title">Agency Overview</h1>
        <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
          <Suspense fallback={null}>
            <DateRangePicker from={dateFrom} to={dateTo} />
          </Suspense>
          <Link href="/admin/clients/new" className="btn btn-primary">+ Add Client</Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Clients"        value={String(clients.length)}     href="/admin/clients"     />
        <StatCard label="Active Connectors"    value={String(connections.length)} href="/admin/connections" color="blue" />
        <StatCard label="Sync Errors (7d)"     value={String(clientsWithErrors)}  href="/admin/system"      color={clientsWithErrors > 0 ? 'red' : 'default'} />
        <StatCard label="Total Spend (period)" value={fmtSpend(totalSpend)}       href="#"                  color="blue" />
      </div>

      {/* Client health cards */}
      {clients.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No clients yet</p>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Add your first client to start managing their data connections.
          </p>
          <Link href="/admin/clients/new" className="btn btn-primary">+ Add Client</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {clientCards.map(card => (
            <ClientHealthCard key={card.id} {...card} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

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
