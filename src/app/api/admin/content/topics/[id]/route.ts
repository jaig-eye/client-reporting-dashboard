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

  const db = createAdminClient()
  const { data, error } = await db
    .from('content_topics')
    .update(patch)
    .eq('id', id)
    .select('id, status, generate_by_date, client_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Late-approval: if topic just approved and past generate_by_date, trigger post gen immediately
  const topic = data as { id: string; status: string; generate_by_date: string | null; client_id: string }
  if (
    patch.status === 'approved' &&
    topic.generate_by_date &&
    new Date(topic.generate_by_date) <= new Date()
  ) {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    // Fire and forget — don't await so response returns immediately
    void fetch(`${appUrl}/api/admin/content/generate`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}`,
      },
      body: JSON.stringify({ topic_id: id }),
    }).then(() =>
      db.from('content_topics').update({ status: 'generating' }).eq('id', id)
    ).catch(err => console.error(`[topics PATCH] late-approval post gen failed for ${id}:`, err))
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
