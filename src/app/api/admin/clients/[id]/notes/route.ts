import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
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
    .select('id, title, content, pinned, created_at, updated_at, updated_by, user_id, users(name, avatar_url), editor:users!updated_by(name, avatar_url)')
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
  const userId = request.cookies.get('admin_user_id')?.value ?? null

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
    .select('id, title, content, pinned, created_at, updated_at, updated_by, user_id, users(name, avatar_url), editor:users!updated_by(name, avatar_url)')
    .single()

  if (error || !data) {
    console.error('[client notes POST]', error)
    return NextResponse.json({ error: 'Failed to save note' }, { status: 500 })
  }

  return NextResponse.json({ note: data }, { status: 201 })
}
