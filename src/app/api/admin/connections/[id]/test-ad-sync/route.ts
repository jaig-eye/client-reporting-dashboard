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

  const { data: conn } = await db
    .from('client_connections')
    .select('*, connector:connectors(*)')
    .eq('id', connectionId)
    .single() as { data: (ClientConnection & { connector: Connector }) | null }

  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

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
      return NextResponse.json({
        connector_type: connectorType,
        external_id:    conn.external_id,
        date_range:     { from: dateFrom, to: dateTo },
        row_count:      rows.length,
        sample,
        note: rows.length === 0
          ? 'Zero rows returned. This account likely uses Performance Max campaigns (which have no ad_group_ad entries) OR all ads have 0 impressions in this date range.'
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
