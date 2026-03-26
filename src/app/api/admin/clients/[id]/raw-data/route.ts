// GET /api/admin/clients/[id]/raw-data?source=google_ads|meta_ads&limit=100
// Returns raw campaign-level metrics for a client for the raw data inspector.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId } = await params
  const sp     = request.nextUrl.searchParams
  const source = sp.get('source') ?? 'google_ads'
  const limit  = Math.min(parseInt(sp.get('limit') ?? '100', 10), 1000)

  const db = createAdminClient()

  if (source === 'google_ads') {
    const { data, error } = await db
      .from('google_ads_metrics')
      .select('campaign_id,campaign_name,campaign_type,date,spend,impressions,clicks,conversions,conversions_value,view_through_conversions,roas,ctr,cpc,cpm')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rows: data ?? [] })
  }

  if (source === 'meta_ads') {
    const { data, error } = await db
      .from('meta_ads_metrics')
      .select('campaign_id,campaign_name,objective,date,spend,impressions,clicks,reach,frequency,conversions,conversion_value,roas,ctr,cpc,cpm,actions,discovered_actions')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rows: data ?? [] })
  }

  if (source === 'google_ads_ads') {
    const { data, error } = await db
      .from('google_ads_ad_metrics')
      .select('campaign_id,campaign_name,ad_group_id,ad_group_name,ad_id,ad_name,ad_type,date,spend,impressions,clicks,conversions,conversions_value')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rows: data ?? [], count: data?.length ?? 0 })
  }

  if (source === 'meta_ads_ads') {
    const { data, error } = await db
      .from('meta_ads_ad_metrics')
      .select('campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date,spend,impressions,clicks,conversions,conversion_value,actions')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rows: data ?? [], count: data?.length ?? 0 })
  }

  return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
}
