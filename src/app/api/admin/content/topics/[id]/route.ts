// PATCH /api/admin/content/topics/[id]
// Updates topic status (approve/reject) and target_publish_date.
// When approving past the generate_by_date deadline, fires post generation immediately.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

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
    const [{ data: clientCfg }, { data: globalCfg }] = await Promise.all([
      db.from('content_settings').select('posts_per_run').eq('client_id', topic.client_id).maybeSingle(),
      db.from('content_settings').select('posts_per_run').is('client_id', null).maybeSingle(),
    ])
    const postsNeeded = (clientCfg as { posts_per_run: number } | null)?.posts_per_run
      ?? (globalCfg as { posts_per_run: number } | null)?.posts_per_run
      ?? 1

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
  const { error } = await db.from('content_topics').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'deleted', 'topic', { resourceId: id })
  return NextResponse.json({ ok: true })
}
