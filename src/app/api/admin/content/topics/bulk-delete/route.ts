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

  // Resolve everything BEFORE deleting; the links are unrecoverable afterwards.
  //
  // This branch used to carry none of the guards DELETE /posts/[id] has, so the same action
  // behaved differently depending on which route the UI called:
  //   - a post live on a client's CMS was deleted here, removing our record while leaving the
  //     article published -- invisible to /dismiss and to the cannibalisation avoid-list
  //   - paired rows were resolved through content_topics.post_id only, which is set on ~85% of
  //     topics but only ~29% of posts, so the other side was routinely stranded. A stranded
  //     topic keeps its subject in the avoid-list, the opposite of what deleting means.
  const slotsToSuppress: { client_id: string; target_publish_date: string | null }[] = []
  const topicIdsToDelete = new Set<string>(topicIds)
  const postIdsToDelete  = new Set<string>()
  const skippedLive: { id: string; title: string | null }[] = []

  type PostRow = {
    id: string; client_id: string; target_publish_date: string | null
    topic_id: string | null; title: string | null
    wp_post_id: number | null; bc_post_id: number | null
  }

  // Every post reachable from this request: named directly, or linked from a named topic in
  // either direction. Both link columns are ON DELETE SET NULL, so neither cascades.
  const candidatePostIds = new Set<string>(postIds)

  if (topicIds.length > 0) {
    const [{ data: topics }, { data: byTopicId }] = await Promise.all([
      db.from('content_topics')
        .select('id, post_id, client_id, target_publish_date')
        .in('id', topicIds),
      db.from('content_posts').select('id').in('topic_id', topicIds),
    ])

    for (const t of (topics ?? []) as {
      id: string; post_id: string | null; client_id: string; target_publish_date: string | null
    }[]) {
      slotsToSuppress.push(t)
      if (t.post_id) candidatePostIds.add(t.post_id)
    }
    for (const r of (byTopicId ?? []) as { id: string }[]) candidatePostIds.add(r.id)
  }

  if (candidatePostIds.size > 0) {
    const { data: posts } = await db
      .from('content_posts')
      .select('id, client_id, target_publish_date, topic_id, title, wp_post_id, bc_post_id')
      .in('id', Array.from(candidatePostIds))

    for (const post of (posts ?? []) as PostRow[]) {
      // A live article is never deleted from here, for the same reason DELETE /posts/[id]
      // returns 409: removing the row does not take the article off the client's site.
      // Skipped rather than fatal, so one live post cannot abort the whole batch.
      if (post.wp_post_id || post.bc_post_id) {
        skippedLive.push({ id: post.id, title: post.title })
        continue
      }
      postIdsToDelete.add(post.id)
      slotsToSuppress.push(post)
      if (post.topic_id) topicIdsToDelete.add(post.topic_id)
    }
  }

  // The other direction: topics pointing at a post we are about to delete.
  if (postIdsToDelete.size > 0) {
    const { data: pairedTopics } = await db
      .from('content_topics')
      .select('id, client_id, target_publish_date')
      .in('post_id', Array.from(postIdsToDelete))
    for (const t of (pairedTopics ?? []) as {
      id: string; client_id: string; target_publish_date: string | null
    }[]) {
      topicIdsToDelete.add(t.id)
      slotsToSuppress.push(t)
    }
  }

  if (topicIdsToDelete.size === 0 && postIdsToDelete.size === 0) {
    return NextResponse.json(
      {
        error: skippedLive.length > 0
          ? 'Every selected post is published on the client’s site. Use Discard to take them down first.'
          : 'Nothing to delete',
        skippedLive,
      },
      { status: skippedLive.length > 0 ? 409 : 400 },
    )
  }

  const [topicsRes, postsRes] = await Promise.all([
    topicIdsToDelete.size > 0
      ? db.from('content_topics').delete().in('id', Array.from(topicIdsToDelete))
      : Promise.resolve({ error: null }),
    postIdsToDelete.size > 0
      ? db.from('content_posts').delete().in('id', Array.from(postIdsToDelete))
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
    deletedTopics:   topicIdsToDelete.size,
    deletedPosts:    postIdsToDelete.size,
    suppressedSlots: slotsToSuppress.filter(s => s.target_publish_date).length,
    skippedLive,
  })
}
