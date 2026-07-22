import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'

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

  let body: { pinned?: boolean }
  try {
    body = await request.json() as { pinned?: boolean }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = createAdminClient()

  const { data, error } = await db
    .from('client_notes')
    .update({ pinned: body.pinned })
    .eq('id', noteId)
    .eq('client_id', clientId)
    .select('id, content, pinned, created_at, user_id, users(name, avatar_url)')
    .maybeSingle()

  if (error) {
    console.error('[client note PATCH]', error)
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }

  return NextResponse.json({ note: data })
}
