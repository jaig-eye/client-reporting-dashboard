import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { upsertGoogleAdsMetrics, upsertGoogleAdsAdMetrics } from '@/lib/sync'
import type { GoogleAdsAdRawRow } from '@/lib/connectors/google-ads'

/**
 * POST /api/ingest/google
 *
 * Receives campaign + ad-level metrics pushed by the Google Ads MCC Script.
 * Authenticated via a pre-shared secret in the x-ingest-secret header.
 *
 * Body:
 * {
 *   account_id: string          // Google Ads customer ID (digits only or with dashes)
 *   rows: Array<{               // Campaign-level (required)
 *     campaign_id, campaign_name, date, spend, impressions, clicks,
 *     conversions, conversion_value, campaign_status?, campaign_type?
 *   }>
 *   ad_rows?: Array<{           // Ad-level (optional — enables drill-down)
 *     campaign_id, campaign_name, ad_group_id, ad_group_name,
 *     ad_id, ad_name, ad_type?, date, spend, impressions, clicks,
 *     conversions, conversion_value
 *   }>
 * }
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-ingest-secret')
  if (!secret || secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { account_id?: string; rows?: unknown[]; ad_rows?: unknown[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { account_id, rows, ad_rows } = body
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

  // Ad-level rows (optional — pushed by the updated MCC script for drill-down)
  let adInserted = 0
  if (Array.isArray(ad_rows) && ad_rows.length > 0) {
    const validAdRows = (ad_rows as Record<string, unknown>[]).filter(
      r => r.campaign_id && r.ad_group_id && r.ad_id && r.date
    )
    if (validAdRows.length > 0) {
      const mappedAdRows: GoogleAdsAdRawRow[] = validAdRows.map(r => ({
        campaign_id:       String(r.campaign_id),
        campaign_name:     String(r.campaign_name ?? ''),
        ad_group_id:       String(r.ad_group_id),
        ad_group_name:     String(r.ad_group_name ?? ''),
        ad_id:             String(r.ad_id),
        ad_name:           String(r.ad_name ?? ''),
        ad_type:           String(r.ad_type ?? ''),
        headlines:         [],
        descriptions:      [],
        final_url:         null,
        image_url:         null,
        ad_strength:       null,
        ad_status:         (r.ad_status as string | null) ?? null,
        date:              String(r.date).split('T')[0],
        cost_micros:       Math.round(Number(r.spend) * 1_000_000),
        impressions:       Number(r.impressions) || 0,
        clicks:            Number(r.clicks) || 0,
        conversions:       Number(r.conversions) || 0,
        conversions_value: Number(r.conversion_value) || 0,
      }))
      adInserted = await upsertGoogleAdsAdMetrics(db, connection.id, connection.client_id, mappedAdRows)
    }
  }

  return NextResponse.json({ inserted, ad_inserted: adInserted })
}
