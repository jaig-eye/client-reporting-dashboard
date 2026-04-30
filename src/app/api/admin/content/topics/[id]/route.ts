// PATCH /api/admin/content/topics/[id]
// Updates topic status (approve/reject) and target_publish_date.
// When approving past the generate_by_date deadline, fires post generation immediately.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

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
  }

  const allowed = ['status', 'target_publish_date']
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key as keyof typeof body] !== undefined) {
      patch[key] = body[key as keyof typeof body]
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  // Approval now schedules the topic for cron-based generation
  if (patch.status === 'approved') patch.status = 'scheduled'

  const db = createAdminClient()
  const { data, error } = await db
    .from('content_topics')
    .update(patch)
    .eq('id', id)
    .select('id, status, generate_by_date, client_id, target_publish_date')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-reject remaining pending topics once the required approval count is reached
  const topic = data as { id: string; status: string; generate_by_date: string | null; client_id: string; target_publish_date: string | null }
  if (patch.status === 'scheduled' && topic.target_publish_date) {
    // Resolve posts_per_run: client-specific setting falls back to global
    const [{ data: clientCfg }, { data: globalCfg }] = await Promise.all([
      db.from('content_settings').select('posts_per_run').eq('client_id', topic.client_id).maybeSingle(),
      db.from('content_settings').select('posts_per_run').is('client_id', null).maybeSingle(),
    ])
    const postsNeeded = (clientCfg as { posts_per_run: number } | null)?.posts_per_run
      ?? (globalCfg as { posts_per_run: number } | null)?.posts_per_run
      ?? 1

    // Count how many topics are now approved (including the one just approved)
    const { count: approvedCount } = await db
      .from('content_topics')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', topic.client_id)
      .eq('target_publish_date', topic.target_publish_date)
      .in('status', ['approved', 'generating', 'generated', 'scheduled'])

    if ((approvedCount ?? 0) >= postsNeeded) {
      await db
        .from('content_topics')
        .update({ status: 'rejected' })
        .eq('client_id', topic.client_id)
        .eq('target_publish_date', topic.target_publish_date)
        .eq('status', 'pending')
        .neq('id', id)
    }
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
  return NextResponse.json({ ok: true })
}
