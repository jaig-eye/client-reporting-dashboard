import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'

const NOTE_SELECT = 'id, title, content, pinned, created_at, updated_at, updated_by, user_id, users(name, avatar_url), editor:users!updated_by(name, avatar_url)'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId, noteId } = await params
  const db = createAdminClient()

  const { error } = await db
    .from('client_notes')
    .delete()
    .eq('id', noteId)
    .eq('client_id', clientId)

  if (error) {
    console.error('[client note DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: clientId, noteId } = await params
  const userId = request.cookies.get('admin_user_id')?.value ?? null

  let body: { pinned?: boolean; content?: string; title?: string | null }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = createAdminClient()

  // Build the update patch depending on what was sent
  const patch: Record<string, unknown> = {}

  if ('pinned' in body) {
    patch.pinned = body.pinned
  }

  if ('content' in body) {
    const content = (body.content ?? '').trim()
    if (!content) return NextResponse.json({ error: 'content cannot be empty' }, { status: 400 })
    patch.content    = content
    patch.title      = body.title?.trim() || null
    patch.updated_at = new Date().toISOString()
    patch.updated_by = userId
  } else if ('title' in body && !('pinned' in body)) {
    // title-only update
    patch.title      = body.title?.trim() || null
    patch.updated_at = new Date().toISOString()
    patch.updated_by = userId
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await db
    .from('client_notes')
    .update(patch)
    .eq('id', noteId)
    .eq('client_id', clientId)
    .select(NOTE_SELECT)
    .maybeSingle()

  if (error) {
    console.error('[client note PATCH]', error)
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

  return NextResponse.json({ note: data })
}
