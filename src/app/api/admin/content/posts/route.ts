// GET /api/admin/content/posts?client_id=X[&status=X]
// Returns content_posts for a client ordered by target_publish_date DESC.

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('client_id')
  const status   = searchParams.get('status')

  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()
  let query = db
    .from('content_posts')
    .select('id, client_id, status, title, seo_title, target_keyword, meta_description, slug, word_count, wp_post_id, wp_site_url, published_url, target_publish_date, generated_at, seo_score, schema_type, excerpt')
    .eq('client_id', clientId)
    .order('target_publish_date', { ascending: false, nullsFirst: false })

  if (status) {
    query = query.eq('status', status) as typeof query
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
