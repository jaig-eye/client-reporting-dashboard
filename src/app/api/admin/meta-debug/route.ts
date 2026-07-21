// GET /api/admin/meta-debug?connectionId=xxx&since=YYYY-MM-DD&until=YYYY-MM-DD
//
// Probes the Meta Insights API for a given ad account and date range.
// Returns raw pagination stats (pages, rows per page, date coverage) per 365-day chunk.
// Does NOT write anything to the database — read-only diagnostic tool.
//
// Usage: hit this endpoint in your browser while logged in as admin to diagnose
// why Meta Ads syncs return fewer rows than expected.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import type { ClientConnection, Connector } from '@/lib/types'

const API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function metaFetchWithRetry(url: string, maxRetries = 3): Promise<Record<string, unknown>> {
  let delay = 10_000
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url)
    if (res.ok) {
      const json = await res.json() as Record<string, unknown>
      if (json.error) {
        const e = json.error as Record<string, unknown>
        const code = Number(e.code ?? 0)
        const isRateLimit = code === 17 || code === 32 || code === 613
        if (isRateLimit && attempt < maxRetries) { await sleep(delay); delay = Math.min(delay * 2, 60_000); continue }
        throw new Error(`Meta API error (code ${code}): ${e.message}`)
      }
      return json
    }
    const text = await res.text()
    const hasRateLimitCode = /\"code\":\s*(17|32|613)\b/.test(text)
    if ((res.status === 400 || res.status === 429 || hasRateLimitCode) && attempt < maxRetries) {
      await sleep(delay); delay = Math.min(delay * 2, 60_000); continue
    }
    throw new Error(`Meta API ${res.status}: ${text.slice(0, 300)}`)
  }
  throw new Error('Meta API: max retries exceeded')
}

function chunkDateRange(from: string, to: string, maxDays: number) {
  const chunks: { from: string; to: string }[] = []
  let cur = new Date(from)
  const end = new Date(to)
  while (cur <= end) {
    const chunkEnd = new Date(cur)
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1)
    if (chunkEnd > end) chunkEnd.setTime(end.getTime())
    chunks.push({ from: cur.toISOString().split('T')[0], to: chunkEnd.toISOString().split('T')[0] })
    cur = new Date(chunkEnd); cur.setDate(cur.getDate() + 1)
  }
  return chunks
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const connectionId = req.nextUrl.searchParams.get('connectionId')
  const since = req.nextUrl.searchParams.get('since')
  const until = req.nextUrl.searchParams.get('until')

  if (!connectionId) return NextResponse.json({ error: 'connectionId required' }, { status: 400 })

  const db = createAdminClient()

  let { data: conn } = await db
    .from('client_connections')
    .select('*, connector:connectors(*)')
    .eq('id', connectionId)
    .eq('status', 'active')
    .limit(1)
    .single() as { data: (ClientConnection & { connector: Connector }) | null }

  if (!conn) {
    const { data: c2 } = await db
      .from('client_connections')
      .select('*, connector:connectors(*)')
      .eq('connector_id', connectionId)
      .eq('status', 'active')
      .limit(1)
      .single() as { data: (ClientConnection & { connector: Connector }) | null }
    conn = c2
  }

  if (!conn) return NextResponse.json({ error: 'No active Meta connection found' }, { status: 404 })
  if (conn.connector.type !== 'meta_ads') {
    return NextResponse.json({ error: `Connection is type '${conn.connector.type}', not meta_ads` }, { status: 400 })
  }

  const auth = conn.connector.auth as Record<string, unknown>
  const accessToken = String(auth.system_user_token || auth.access_token || '')
  if (!accessToken) return NextResponse.json({ error: 'No access token on connector' }, { status: 400 })

  // Default to last 730 days if no range provided
  const toDate   = until ?? new Date().toISOString().split('T')[0]
  const fromDate = since  ?? (() => { const d = new Date(); d.setDate(d.getDate() - 730); return d.toISOString().split('T')[0] })()

  const campaignFields = [
    'campaign_id', 'campaign_name', 'objective',
    'spend', 'impressions', 'clicks', 'reach', 'frequency',
    'actions', 'action_values',
  ].join(',')

  const chunks = chunkDateRange(fromDate, toDate, 365)
  const chunkResults = []
  let grandTotal = 0
  let sampleRows: Record<string, unknown>[] = []

  for (const chunk of chunks) {
    const pages: { page: number; rows: number; first_date: string | null; last_date: string | null; has_next: boolean }[] = []
    let chunkTotal = 0
    let chunkError: string | null = null

    try {
      const base = new URL(`${BASE_URL}/${conn.external_id}/insights`)
      base.searchParams.set('access_token',   accessToken)
      base.searchParams.set('level',          'campaign')
      base.searchParams.set('fields',         campaignFields)
      base.searchParams.set('time_range',     JSON.stringify({ since: chunk.from, until: chunk.to }))
      base.searchParams.set('time_increment', '1')
      base.searchParams.set('limit',          '500')
      base.searchParams.set('filtering', JSON.stringify([{
        field: 'campaign.effective_status', operator: 'IN',
        value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED'],
      }]))

      let pageNum = 0
      let nextUrl: string | null = base.toString()
      while (nextUrl) {
        const data = await metaFetchWithRetry(nextUrl)
        const page = (data.data || []) as Record<string, unknown>[]
        pageNum++
        const dates = page.map(r => String(r.date_start || '')).filter(Boolean)
        const hasNext = typeof (data.paging as Record<string,unknown>|undefined)?.next === 'string' &&
                        !!((data.paging as Record<string,unknown>).next as string)
        pages.push({
          page:       pageNum,
          rows:       page.length,
          first_date: dates[0] ?? null,
          last_date:  dates[dates.length - 1] ?? null,
          has_next:   hasNext,
        })
        chunkTotal += page.length
        if (sampleRows.length < 3) {
          sampleRows = sampleRows.concat(
            page.slice(0, 3 - sampleRows.length).map(r => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { actions, action_values, ...rest } = r as Record<string, unknown>
              return rest
            })
          )
        }
        const paging = data.paging as Record<string, unknown> | undefined
        nextUrl = (typeof paging?.next === 'string' && paging.next) ? paging.next : null
      }
    } catch (err) {
      chunkError = String(err)
    }

    grandTotal += chunkTotal
    chunkResults.push({ from: chunk.from, to: chunk.to, pages, total_rows: chunkTotal, error: chunkError })
  }

  // Also query the DB for current row count to compare
  const { count: dbCount } = await db
    .from('meta_ads_metrics')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', conn.id)
    .gte('date', fromDate)
    .lte('date', toDate)

  return NextResponse.json({
    external_id:      conn.external_id,
    connection_id:    conn.id,
    client_id:        conn.client_id,
    date_range:       { since: fromDate, until: toDate },
    chunks:           chunkResults,
    grand_total_rows: grandTotal,
    db_rows_in_range: dbCount ?? 0,
    sample_rows:      sampleRows,
  })
}
