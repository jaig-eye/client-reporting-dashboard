// GET  /api/admin/content/topics/[id] — returns strategy/breakdown fields for the ContentPostEditor
// PATCH /api/admin/content/topics/[id]
// Updates topic status (approve/reject) and target_publish_date.
// When approving past the generate_by_date deadline, fires post generation immediately.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { suppressSlots, findPairedPostId } from '@/lib/content/slotSuppression'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createAdminClient()
  const { data, error } = await db
    .from('content_topics')
    .select('keyword_opportunity, ranking_strategy, audience_intent, why_now, competition_level, page_to_support, competitors_researched')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const d = data as Record<string, unknown>
  const cr = d.competitors_researched as { urls?: string[] } | null
  return NextResponse.json({
    keyword_opportunity: d.keyword_opportunity ?? null,
    ranking_strategy:    d.ranking_strategy    ?? null,
    audience_intent:     d.audience_intent     ?? null,
    why_now:             d.why_now             ?? null,
    competition_level:   d.competition_level   ?? null,
    page_to_support:     d.page_to_support     ?? null,
    competitors_researched: cr?.urls ?? null,
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json() as {
    status?: string
    target_publish_date?: string | null
    topic?: string
    edit_notes?: string | null
  }

  const allowed = ['status', 'target_publish_date', 'topic', 'edit_notes']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key as keyof typeof body] !== undefined) {
      patch[key] = body[key as keyof typeof body]
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('content_topics')
    .update(patch)
    .eq('id', id)
    .select('id, status, generate_by_date, client_id, target_publish_date')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-reject remaining topics for the same publish date once the slot quota is filled.
  // Scoped to target_publish_date so approving week-1 topics never affects week-2 topics.
  const topic = data as { id: string; status: string; generate_by_date: string | null; client_id: string; target_publish_date: string | null }
  if (patch.status === 'approved' && topic.target_publish_date) {
    const postsNeeded = 1

    const { count: approvedCount } = await db
      .from('content_topics')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', topic.client_id)
      .eq('target_publish_date', topic.target_publish_date)
      .in('status', ['approved', 'generating', 'generated'])

    if ((approvedCount ?? 0) >= postsNeeded) {
      await db
        .from('content_topics')
        .update({ status: 'rejected' })
        .eq('client_id', topic.client_id)
        .eq('target_publish_date', topic.target_publish_date)
        .in('status', ['pending', 'scheduled'])
        .neq('id', id)
    }
  }

  const adminSession = await getAdminSession()
  if (patch.status === 'approved' || patch.status === 'rejected') {
    logActivity(adminSession, patch.status, 'topic', {
      resourceId: id,
      clientId: topic.client_id,
      meta: { target_publish_date: topic.target_publish_date },
    })
  }

  return NextResponse.json(data)
}

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

  // Read the pairing and the slot BEFORE deleting — both become unrecoverable after.
  const { data: topic } = await db
    .from('content_topics')
    .select('id, client_id, post_id, target_publish_date')
    .eq('id', id)
    .maybeSingle()

  if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
  const row = topic as {
    id: string; client_id: string; post_id: string | null; target_publish_date: string | null
  }

  // Cascade to the written post. The FK is ON DELETE SET NULL in both directions, so
  // deleting only the topic left the post behind at status 'for_review' with a nulled
  // topic_id — it vanished from the topic list but kept rendering on the calendar as a
  // generated post, which reads exactly like the content coming back by itself.
  const pairedPostId = await findPairedPostId(db, row)

  const { error } = await db.from('content_topics').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (pairedPostId) {
    const { error: postErr } = await db.from('content_posts').delete().eq('id', pairedPostId)
    if (postErr) console.error(`[topics/${id}] topic deleted but paired post ${pairedPostId} was not:`, postErr.message)
  }

  // Stop the generator refilling this date. Without it, deleting is self-defeating —
  // the empty slot is precisely what triggers regeneration on the next run.
  await suppressSlots(db, [row], `topic ${id} deleted`)

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'deleted', 'topic', {
    resourceId: id,
    meta: { pairedPostId, slot: row.target_publish_date },
  })
  return NextResponse.json({ ok: true, deletedPostId: pairedPostId })
}
