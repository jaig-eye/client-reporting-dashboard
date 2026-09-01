// POST /api/admin/content/topics/bulk-delete
// Body: { ids?: string[], post_ids?: string[], purge_all?: boolean }
// ids      — delete specific topic IDs and their linked content_posts (via post_id FK)
// post_ids — delete specific content_post IDs directly (for posts not linked to a topic)
// purge_all — delete ALL content_topics and content_posts

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { suppressSlots } from '@/lib/content/slotSuppression'
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

  // For topic IDs: fetch linked post_ids so we can cascade-delete them, plus the slot
  // each one occupies so the generator can be told not to refill it.
  let linkedPostIds: string[] = []
  const slotsToSuppress: { client_id: string; target_publish_date: string | null }[] = []
  if (topicIds.length > 0) {
    const { data: topics } = await db
      .from('content_topics')
      .select('id, post_id, client_id, target_publish_date')
      .in('id', topicIds)

    const rows = (topics ?? []) as {
      id: string; post_id: string | null; client_id: string; target_publish_date: string | null
    }[]

    linkedPostIds = rows.map(t => t.post_id).filter((id): id is string => !!id)
    slotsToSuppress.push(...rows)
  }

  // Deleting POSTS directly (not via their topic) frees the same slot, so collect
  // those too — otherwise clearing a batch of posts leaves the dates open and the
  // cron rebuilds them within the hour.
  if (postIds.length > 0) {
    const { data: posts } = await db
      .from('content_posts')
      .select('client_id, target_publish_date')
      .in('id', postIds)
    slotsToSuppress.push(...((posts ?? []) as { client_id: string; target_publish_date: string | null }[]))
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

  // Suppress AFTER the rows are gone, so a failure here cannot block the delete.
  // Without this the cron treats every emptied date as an open slot and regenerates
  // it on the next run — which is what made bulk-deleting a burst look like it kept
  // coming back.
  await suppressSlots(db, slotsToSuppress, 'bulk delete')

  return NextResponse.json({
    deleted: topicIds.length + postIds.length,
    suppressedSlots: slotsToSuppress.filter(s => s.target_publish_date).length,
  })
}
