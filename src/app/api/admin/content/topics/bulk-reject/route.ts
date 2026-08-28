// POST /api/admin/content/topics/bulk-reject
// Body: { topic_ids: string[] }
// Sets status = 'rejected' for all given topic IDs without deleting them.
// Used by the slot "Clean up" action to archive stale pending/approved topics
// in calendar slots that already have a generated post.

import { releaseKeywordsForTopics } from '@/lib/content/siloQueue'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const adminSession = await getAdminSession()
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  const body = await request.json() as { topic_ids?: string[]; client_id?: string }
  const topicIds = body.topic_ids ?? []
  const clientId = body.client_id ?? null

  if (topicIds.length === 0) {
    return NextResponse.json({ error: 'No topic_ids provided' }, { status: 400 })
  }
  if (!clientId) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data: rejected, error } = await db
    .from('content_topics')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .in('id', topicIds)
    .eq('client_id', clientId)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Rejected topics hand their silo keywords back to the queue. Without this a
  // bulk reject retires every one of those terms permanently and the silo reads
  // "0 of N left" with nothing published for them.
  await releaseKeywordsForTopics(db, (rejected ?? []).map((t: { id: string }) => t.id))
    .catch(() => {})

  logActivity(adminSession, 'rejected', 'topics', {
    clientId,
    ip,
    meta: { count: topicIds.length },
  })

  return NextResponse.json({ rejected: topicIds.length })
}
