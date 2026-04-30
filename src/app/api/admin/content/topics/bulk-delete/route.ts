// POST /api/admin/content/topics/bulk-delete
// Body: { ids?: string[], post_ids?: string[], purge_all?: boolean }
// ids      — delete specific topic IDs and their linked content_posts (via post_id FK)
// post_ids — delete specific content_post IDs directly (for posts not linked to a topic)
// purge_all — delete ALL content_topics and content_posts

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { ids?: string[]; post_ids?: string[]; purge_all?: boolean }
  const db = createAdminClient()

  if (body.purge_all) {
    const [postsRes, topicsRes] = await Promise.all([
      db.from('content_posts').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      db.from('content_topics').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    ])
    if (postsRes.error)  return NextResponse.json({ error: postsRes.error.message },  { status: 500 })
    if (topicsRes.error) return NextResponse.json({ error: topicsRes.error.message }, { status: 500 })
    return NextResponse.json({ deleted: 'all' })
  }

  const topicIds = body.ids ?? []
  const postIds  = body.post_ids ?? []

  if (topicIds.length === 0 && postIds.length === 0) {
    return NextResponse.json({ error: 'No ids provided' }, { status: 400 })
  }

  // For topic IDs: fetch linked post_ids so we can cascade-delete them
  let linkedPostIds: string[] = []
  if (topicIds.length > 0) {
    const { data: topics } = await db
      .from('content_topics')
      .select('id, post_id')
      .in('id', topicIds)

    linkedPostIds = (topics ?? [])
      .map(t => (t as { post_id: string | null }).post_id)
      .filter((id): id is string => !!id)
  }

  const allPostIdsToDelete = Array.from(new Set(linkedPostIds.concat(postIds)))

  const [topicsRes, postsRes] = await Promise.all([
    topicIds.length > 0
      ? db.from('content_topics').delete().in('id', topicIds)
      : Promise.resolve({ error: null }),
    allPostIdsToDelete.length > 0
      ? db.from('content_posts').delete().in('id', allPostIdsToDelete)
      : Promise.resolve({ error: null }),
  ])

  if (topicsRes.error) return NextResponse.json({ error: topicsRes.error.message }, { status: 500 })
  if (postsRes.error)  return NextResponse.json({ error: postsRes.error.message },  { status: 500 })

  return NextResponse.json({ deleted: topicIds.length + postIds.length })
}
