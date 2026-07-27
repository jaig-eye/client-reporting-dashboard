// POST /api/admin/content/posts/[id]/dismiss
// Rejects a post and handles its parent topic in one of two ways:
//   ?discard=true  → topic → 'rejected' (permanent kill)
//   (default)      → topic → 'approved', post_id = null (cron re-generates)
//
// If the post is already published (wp_post_id or bc_post_id set), archives it
// instead of rejecting — the external post stays live, it just disappears from the dashboard.

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const discard = request.nextUrl.searchParams.get('discard') === 'true'
  const db = createAdminClient()

  // Check if the post has already been pushed to an external platform
  const { data: post } = await db
    .from('content_posts')
    .select('wp_post_id, bc_post_id')
    .eq('id', id)
    .maybeSingle()

  const isPublished = !!(post?.wp_post_id || post?.bc_post_id)

  if (isPublished) {
    // Post lives on WordPress/BigCommerce — archive it in our dashboard only
    const { error } = await db
      .from('content_posts')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Not yet published — reject and handle topic cleanup
  const { error: postErr } = await db
    .from('content_posts')
    .update({ status: 'rejected' })
    .eq('id', id)

  if (postErr) {
    return NextResponse.json({ error: postErr.message }, { status: 500 })
  }

  if (discard) {
    // Permanently kill the topic so it won't regenerate
    await db
      .from('content_topics')
      .update({ status: 'rejected' })
      .eq('post_id', id)
      .not('status', 'eq', 'rejected')
  } else {
    // Reset topic back to approved so the cron regenerates a new post
    await db
      .from('content_topics')
      .update({ status: 'approved', post_id: null })
      .eq('post_id', id)
  }

  return NextResponse.json({ ok: true })
}
