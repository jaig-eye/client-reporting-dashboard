import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

/**
 * DELETE /api/admin/clients/[id]/purge?source=meta_ads
 *
 * Purges all metric data for a specific source type for this client.
 * Useful when data integrity issues require a clean re-sync.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const source = request.nextUrl.searchParams.get('source')

  if (!source || !['google_ads', 'meta_ads'].includes(source)) {
    return NextResponse.json({ error: 'Invalid source. Must be google_ads or meta_ads' }, { status: 400 })
  }

  const db = createAdminClient()
  const results: { table: string; count: number }[] = []

  if (source === 'meta_ads') {
    const { count: adCount } = await db.from('meta_ads_ad_metrics').delete({ count: 'exact' }).eq('client_id', id)
    const { count: campCount } = await db.from('meta_ads_metrics').delete({ count: 'exact' }).eq('client_id', id)
    results.push({ table: 'meta_ads_ad_metrics', count: adCount ?? 0 })
    results.push({ table: 'meta_ads_metrics', count: campCount ?? 0 })
  } else {
    const { count: kwCount } = await db.from('google_ads_keywords').delete({ count: 'exact' }).eq('client_id', id)
    const { count: negCount } = await db.from('google_ads_negative_keywords').delete({ count: 'exact' }).eq('client_id', id)
    const { count: assetCount } = await db.from('google_ads_asset_group_assets').delete({ count: 'exact' }).eq('client_id', id)
    const { count: adCount } = await db.from('google_ads_ad_metrics').delete({ count: 'exact' }).eq('client_id', id)
    const { count: campCount } = await db.from('google_ads_metrics').delete({ count: 'exact' }).eq('client_id', id)
    results.push({ table: 'google_ads_keywords', count: kwCount ?? 0 })
    results.push({ table: 'google_ads_negative_keywords', count: negCount ?? 0 })
    results.push({ table: 'google_ads_asset_group_assets', count: assetCount ?? 0 })
    results.push({ table: 'google_ads_ad_metrics', count: adCount ?? 0 })
    results.push({ table: 'google_ads_metrics', count: campCount ?? 0 })
  }

  const totalPurged = results.reduce((t, r) => t + r.count, 0)
  return NextResponse.json({ success: true, source, totalPurged, details: results })
}
