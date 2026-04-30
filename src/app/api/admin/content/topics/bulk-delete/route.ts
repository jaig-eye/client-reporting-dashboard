// POST /api/admin/content/topics/bulk-delete
// Body: { ids?: string[], purge_all?: boolean }
// ids      — delete specific topic IDs and their linked content_posts
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

  const body = await request.json() as { ids?: string[]; purge_all?: boolean }
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

  const ids = body.ids ?? []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No ids provided' }, { status: 400 })
  }

  // Fetch the post_ids linked to these topics so we can delete them too
  const { data: topics } = await db
    .from('content_topics')
    .select('id, post_id')
    .in('id', ids)

  const postIds = (topics ?? [])
    .map(t => (t as { post_id: string | null }).post_id)
    .filter((id): id is string => !!id)

  const [topicsRes, postsRes] = await Promise.all([
    db.from('content_topics').delete().in('id', ids),
    postIds.length > 0
      ? db.from('content_posts').delete().in('id', postIds)
      : Promise.resolve({ error: null }),
  ])

  if (topicsRes.error) return NextResponse.json({ error: topicsRes.error.message }, { status: 500 })
  if (postsRes.error)  return NextResponse.json({ error: postsRes.error.message },  { status: 500 })

  return NextResponse.json({ deleted: ids.length })
}
