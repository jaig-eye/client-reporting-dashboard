import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { parseBody } from '@/lib/apiError'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, contactId } = await params
  const body = await parseBody<{ name?: string; email?: string; phone?: string; role?: string }>(request)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if ('name'  in body) patch.name  = body.name
  if ('email' in body) patch.email = body.email
  if ('phone' in body) patch.phone = body.phone
  if ('role'  in body) patch.role  = body.role

  const db = createAdminClient()
  const { data, error } = await db
    .from('client_contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('client_id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, contactId } = await params
  const db = createAdminClient()
  const { error } = await db
    .from('client_contacts')
    .delete()
    .eq('id', contactId)
    .eq('client_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
