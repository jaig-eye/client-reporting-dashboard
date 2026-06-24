import { createAdminClient } from '@/lib/supabase/server'
import {
  fetchDailyTotals,
  fetchQueryTotals,
  fetchPageTotals,
  refreshAccessToken,
  isExpiringSoon,
} from '@/lib/connectors/google-search-console'
import type { GSCPageFilter } from '@/lib/connectors/google-search-console'

export interface GSCSummaryResult {
  totals:       { clicks: number; impressions: number; ctr: number; position: number }
  queries:      Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>
  pages:        Array<{ page: string;  clicks: number; impressions: number; ctr: number; position: number }>
  daily:        Array<{ date: string;  clicks: number; impressions: number }>
  distribution: { top3: number; page1: number; page2: number; beyond: number }
}

export async function fetchGSCLiveData(
  connectionId: string,
  from: string,
  to: string,
  topN = 25
): Promise<GSCSummaryResult | null> {
  try {
    const db = createAdminClient()

    type ConnRow = {
      id:           string
      external_id:  string
      config:       Record<string, unknown> | null
      connector_id: string
      connectors:   { auth: Record<string, unknown> } | null
    }

    const { data: connRaw } = await db
      .from('client_connections')
      .select('id, external_id, config, connector_id, connectors(auth)')
      .eq('id', connectionId)
      .maybeSingle()

    const conn = connRaw as unknown as ConnRow | null
    if (!conn) return null

    const connectors = conn.connectors
    if (!connectors) return null

    let auth = connectors.auth as {
      access_token:     string
      refresh_token:    string
      token_expires_at?: string
    }

    if (isExpiringSoon(auth.token_expires_at)) {
      const refreshed = await refreshAccessToken(auth.refresh_token)
      auth = {
        ...auth,
        access_token:     refreshed.access_token,
        token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).from('connectors').update({ auth }).eq('id', conn.connector_id)
    }

    const siteUrl = conn.external_id as string
    if (!siteUrl) return null

    const cfg = conn.config as Record<string, unknown> | null
    const pageFilter: GSCPageFilter | undefined = cfg?.page_filter_regex && typeof cfg.page_filter_regex === 'string'
      ? { regex: cfg.page_filter_regex, type: ((cfg.page_filter_type as string | undefined) ?? 'exclude') as 'include' | 'exclude' }
      : undefined

    const [dailyRows, queryRows, pageRows] = await Promise.all([
      fetchDailyTotals(siteUrl, auth.access_token, from, to),
      fetchQueryTotals(siteUrl, auth.access_token, from, to),
      fetchPageTotals(siteUrl, auth.access_token, from, to, pageFilter),
    ])

    // Aggregate totals from daily rows (avoids double-counting from query/page dimensions)
    let totalClicks = 0
    let totalImpressions = 0
    let weightedPositionSum = 0
    for (const r of dailyRows) {
      totalClicks       += r.clicks
      totalImpressions  += r.impressions
      weightedPositionSum += r.position * r.impressions
    }
    const avgPosition = totalImpressions > 0 ? weightedPositionSum / totalImpressions : 0
    const avgCtr      = totalImpressions > 0 ? totalClicks / totalImpressions : 0

    // Aggregate query rows by query (sum across dates)
    const queryMap = new Map<string, { clicks: number; impressions: number; posSum: number }>()
    for (const r of queryRows) {
      if (!r.query) continue
      const ex = queryMap.get(r.query) ?? { clicks: 0, impressions: 0, posSum: 0 }
      ex.clicks      += r.clicks
      ex.impressions += r.impressions
      ex.posSum      += r.position * r.impressions
      queryMap.set(r.query, ex)
    }

    const queries = Array.from(queryMap.entries())
      .map(([query, v]) => ({
        query,
        clicks:      v.clicks,
        impressions: v.impressions,
        ctr:         v.impressions > 0 ? v.clicks / v.impressions : 0,
        position:    v.impressions > 0 ? v.posSum / v.impressions : 0,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, topN)

    // Aggregate page rows by page (sum across dates)
    const pageMap = new Map<string, { clicks: number; impressions: number; posSum: number }>()
    for (const r of pageRows) {
      if (!r.page) continue
      const ex = pageMap.get(r.page) ?? { clicks: 0, impressions: 0, posSum: 0 }
      ex.clicks      += r.clicks
      ex.impressions += r.impressions
      ex.posSum      += r.position * r.impressions
      pageMap.set(r.page, ex)
    }

    const pages = Array.from(pageMap.entries())
      .map(([page, v]) => ({
        page,
        clicks:      v.clicks,
        impressions: v.impressions,
        ctr:         v.impressions > 0 ? v.clicks / v.impressions : 0,
        position:    v.impressions > 0 ? v.posSum / v.impressions : 0,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, topN)

    // Position distribution from all aggregated queries (not just top N)
    const distribution = { top3: 0, page1: 0, page2: 0, beyond: 0 }
    queryMap.forEach(v => {
      const pos = v.impressions > 0 ? v.posSum / v.impressions : 0
      if (pos <= 3)       distribution.top3++
      else if (pos <= 10) distribution.page1++
      else if (pos <= 20) distribution.page2++
      else                distribution.beyond++
    })

    return {
      totals: { clicks: totalClicks, impressions: totalImpressions, ctr: avgCtr, position: avgPosition },
      queries,
      pages,
      daily: dailyRows.map(r => ({ date: r.date, clicks: r.clicks, impressions: r.impressions })),
      distribution,
    }
  } catch (err) {
    console.error('[gsc-live] fetchGSCLiveData error for connection', connectionId, err)
    return null
  }
}
