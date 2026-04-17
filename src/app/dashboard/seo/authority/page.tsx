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

  // Fetch connection status and metrics in parallel
  const [{ data: connData }, { data: metricsRows }] = await Promise.all([
    db.from('client_connections')
      .select('id, connector:connectors(type)')
      .eq('client_id', client.id)
      .eq('status', 'active'),
    db.from('ahrefs_metrics')
      .select('date, domain_rating, ahrefs_rank, backlinks, referring_domains, organic_keywords, organic_traffic')
      .eq('client_id', client.id)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: false })
      .limit(10),
  ])

  const latestDate = metricsRows?.[0]?.date ?? dateTo

  // Fetch keyword rankings + top pages for the latest snapshot date
  const [{ data: keywordRows }, { data: pageRows }] = await Promise.all([
    db.from('ahrefs_keywords')
      .select('keyword, position, volume, traffic, difficulty')
      .eq('client_id', client.id)
      .eq('date', latestDate)
      .order('traffic', { ascending: false })
      .limit(25),
    db.from('ahrefs_pages')
      .select('url, organic_traffic, organic_keywords')
      .eq('client_id', client.id)
      .eq('date', latestDate)
      .order('organic_traffic', { ascending: false })
      .limit(15),
  ])

  // Use metrics presence as primary signal — avoids Supabase join shape ambiguity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectorMatch = (connData ?? []).some((c: any) => {
    const conn = c.connector
    if (!conn) return false
    if (Array.isArray(conn)) return conn.some((cn: any) => cn.type === 'ahrefs')
    return conn.type === 'ahrefs'
  })
  const hasAhrefs = connectorMatch || (metricsRows?.length ?? 0) > 0

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

          {/* Keyword Rankings */}
          {(keywordRows?.length ?? 0) > 0 && (
            <div className="card mb-6" style={{ overflow: 'hidden' }}>
              <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Keyword Rankings
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Top keywords by estimated traffic · snapshot {latestDate}
                </p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
                      <th style={{ padding: '0.5rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>Keyword</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 500 }}>Position</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 500 }}>Volume</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 500 }}>Traffic</th>
                      <th style={{ padding: '0.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 500 }}>KD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keywordRows!.map((kw, i) => {
                      const pos = kw.position ?? 999
                      const posColor = pos <= 3 ? 'var(--green)' : pos <= 10 ? '#d97706' : 'var(--text-muted)'
                      const kd = kw.difficulty ?? null
                      const kdColor = kd == null ? 'var(--text-muted)' : kd < 30 ? 'var(--green)' : kd < 60 ? '#d97706' : 'var(--red)'
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                          <td style={{ padding: '0.5rem 1rem', color: 'var(--text-primary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {kw.keyword}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 600, color: posColor }}>
                            {kw.position ?? '—'}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {kw.volume != null ? kw.volume.toLocaleString() : '—'}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {kw.traffic != null ? kw.traffic.toLocaleString() : '—'}
                          </td>
                          <td style={{ padding: '0.5rem 1rem', textAlign: 'center', fontWeight: 600, color: kdColor }}>
                            {kd != null ? kd : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top Organic Pages */}
          {(pageRows?.length ?? 0) > 0 && (
            <div className="card mb-6" style={{ overflow: 'hidden' }}>
              <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Top Organic Pages
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Top pages by organic traffic · snapshot {latestDate}
                </p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
                      <th style={{ padding: '0.5rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>Page</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 500 }}>Traffic</th>
                      <th style={{ padding: '0.5rem 1rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 500 }}>Keywords</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows!.map((pg, i) => {
                      const path = (() => {
                        try { return new URL(pg.url).pathname || pg.url } catch { return pg.url }
                      })()
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                          <td style={{ padding: '0.5rem 1rem', color: 'var(--text-primary)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={pg.url}>
                            {path}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {pg.organic_traffic != null ? pg.organic_traffic.toLocaleString() : '—'}
                          </td>
                          <td style={{ padding: '0.5rem 1rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {pg.organic_keywords != null ? pg.organic_keywords.toLocaleString() : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
