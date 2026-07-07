// POST /api/admin/content/posts/[id]/dismiss
// Rejects a post and handles its parent topic in one of two ways:
//   ?discard=true  → topic → 'rejected' (permanent kill)
//   (default)      → topic → 'approved', post_id = null (cron re-generates)

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
