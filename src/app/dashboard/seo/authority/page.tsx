// ─────────────────────────────────────────────────────────────────────────────
// Authority (Ahrefs) Page — /dashboard/seo/authority
// Shows Domain Rating, backlinks, referring domains, and organic traffic
// sourced from the ahrefs_metrics table (synced via Ahrefs API v3).
// ─────────────────────────────────────────────────────────────────────────────

import { cookies }           from 'next/headers'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import type { Client }       from '@/lib/types'
import SparkMetricCard       from '@/components/SparkMetricCard'
import DateRangePicker       from '@/components/DateRangePicker'
import { LinkSimple }        from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

export default async function AuthorityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const cookieStore = await cookies()
  const db          = createAdminClient()
  const params      = await searchParams

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const { data: clientData } = await db.from('clients').select('*').eq('dashboard_token', token).single()
  const client = clientData as Client | null
  if (!client) redirect('/access')

  const today    = new Date()
  const toDate   = params.to   ? new Date(params.to)   : today
  const fromDate = params.from ? new Date(params.from) : new Date(today.getFullYear(), today.getMonth(), 1)
  const dateFrom = fromDate.toISOString().split('T')[0]
  const dateTo   = toDate.toISOString().split('T')[0]

  // Check if client has an Ahrefs connection (two-step to avoid unreliable joined-column filter)
  const { data: connData } = await db
    .from('client_connections')
    .select('id, connector:connectors(type)')
    .eq('client_id', client.id)
    .eq('status', 'active')

  const hasAhrefs = (connData ?? []).some(
    (c: { connector: { type: string } | null }) => c.connector?.type === 'ahrefs'
  )

  // Fetch the most recent Ahrefs snapshot within the date range
  const { data: metricsRows } = await db
    .from('ahrefs_metrics')
    .select('date, domain_rating, ahrefs_rank, backlinks, referring_domains, organic_keywords, organic_traffic')
    .eq('client_id', client.id)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: false })
    .limit(10)

  const latest = metricsRows?.[0]

  // Build sparkline trend from available snapshots (newest first → reverse for chart)
  const trend = (metricsRows ?? []).slice(0, 8).reverse()
  const drTrend  = trend.map(r => ({ v: r.domain_rating    ?? 0 }))
  const blTrend  = trend.map(r => ({ v: r.backlinks         ?? 0 }))
  const rdTrend  = trend.map(r => ({ v: r.referring_domains ?? 0 }))
  const otTrend  = trend.map(r => ({ v: r.organic_traffic   ?? 0 }))

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      {/* Page header */}
      <div className="page-header">
        <div className="flex items-center gap-2">
          <LinkSimple size={18} weight="duotone" style={{ color: '#f59e0b' }} aria-hidden />
          <h1 className="page-title">Authority</h1>
          {!hasAhrefs && (
            <span className="badge badge-amber" style={{ fontSize: '0.6875rem' }}>Not connected</span>
          )}
        </div>
        <DateRangePicker from={dateFrom} to={dateTo} />
      </div>

      {!hasAhrefs ? (
        /* No connection state */
        <div className="card p-12 text-center" style={{ maxWidth: 480, margin: '2rem auto' }}>
          <LinkSimple size={40} style={{ color: '#f59e0b', margin: '0 auto 1rem' }} />
          <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Ahrefs not connected
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Ask your account manager to connect Ahrefs to start tracking Domain Rating,
            backlinks, and organic traffic.
          </p>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <SparkMetricCard
              label="Domain Rating"
              value={latest?.domain_rating != null ? latest.domain_rating.toFixed(1) : '—'}
              sparkData={drTrend}
            />
            <SparkMetricCard
              label="Backlinks"
              value={latest?.backlinks != null ? latest.backlinks.toLocaleString() : '—'}
              sparkData={blTrend}
            />
            <SparkMetricCard
              label="Referring Domains"
              value={latest?.referring_domains != null ? latest.referring_domains.toLocaleString() : '—'}
              sparkData={rdTrend}
            />
            <SparkMetricCard
              label="Organic Traffic"
              value={latest?.organic_traffic != null ? latest.organic_traffic.toLocaleString() : '—'}
              sparkData={otTrend}
            />
          </div>

          {/* Snapshot info */}
          {latest ? (
            <div className="card p-4" style={{ marginBottom: '1.5rem' }}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  Latest snapshot: <span style={{ color: 'var(--text-primary)' }}>{latest.date}</span>
                  {latest.ahrefs_rank && (
                    <> — Ahrefs Rank: <span style={{ color: 'var(--text-primary)' }}>#{latest.ahrefs_rank.toLocaleString()}</span></>
                  )}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  Organic keywords: {latest.organic_keywords?.toLocaleString() ?? '—'}
                </p>
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center mb-6">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No data for this period — sync pending or no snapshots yet.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
