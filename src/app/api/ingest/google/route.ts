import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { upsertGoogleAdsMetrics } from '@/lib/sync'

/**
 * POST /api/ingest/google
 *
 * Receives campaign metrics pushed by the Google Ads MCC Script.
 * Authenticated via a pre-shared secret in the x-ingest-secret header.
 *
 * The account_id must match a client_connection.external_id for a google_ads connector.
 * If no matching connection is found, returns 202 so the script doesn't retry indefinitely.
 *
 * Body:
 * {
 *   account_id: string          // Google Ads customer ID (digits only or with dashes)
 *   rows: Array<{
 *     campaign_id:       string
 *     campaign_name:     string
 *     date:              string  // YYYY-MM-DD
 *     spend:             number  // USD (will be converted to cost_micros internally)
 *     impressions:       number
 *     clicks:            number
 *     conversions:       number
 *     conversion_value:  number
 *     campaign_status?:  string
 *     campaign_type?:    string
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
  const normalised = account_id.replace(/-/g, '')

  // Find the client_connection whose external_id matches this account
  const { data: connection } = await db
    .from('client_connections')
    .select('id, client_id, connector:connectors!inner(type)')
    .eq('connector.type', 'google_ads')
    .or(`external_id.eq.${account_id},external_id.eq.${normalised}`)
    .eq('status', 'active')
    .single()

  if (!connection) {
    // No connection configured yet — accept without error so the script doesn't fail
    return NextResponse.json(
      { registered: false, message: 'No active Google Ads connection found for this account ID.' },
      { status: 202 }
    )
  }

  const validRows = (rows as Record<string, unknown>[]).filter(
    r => r.campaign_id && r.date && typeof r.spend === 'number'
  )
  if (validRows.length === 0) {
    return NextResponse.json({ error: 'No valid rows provided' }, { status: 400 })
  }

  // Convert USD spend → cost_micros for the upsert function
  const googleRows = validRows.map(r => ({
    campaign_id:              String(r.campaign_id),
    campaign_name:            String(r.campaign_name ?? ''),
    campaign_status:          (r.campaign_status as string) ?? null,
    campaign_type:            (r.campaign_type as string) ?? null,
    date:                     String(r.date).split('T')[0],
    cost_micros:              Math.round(Number(r.spend) * 1_000_000),
    impressions:              Number(r.impressions) || 0,
    clicks:                   Number(r.clicks) || 0,
    conversions:              Number(r.conversions) || 0,
    conversions_value:        Number(r.conversion_value) || 0,
    view_through_conversions: 0,
  }))

  const inserted = await upsertGoogleAdsMetrics(db, connection.id, connection.client_id, googleRows)
  return NextResponse.json({ inserted })
}
