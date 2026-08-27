import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed, getVerifiedUserId } from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId } = await params
  const db = createAdminClient()

  const { data, error } = await db
    .from('client_notes')
    .select('id, title, content, pinned, created_at, updated_at, updated_by, user_id, users:users!user_id(name, avatar_url), editor:users!updated_by(name, avatar_url)')
    .eq('client_id', clientId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[client notes GET]', error)
    return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 })
  }

  return NextResponse.json({ notes: data ?? [] })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId } = await params
  // From the SIGNED session, never the admin_user_id cookie: that cookie is
  // client-editable, so any authenticated admin could attribute a write to a
  // colleague just by changing it. Returns null for the super admin, who has no
  // user row — same as before.
  const userId = getVerifiedUserId(session)

  let body: { content?: string; title?: string; pinned?: boolean }
  try {
    body = await request.json() as { content?: string; title?: string; pinned?: boolean }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const content = body.content?.trim()
  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  const db = createAdminClient()

  const { data, error } = await db
    .from('client_notes')
    .insert({
      client_id: clientId,
      user_id:   userId,
      content,
      title:     body.title?.trim() || null,
      pinned:    body.pinned ?? false,
    })
    .select('id, title, content, pinned, created_at, updated_at, updated_by, user_id, users:users!user_id(name, avatar_url)')
    .single()

  if (error || !data) {
    console.error('[client notes POST]', error)
    return NextResponse.json({ error: 'Failed to save note' }, { status: 500 })
  }

  // editor is always null on a fresh insert (updated_by is unset)
  return NextResponse.json({ note: { ...data, editor: null } }, { status: 201 })
}
