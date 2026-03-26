// GET /api/admin/connections/[id]/test-ad-sync?days=7
// Runs the ad-level fetch for a connection and returns the raw result count.
// Use this to diagnose why google_ads_ad_metrics stays empty.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchGoogleAdMetrics } from '@/lib/connectors/google-ads'
import { fetchMetaAdMetrics } from '@/lib/connectors/meta-ads'
import type { ClientConnection, Connector } from '@/lib/types'

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0]
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: connectionId } = await params
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10)

  const to   = new Date(); to.setDate(to.getDate() - 1)
  const from = new Date(to); from.setDate(from.getDate() - (days - 1))
  const dateFrom = fmtDate(from)
  const dateTo   = fmtDate(to)

  const db = createAdminClient()

  // The [id] param may be either a client_connections.id OR a connectors.id
  // (the admin UI links to connectors/[connectors.id]).
  // Try client_connections.id first, then fall back to connector_id.
  let { data: conn } = await db
    .from('client_connections')
    .select('*, connector:connectors(*)')
    .eq('id', connectionId)
    .eq('status', 'active')
    .limit(1)
    .single() as { data: (ClientConnection & { connector: Connector }) | null }

  if (!conn) {
    // Fall back: treat id as connectors.id and pick the first active connection
    const { data: connByConnector } = await db
      .from('client_connections')
      .select('*, connector:connectors(*)')
      .eq('connector_id', connectionId)
      .eq('status', 'active')
      .limit(1)
      .single() as { data: (ClientConnection & { connector: Connector }) | null }
    conn = connByConnector
  }

  if (!conn) return NextResponse.json({ error: 'No active connection found for this ID (tried client_connections.id and connector_id)' }, { status: 404 })

  const connectorType = conn.connector.type
  let auth = conn.connector.auth

  try {
    if (connectorType === 'google_ads') {
      const rows = await fetchGoogleAdMetrics(
        conn.external_id,
        auth,
        conn.connector.config,
        dateFrom,
        dateTo
      )

      // Also check what's actually in the DB for this connection
      const { count: dbCount } = await db
        .from('google_ads_ad_metrics')
        .select('id', { count: 'exact', head: true })
        .eq('connection_id', conn.id)

      const sample = rows.slice(0, 3).map(r => ({
        ad_id:         r.ad_id,
        ad_name:       r.ad_name,
        ad_type:       r.ad_type,
        campaign_id:   r.campaign_id,
        campaign_name: r.campaign_name,
        ad_group_id:   r.ad_group_id,
        date:          r.date,
        spend:         r.cost_micros / 1_000_000,
        impressions:   r.impressions,
      }))

      // --- Write test: try upserting the first row to surface exact DB errors ---
      let writeTest: { success: boolean; error: string | null; row?: Record<string, unknown> } = { success: false, error: 'no rows to test' }
      const firstValid = rows.find(r => r.date && r.ad_id)
      if (firstValid) {
        const testRow = {
          connection_id:     conn.id,
          client_id:         conn.client_id,
          campaign_id:       String(firstValid.campaign_id),
          campaign_name:     String(firstValid.campaign_name || ''),
          ad_group_id:       String(firstValid.ad_group_id),
          ad_group_name:     String(firstValid.ad_group_name || ''),
          ad_id:             String(firstValid.ad_id),
          ad_name:           String(firstValid.ad_name || ''),
          ad_type:           firstValid.ad_type || null,
          ad_status:         firstValid.ad_status || null,
          ad_strength:       firstValid.ad_strength || null,
          headlines:         firstValid.headlines?.length    ? firstValid.headlines    : null,
          descriptions:      firstValid.descriptions?.length ? firstValid.descriptions : null,
          final_url:         firstValid.final_url   || null,
          image_url:         firstValid.image_url   || null,
          date:              String(firstValid.date).split('T')[0],
          cost_micros:       Number(firstValid.cost_micros) || 0,
          spend:             (Number(firstValid.cost_micros) || 0) / 1_000_000,
          impressions:       Number(firstValid.impressions)      || 0,
          clicks:            Number(firstValid.clicks)           || 0,
          conversions:       Number(firstValid.conversions)      || 0,
          conversions_value: Number(firstValid.conversions_value)|| 0,
        }
        const { error: writeError } = await db
          .from('google_ads_ad_metrics')
          .upsert(testRow, { onConflict: 'connection_id,ad_id,date', ignoreDuplicates: false })
        writeTest = {
          success: !writeError,
          error:   writeError ? writeError.message : null,
          row:     testRow,
        }
      }

      return NextResponse.json({
        connector_type:  connectorType,
        external_id:     conn.external_id,
        connection_id:   conn.id,
        client_id:       conn.client_id,
        date_range:      { from: dateFrom, to: dateTo },
        api_row_count:   rows.length,
        db_row_count:    dbCount,
        write_test:      writeTest,
        sample,
        note: rows.length === 0
          ? 'Zero rows returned from API. Performance Max campaigns have no ad_group_ad entries.'
          : null,
      })
    }

    if (connectorType === 'meta_ads') {
      const rows = await fetchMetaAdMetrics(
        conn.external_id,
        auth,
        dateFrom,
        dateTo
      )
      const sample = rows.slice(0, 3).map(r => ({
        ad_id:       r.ad_id,
        ad_name:     r.ad_name,
        campaign_id: r.campaign_id,
        adset_id:    r.adset_id,
        date:        r.date,
        spend:       r.spend,
        impressions: r.impressions,
      }))
      return NextResponse.json({
        connector_type: connectorType,
        external_id:    conn.external_id,
        date_range:     { from: dateFrom, to: dateTo },
        row_count:      rows.length,
        sample,
      })
    }

    return NextResponse.json({ error: `Unsupported connector type: ${connectorType}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json({
      connector_type: connectorType,
      external_id:    conn.external_id,
      date_range:     { from: dateFrom, to: dateTo },
      error:          String(err),
    }, { status: 500 })
  }
}
