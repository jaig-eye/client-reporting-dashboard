// PATCH /api/admin/content/posts/[id]
// Body: { status?, title?, seoTitle?, content?, metaDescription?, slug?,
//         targetKeyword?, suggestedTags?, featuredImageUrl?, wpStatus?, authorId?, categoryIds? }
// Status-only updates (reject, restore) and full Save Changes from the review drawer.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

const ALLOWED_STATUSES = ['pending', 'for_review', 'approved', 'rejected', 'published', 'draft_saved']

type PatchBody = {
  status?:          string
  title?:           string | null
  seoTitle?:        string | null
  content?:         string | null
  metaDescription?: string | null
  slug?:            string | null
  targetKeyword?:   string | null
  suggestedTags?:   string[]
  featuredImageUrl?: string | null
  wpStatus?:        string | null
  authorId?:        number | null
  categoryIds?:     number[] | null
  connectionId?:    string | null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminSession = await getAdminSession()
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  const { id } = await params
  const body = await request.json() as PatchBody

  if (body.status !== undefined && !ALLOWED_STATUSES.includes(body.status))
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  const update: Record<string, unknown> = {}

  if (body.status          !== undefined) update.status           = body.status
  if (body.title           !== undefined) update.title            = body.title
  if (body.seoTitle        !== undefined) update.seo_title        = body.seoTitle
  if (body.content         !== undefined) update.content          = body.content
  if (body.metaDescription !== undefined) update.meta_description = body.metaDescription
  if (body.slug            !== undefined) update.slug             = body.slug
  if (body.targetKeyword   !== undefined) update.target_keyword   = body.targetKeyword
  if (body.suggestedTags   !== undefined) update.suggested_tags   = body.suggestedTags
  if (body.featuredImageUrl !== undefined) update.featured_image_url = body.featuredImageUrl
  if (body.wpStatus        !== undefined) update.wp_status        = body.wpStatus
  if (body.authorId        !== undefined) update.wp_author_id     = body.authorId
  if (body.categoryIds     !== undefined) update.wp_category_ids  = body.categoryIds
  if (body.connectionId    !== undefined) update.connection_id    = body.connectionId

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const db = createAdminClient()
  const { error } = await db.from('content_posts').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  logActivity(adminSession, 'updated', 'post', {
    resourceId: id,
    ip,
    meta: { fields: Object.keys(update) },
  })

  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/content/posts/[id]
//
// Hard-deletes a post AND its originating topic, which is what makes the subject
// eligible to be generated again.
//
// This is the counterpart to reject, and the difference is deliberate:
//
//   REJECT (PATCH status='rejected') keeps the row. It is an editorial signal that a
//   human saw this specific angle and did not want it, so the topic avoid-list in
//   lib/content/generateTopics.ts keeps it and it is never suggested again.
//
//   DELETE removes it. It means "forget this ever happened" — a duplicate, a
//   mis-generation, a test — where nothing about the subject itself was wrong. The
//   topic row goes too, because leaving it behind would keep the subject in the
//   avoid-list and quietly prevent it from ever being regenerated, which is the
//   opposite of what deleting is for.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  // Resolve the topic BEFORE deleting the post — the links are unrecoverable after.
  const { data: post } = await db
    .from('content_posts')
    .select('id, topic_id, title, client_id, target_publish_date')
    .eq('id', id)
    .maybeSingle()

  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const row = post as {
    topic_id: string | null; title: string | null
    client_id: string; target_publish_date: string | null
  }

  // topic_id is only populated on about a third of existing posts, so relying on it
  // alone would silently strand the topic for the majority — leaving the subject in
  // the avoid-list and permanently un-regeneratable, which is the exact opposite of
  // what deleting is meant to achieve. Fall back to the slot pairing the calendar
  // itself uses: one topic per client per publish date.
  let topicId = row.topic_id
  if (!topicId && row.target_publish_date) {
    const { data: slotTopic } = await db
      .from('content_topics')
      .select('id')
      .eq('client_id', row.client_id)
      .eq('target_publish_date', row.target_publish_date)
      .limit(1)
      .maybeSingle()
    topicId = (slotTopic as { id: string } | null)?.id ?? null
  }

  const { error } = await db.from('content_posts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (topicId) {
    const { error: topicErr } = await db.from('content_topics').delete().eq('id', topicId)
    // Non-fatal: the post is already gone, and failing here would invite a retry that
    // 404s. Log it — an orphaned topic keeps the subject in the avoid-list.
    if (topicErr) {
      console.error(`[posts/${id}] post deleted but topic ${topicId} was not:`, topicErr.message)
    }
  }

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'deleted', 'post', {
    resourceId: id,
    meta: { title: row.title, topicId, topicMatchedBySlot: !row.topic_id && !!topicId },
  })

  return NextResponse.json({ ok: true, deletedTopic: !!topicId })
}
