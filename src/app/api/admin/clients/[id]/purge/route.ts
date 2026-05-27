import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

const VALID_SOURCES = [
  'google_ads',
  'meta_ads',
  'google_search_console',
  'google_analytics_4',
  'google_business',
  'ahrefs',
  'content',
  'all',
] as const
type Source = typeof VALID_SOURCES[number]

async function purgeSource(db: ReturnType<typeof createAdminClient>, clientId: string, source: Exclude<Source, 'all'>) {
  const results: { table: string; count: number }[] = []

  async function del(table: string) {
    const { count } = await db.from(table).delete({ count: 'exact' }).eq('client_id', clientId)
    results.push({ table, count: count ?? 0 })
  }

  if (source === 'google_ads') {
    await del('google_ads_keywords')
    await del('google_ads_negative_keywords')
    await del('google_ads_asset_group_assets')
    await del('google_ads_ad_metrics')
    await del('google_ads_metrics')
  } else if (source === 'meta_ads') {
    await del('meta_ads_ad_metrics')
    await del('meta_ads_metrics')
  } else if (source === 'google_search_console') {
    await del('gsc_metrics')
    await del('gsc_daily_totals')
    await del('gsc_query_totals')
    await del('gsc_page_totals')
  } else if (source === 'google_analytics_4') {
    await del('ga4_metrics')
  } else if (source === 'google_business') {
    await del('gbp_metrics')
  } else if (source === 'ahrefs') {
    await del('ahrefs_keywords')
    await del('ahrefs_pages')
    await del('ahrefs_metrics')
  } else if (source === 'content') {
    await del('content_posts')
    await del('content_topics')
  }

  return results
}

/**
 * DELETE /api/admin/clients/[id]/purge?source=<source>
 *
 * Purges all metric data for a specific source (or all sources) for this client.
 * Valid sources: google_ads, meta_ads, google_search_console, google_analytics_4,
 *                google_business, ahrefs, content, all
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
  const source = request.nextUrl.searchParams.get('source') as Source | null

  if (!source || !VALID_SOURCES.includes(source)) {
    return NextResponse.json(
      { error: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}` },
      { status: 400 }
    )
  }

  const db = createAdminClient()
  let allResults: { table: string; count: number }[] = []

  if (source === 'all') {
    const sources = VALID_SOURCES.filter(s => s !== 'all') as Exclude<Source, 'all'>[]
    for (const s of sources) {
      const r = await purgeSource(db, id, s)
      allResults = allResults.concat(r)
    }
  } else {
    allResults = await purgeSource(db, id, source)
  }

  const totalPurged = allResults.reduce((t, r) => t + r.count, 0)
  return NextResponse.json({ success: true, source, totalPurged, details: allResults })
}
