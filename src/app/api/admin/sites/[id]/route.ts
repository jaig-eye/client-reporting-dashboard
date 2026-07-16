import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const ALLOWED_PATCH = [
  'name', 'url', 'client_id', 'platform', 'hosting_type',
  'hosting_provider', 'server_account', 'group_id', 'status', 'notes',
  'discord_channel_id',
  'audit_enabled', 'audit_scope',
]

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('sites')
    .select('*, clients(id, name), site_groups(id, name)')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ site: data })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const updates: Record<string, unknown> = {}
  for (const key of ALLOWED_PATCH) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()

  const db = createAdminClient()
  const { data, error } = await db
    .from('sites')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ site: data })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { error } = await db.from('sites').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
