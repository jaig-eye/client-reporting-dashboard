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
import { LinkSimple }        from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

export default async function AuthorityPage() {
  const cookieStore = await cookies()
  const db          = createAdminClient()

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const { data: clientData } = await db.from('clients').select('*').eq('dashboard_token', token).single()
  const client = clientData as Client | null
  if (!client) redirect('/access')

  // Phase 1: fetch connections, metrics (no date filter — snapshots are weekly, not date-range),
  // and the two most recent keyword snapshot dates (for correct date alignment).
  // Keywords/pages are stored with date=resolvedTo (sync end date), which differs from the
  // weekly snapshot dates in ahrefs_metrics, so we resolve the keyword date independently.
  const [{ data: connData }, { data: metricsRows }, { data: kwDates }] = await Promise.all([
    db.from('client_connections')
      .select('id, connector:connectors(type)')
      .eq('client_id', client.id)
      .eq('status', 'active'),
    db.from('ahrefs_metrics')
      .select('date, domain_rating, ahrefs_rank, backlinks, referring_domains, organic_keywords, organic_traffic, traffic_value, paid_keywords, paid_traffic, new_backlinks, lost_backlinks, new_referring_domains, lost_referring_domains')
      .eq('client_id', client.id)
      .order('date', { ascending: false })
      .limit(10),
    db.from('ahrefs_keywords')
      .select('date')
      .eq('client_id', client.id)
      .order('date', { ascending: false })
      .limit(2),
  ])

  const latestKwDate = kwDates?.[0]?.date ?? null
  const prevKwDate   = kwDates?.[1]?.date ?? null

  // Phase 2: fetch keywords and pages using the actual keyword snapshot dates
  const [{ data: keywordRows }, { data: pageRows }, { data: prevKeywordRows }] = await Promise.all([
    latestKwDate
      ? db.from('ahrefs_keywords')
          .select('keyword, position, volume, traffic, difficulty')
          .eq('client_id', client.id)
          .eq('date', latestKwDate)
          .order('traffic', { ascending: false })
          .limit(25)
      : Promise.resolve({ data: null as null }),
    latestKwDate
      ? db.from('ahrefs_pages')
          .select('url, organic_traffic, organic_keywords')
          .eq('client_id', client.id)
          .eq('date', latestKwDate)
          .order('organic_traffic', { ascending: false })
          .limit(15)
      : Promise.resolve({ data: null as null }),
    prevKwDate
      ? db.from('ahrefs_keywords')
          .select('keyword, position')
          .eq('client_id', client.id)
          .eq('date', prevKwDate)
      : Promise.resolve({ data: null as null }),
  ])

  // Map previous keyword positions for delta calculation
  const prevKwMap = new Map<string, number>(
    (prevKeywordRows ?? []).map(r => [r.keyword, r.position ?? 999])
  )

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
  const tvTrend  = trend.map(r => ({ v: (r as Record<string, unknown>).traffic_value as number ?? 0 }))
  const pkTrend  = trend.map(r => ({ v: (r as Record<string, unknown>).paid_keywords as number ?? 0 }))
  const ptTrend  = trend.map(r => ({ v: (r as Record<string, unknown>).paid_traffic  as number ?? 0 }))

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* Page header — no date picker: Ahrefs data is periodic weekly snapshots, not date-range data */}
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div className="flex items-center gap-2">
            <LinkSimple size={18} weight="duotone" style={{ color: '#f59e0b' }} aria-hidden />
            <h1 className="page-title">Authority</h1>
            {!hasAhrefs && (
              <span className="badge badge-amber" style={{ fontSize: '0.6875rem' }}>Not connected</span>
            )}
          </div>
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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

            {/* Link Velocity — new/lost backlinks & referring domains (shown when available) */}
            {(() => {
              const nb = (latest as Record<string, unknown> | undefined)?.new_backlinks          as number | null | undefined
              const lb = (latest as Record<string, unknown> | undefined)?.lost_backlinks         as number | null | undefined
              const nr = (latest as Record<string, unknown> | undefined)?.new_referring_domains  as number | null | undefined
              const lr = (latest as Record<string, unknown> | undefined)?.lost_referring_domains as number | null | undefined
              if (nb == null && lb == null && nr == null && lr == null) return null
              return (
                <div className="card p-4">
                  <p className="metric-label mb-3" style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Link Velocity</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {nb != null && (
                      <div>
                        <p className="metric-label mb-1">New Backlinks</p>
                        <p style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--green)' }}>+{nb.toLocaleString()}</p>
                      </div>
                    )}
                    {lb != null && (
                      <div>
                        <p className="metric-label mb-1">Lost Backlinks</p>
                        <p style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--red)' }}>−{lb.toLocaleString()}</p>
                      </div>
                    )}
                    {nr != null && (
                      <div>
                        <p className="metric-label mb-1">New Ref. Domains</p>
                        <p style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--green)' }}>+{nr.toLocaleString()}</p>
                      </div>
                    )}
                    {lr != null && (
                      <div>
                        <p className="metric-label mb-1">Lost Ref. Domains</p>
                        <p style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--red)' }}>−{lr.toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* Extended metrics row (traffic value + paid) */}
            {(() => {
              const tv = (latest as Record<string, unknown> | undefined)?.traffic_value as number | null | undefined
              const pk = (latest as Record<string, unknown> | undefined)?.paid_keywords as number | null | undefined
              const pt = (latest as Record<string, unknown> | undefined)?.paid_traffic  as number | null | undefined
              if (tv == null && pk == null && pt == null) return null
              return (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <SparkMetricCard
                    label="Traffic Value"
                    value={tv != null ? `$${tv.toLocaleString()}` : '—'}
                    sparkData={tvTrend}
                  />
                  <SparkMetricCard
                    label="Paid Keywords"
                    value={pk != null ? pk.toLocaleString() : '—'}
                    sparkData={pkTrend}
                  />
                  <SparkMetricCard
                    label="Paid Traffic"
                    value={pt != null ? pt.toLocaleString() : '—'}
                    sparkData={ptTrend}
                  />
                </div>
              )
            })()}

            {/* Snapshot info */}
            {latest ? (
              <div className="card p-4">
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
              <div className="card p-8 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No data for this period — sync pending or no snapshots yet.
                </p>
              </div>
            )}

            {/* Keyword Rankings */}
            {(keywordRows?.length ?? 0) > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Keyword Rankings
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Top keywords by estimated traffic · snapshot {latestKwDate}
                  </p>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
                        <th style={{ padding: '0.5rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>Keyword</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 500 }}>Position</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 500 }}>Change</th>
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

                        // Compute position delta vs previous snapshot
                        let deltaCell: React.ReactNode
                        if (!prevKwMap.size) {
                          deltaCell = <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</td>
                        } else if (!prevKwMap.has(kw.keyword)) {
                          deltaCell = <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--blue)', fontSize: '0.75rem', fontWeight: 600 }}>New</td>
                        } else {
                          const prevPos = prevKwMap.get(kw.keyword)!
                          const currPos = kw.position ?? 999
                          const delta   = prevPos - currPos // positive = improved (lower position #)
                          if (delta === 0) {
                            deltaCell = <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</td>
                          } else {
                            deltaCell = (
                              <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 600, fontSize: '0.75rem', color: delta > 0 ? 'var(--green)' : 'var(--red)' }}>
                                {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
                              </td>
                            )
                          }
                        }

                        return (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                            <td style={{ padding: '0.5rem 1rem', color: 'var(--text-primary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {kw.keyword}
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 600, color: posColor }}>
                              {kw.position ?? '—'}
                            </td>
                            {deltaCell}
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
                {prevKwDate && (
                  <p className="text-xs px-4 pb-3 pt-2" style={{ color: 'var(--text-faint)' }}>
                    Change vs snapshot {prevKwDate}
                  </p>
                )}
              </div>
            )}

            {/* Top Organic Pages */}
            {(pageRows?.length ?? 0) > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Top Organic Pages
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Top pages by organic traffic · snapshot {latestKwDate}
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
      </main>
    </div>
  )
}
