// ─────────────────────────────────────────────────────────────────────────────
// Admin Preview — GBP (Google Business Profile) Page
// Mirrors /dashboard/seo/gbp but authenticates via clientId param (no cookie).
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import type { Client, ClientConnection, Connector } from '@/lib/types'
import DateRangePicker from '@/components/DateRangePicker'
import SpendChart from '@/components/SpendChart'
import ExportButtons from '@/components/ExportButtons'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) { return d.toISOString().split('T')[0] }
function fmtNum(n: number) { return n.toLocaleString() }

function StarRating({ rating }: { rating: number }) {
  const full  = Math.floor(rating)
  const half  = rating - full >= 0.5
  const empty = 5 - full - (half ? 1 : 0)
  return (
    <span style={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
      {Array.from({ length: full  }).map((_, i) => <span key={`f${i}`} style={{ color: '#f59e0b' }}>★</span>)}
      {half && <span style={{ color: '#f59e0b' }}>½</span>}
      {Array.from({ length: empty }).map((_, i) => <span key={`e${i}`} style={{ color: 'var(--border)' }}>★</span>)}
    </span>
  )
}

export default async function PreviewGBPPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>
}) {
  const { clientId } = await params
  const db           = createAdminClient()
  const sp           = await searchParams

  const { data: clientData } = await db.from('clients').select('*').eq('id', clientId).single()
  const client = clientData as Client | null
  if (!client) redirect('/admin/clients')

  const toDate   = sp.to   ? new Date(sp.to)   : new Date()
  const fromDate = sp.from ? new Date(sp.from)  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const compare  = sp.compare ?? 'none'

  // Find active GBP connections
  const { data: connData } = await db
    .from('client_connections')
    .select('*, connector:connectors(id, type, label)')
    .eq('client_id', client.id)
    .eq('status', 'active')

  const connections = (connData ?? []) as (ClientConnection & { connector: Pick<Connector, 'id' | 'type' | 'label'> })[]
  const gbpConnections = connections.filter(c => c.connector.type === 'google_business_profile')

  if (gbpConnections.length === 0) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <EmptyState
            title="Google Business Profile not connected"
            description="Connect the client's Google Business Profile in Client Settings to see local visibility data here."
          />
        </main>
      </div>
    )
  }

  // Fetch GBP metrics
  const { data: rows } = await db
    .from('gbp_metrics')
    .select('*')
    .eq('client_id', client.id)
    .gte('date', fmtDate(fromDate))
    .lte('date', fmtDate(toDate))
    .order('date', { ascending: true })

  const gbpRows = (rows ?? []) as {
    date: string; location_id: string; location_name: string | null;
    views_search: number; views_maps: number;
    website_clicks: number; call_clicks: number; direction_clicks: number;
    photos_views: number; photos_count: number;
    reviews_count: number; reviews_avg_rating: number;
  }[]

  if (gbpRows.length === 0) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <EmptyState title="No data for this date range" description="Try selecting a wider date range, or wait for the next sync." />
        </main>
      </div>
    )
  }

  // Aggregate totals
  const totals = gbpRows.reduce(
    (acc, r) => ({
      views_search:     acc.views_search     + (r.views_search     ?? 0),
      views_maps:       acc.views_maps       + (r.views_maps       ?? 0),
      website_clicks:   acc.website_clicks   + (r.website_clicks   ?? 0),
      call_clicks:      acc.call_clicks      + (r.call_clicks      ?? 0),
      direction_clicks: acc.direction_clicks + (r.direction_clicks ?? 0),
      photos_views:     acc.photos_views     + (r.photos_views     ?? 0),
      reviews_count:    0,
      reviews_rating_sum:  acc.reviews_rating_sum + (r.reviews_avg_rating ?? 0),
      reviews_rating_cnt:  acc.reviews_rating_cnt + (r.reviews_avg_rating > 0 ? 1 : 0),
    }),
    { views_search: 0, views_maps: 0, website_clicks: 0, call_clicks: 0, direction_clicks: 0, photos_views: 0, reviews_count: 0, reviews_rating_sum: 0, reviews_rating_cnt: 0 }
  )

  const totalViews = totals.views_search + totals.views_maps

  // Reviews: take most recent rating per location, then average
  const latestByLocation = new Map<string, { rating: number; count: number }>()
  for (const r of gbpRows) {
    latestByLocation.set(r.location_id, { rating: r.reviews_avg_rating ?? 0, count: r.reviews_count ?? 0 })
  }
  const avgRating    = latestByLocation.size > 0
    ? Array.from(latestByLocation.values()).reduce((s, v) => s + v.rating, 0) / latestByLocation.size
    : 0
  const totalReviews = Array.from(latestByLocation.values()).reduce((s, v) => s + v.count, 0)

  // Daily trend for chart
  const dailyMap = new Map<string, { views: number; clicks: number }>()
  for (const r of gbpRows) {
    const d = r.date.split('T')[0]
    const ex = dailyMap.get(d)
    const views = (r.views_search ?? 0) + (r.views_maps ?? 0)
    if (ex) { ex.views += views; ex.clicks += r.website_clicks ?? 0 }
    else dailyMap.set(d, { views, clicks: r.website_clicks ?? 0 })
  }
  const dailyTrend = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, spend: v.views, conversions: v.clicks, clicks: 0, roas: 0 }))

  // Unique locations
  const locations = Array.from(new Set(gbpRows.map(r => r.location_id)))
    .map(id => {
      const locRows = gbpRows.filter(r => r.location_id === id)
      const name = locRows[locRows.length - 1]?.location_name ?? id
      const loc_totals = locRows.reduce(
        (acc, r) => ({
          views:     acc.views     + (r.views_search ?? 0) + (r.views_maps ?? 0),
          clicks:    acc.clicks    + (r.website_clicks ?? 0),
          calls:     acc.calls     + (r.call_clicks ?? 0),
          directions:acc.directions + (r.direction_clicks ?? 0),
        }),
        { views: 0, clicks: 0, calls: 0, directions: 0 }
      )
      const latest = latestByLocation.get(id)
      return { id, name, ...loc_totals, rating: latest?.rating ?? 0, reviewCount: latest?.count ?? 0 }
    })
    .sort((a, b) => b.views - a.views)

  const metricCards = [
    { label: 'Total Views',       value: fmtNum(totalViews),           sub: `${fmtNum(totals.views_search)} Search · ${fmtNum(totals.views_maps)} Maps`, color: '#4285f4' },
    { label: 'Website Clicks',    value: fmtNum(totals.website_clicks),sub: null,                                                                         color: '#10b981' },
    { label: 'Call Clicks',       value: fmtNum(totals.call_clicks),   sub: null,                                                                         color: '#f59e0b' },
    { label: 'Direction Requests',value: fmtNum(totals.direction_clicks),sub: null,                                                                       color: '#8b5cf6' },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <PageHeader client={client} fromDate={fromDate} toDate={toDate} compare={compare} />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {metricCards.map(card => (
            <div key={card.label} className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
                {card.label}
              </p>
              <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
              {card.sub && <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{card.sub}</p>}
              <div style={{ width: '100%', height: 3, borderRadius: 9999, background: 'var(--border)', marginTop: 8 }}>
                <div style={{ width: '60%', height: '100%', borderRadius: 9999, background: card.color }} />
              </div>
            </div>
          ))}
        </div>

        {/* Reviews card */}
        {avgRating > 0 && (
          <div className="card p-5" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
                Google Reviews
              </p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{avgRating.toFixed(1)}</span>
                <StarRating rating={avgRating} />
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{fmtNum(totalReviews)} review{totalReviews !== 1 ? 's' : ''}</p>
            </div>
          </div>
        )}

        {/* Daily views trend chart */}
        <div className="card p-6">
          <div className="mb-4">
            <h2 className="section-title">Views & Website Clicks Over Time</h2>
            <p className="section-desc">{fmtDate(fromDate)} – {fmtDate(toDate)}</p>
          </div>
          <SpendChart
            data={dailyTrend}
            colorSpend="#4285f4"
            colorConversions="#10b981"
            spendLabel="Profile Views"
            conversionsLabel="Website Clicks"
          />
        </div>

        {/* Location breakdown (if multiple locations) */}
        {locations.length > 1 && (
          <div className="card p-6">
            <div className="mb-4">
              <h2 className="section-title">Location Breakdown</h2>
              <p className="section-desc">{locations.length} locations</p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Location</th>
                    <th style={{ textAlign: 'right' }}>Views</th>
                    <th style={{ textAlign: 'right' }}>Website Clicks</th>
                    <th style={{ textAlign: 'right' }}>Calls</th>
                    <th style={{ textAlign: 'right' }}>Directions</th>
                    <th style={{ textAlign: 'right' }}>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map(loc => (
                    <tr key={loc.id}>
                      <td style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{loc.name}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(loc.views)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(loc.clicks)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(loc.calls)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtNum(loc.directions)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {loc.rating > 0 ? (
                          <span style={{ color: '#f59e0b', fontWeight: 600 }}>{loc.rating.toFixed(1)} ★</span>
                        ) : (
                          <span style={{ color: 'var(--text-faint)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}

function PageHeader({ client, fromDate, toDate, compare }: { client: Client; fromDate: Date; toDate: Date; compare: string }) {
  return (
    <div className="max-w-7xl mx-auto px-6 pt-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#34a853', flexShrink: 0 }} />
        <h1 className="font-semibold text-base" style={{ color: 'var(--text-primary)', margin: 0 }}>SEO — Google Business Profile</h1>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <ExportButtons clientId={client.id} from={fromDate.toISOString().split('T')[0]} to={toDate.toISOString().split('T')[0]} compare={compare} />
        <Suspense fallback={null}>
          <DateRangePicker from={fromDate.toISOString().split('T')[0]} to={toDate.toISOString().split('T')[0]} compare={compare} />
        </Suspense>
      </div>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="card p-12 text-center">
      <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '1.5rem' }}>
        📍
      </div>
      <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{description}</p>
    </div>
  )
}
