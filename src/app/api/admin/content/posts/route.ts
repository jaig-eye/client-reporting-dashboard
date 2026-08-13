// GET /api/admin/content/posts?client_id=X[&status=X]
// Returns content_posts for a client ordered by target_publish_date DESC.

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'
import { getRanksForPosts }          from '@/lib/content/seoRankings'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId         = searchParams.get('client_id')
  const status           = searchParams.get('status')
  const contentType      = searchParams.get('content_type')
  const excludePublished = searchParams.get('exclude_published') === 'true'

  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()
  let query = db
    .from('content_posts')
    .select('id, client_id, status, title, seo_title, target_keyword, meta_description, slug, word_count, featured_image_url, wp_post_id, bc_post_id, wp_site_url, bc_store_hash, published_url, target_publish_date, generated_at, seo_score, schema_type, excerpt, content_type, city, state_abbr, service_name')
    .eq('client_id', clientId)
    .is('archived_at', null)
    .order('target_publish_date', { ascending: false, nullsFirst: false })

  if (status) {
    query = query.eq('status', status) as typeof query
  }

  if (contentType) {
    query = query.eq('content_type', contentType) as typeof query
  }

  if (excludePublished) {
    query = query.not('status', 'in', '("published","draft_saved")') as typeof query
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach current keyword rank (DataForSEO datastream) per post. Soft-returns {} when
  // the seo_keywords/seo_rankings tables aren't present yet, so this never fails.
  const posts   = (data ?? []) as { id: string }[]
  const rankMap = await getRanksForPosts(posts.map(p => p.id))
  const enriched = posts.map(p => ({ ...p, keyword_rank: rankMap[p.id] ?? null }))
  return NextResponse.json(enriched)
}
