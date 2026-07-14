// POST /api/admin/content/topics/bulk-reject
// Body: { topic_ids: string[] }
// Sets status = 'rejected' for all given topic IDs without deleting them.
// Used by the slot "Clean up" action to archive stale pending/approved topics
// in calendar slots that already have a generated post.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
  const { error } = await db
    .from('content_topics')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .in('id', topicIds)
    .eq('client_id', clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rejected: topicIds.length })
}
