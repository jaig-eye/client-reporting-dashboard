import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { upsertMetaAdsMetrics } from '@/lib/sync'
import type { MetaAction } from '@/lib/connectors/types'

/**
 * POST /api/ingest/meta
 *
 * Receives campaign metrics pushed by Make/n8n or any webhook source for Meta Ads.
 * Authenticated via a pre-shared secret in the x-ingest-secret header.
 *
 * Body:
 * {
 *   account_id: string          // Meta ad account ID (e.g. "act_123456789" or "123456789")
 *   rows: Array<{
 *     campaign_id:       string
 *     campaign_name:     string
 *     date:              string  // YYYY-MM-DD
 *     spend:             number
 *     impressions:       number
 *     clicks:            number
 *     reach?:            number
 *     frequency?:        number
 *     objective?:        string
 *     actions?:          { action_type: string; value: string }[]
 *     action_values?:    { action_type: string; value: string }[]
 *   }>
 * }
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-ingest-secret')
  if (!secret || secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { account_id?: string; rows?: unknown[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { account_id, rows } = body
  if (!account_id || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'account_id and rows are required' }, { status: 400 })
  }

  const db = createAdminClient()
  const withPrefix    = account_id.startsWith('act_') ? account_id : `act_${account_id}`
  const withoutPrefix = account_id.replace(/^act_/, '')

  // Find the client_connection whose external_id matches this account
  const { data: connection } = await db
    .from('client_connections')
    .select('id, client_id, connector:connectors!inner(type)')
    .eq('connector.type', 'meta_ads')
    .or(`external_id.eq.${withPrefix},external_id.eq.${withoutPrefix}`)
    .eq('status', 'active')
    .single()

  if (!connection) {
    return NextResponse.json(
      { registered: false, message: 'No active Meta Ads connection found for this account ID.' },
      { status: 202 }
    )
  }

  const validRows = (rows as Record<string, unknown>[]).filter(
    r => r.campaign_id && r.date && typeof r.spend === 'number'
  )
  if (validRows.length === 0) {
    return NextResponse.json({ error: 'No valid rows provided' }, { status: 400 })
  }

  const metaRows = validRows.map(r => ({
    campaign_id:   String(r.campaign_id),
    campaign_name: String(r.campaign_name ?? ''),
    objective:     (r.objective as string) ?? null,
    date:          String(r.date).split('T')[0],
    spend:         Number(r.spend) || 0,
    impressions:   Number(r.impressions) || 0,
    clicks:        Number(r.clicks) || 0,
    reach:         Number(r.reach) || 0,
    frequency:     Number(r.frequency) || 0,
    actions:       (r.actions as MetaAction[]) ?? [],
    action_values: (r.action_values as MetaAction[]) ?? [],
  }))

  // Discover all unique action types across this batch
  const discoveredActions = [...new Set(
    metaRows.flatMap(r => r.actions.map((a: MetaAction) => a.action_type))
  )]

  const inserted = await upsertMetaAdsMetrics(db, connection.id, connection.client_id, metaRows, discoveredActions)
  return NextResponse.json({ inserted })
}
