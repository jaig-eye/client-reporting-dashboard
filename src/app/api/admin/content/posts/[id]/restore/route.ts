// POST /api/admin/content/posts/[id]/restore
// Un-discards a dismissed post, restoring it to for_review status.

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  const { data: post, error: fetchErr } = await db
    .from('content_posts')
    .select('id, status, topic_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  if (post.status !== 'rejected') {
    return NextResponse.json({ error: `Cannot restore a post with status "${post.status}"` }, { status: 409 })
  }

  const now = new Date().toISOString()

  const [postUpdate, topicUpdate] = await Promise.all([
    db.from('content_posts')
      .update({ status: 'for_review', updated_at: now })
      .eq('id', id),
    post.topic_id
      ? db.from('content_topics')
          .update({ status: 'approved', updated_at: now })
          .eq('id', post.topic_id)
      : Promise.resolve({ error: null }),
  ])

  if (postUpdate.error) {
    return NextResponse.json({ error: postUpdate.error.message }, { status: 500 })
  }

  if (topicUpdate.error) {
    console.error('[restore] topic update failed:', topicUpdate.error)
    return NextResponse.json({ error: 'Post restored but topic update failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
