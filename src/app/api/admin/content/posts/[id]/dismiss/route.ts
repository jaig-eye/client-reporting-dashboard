// POST /api/admin/content/posts/[id]/dismiss
// Rejects an orphaned post and any topic still linked to it.
// Used by the client schedule UI to clean up duplicate/stale SA posts.

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  const { error: postErr } = await db
    .from('content_posts')
    .update({ status: 'rejected' })
    .eq('id', id)

  if (postErr) {
    return NextResponse.json({ error: postErr.message }, { status: 500 })
  }

  // Reject any topic pointing at this post so it doesn't re-queue
  await db
    .from('content_topics')
    .update({ status: 'rejected' })
    .eq('post_id', id)
    .not('status', 'eq', 'rejected')

  return NextResponse.json({ ok: true })
}
