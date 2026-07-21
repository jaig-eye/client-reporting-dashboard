// /api/admin/connections/[id]
// PATCH: update connection display name, status, or config fields. DELETE: disconnect.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity }     from '@/lib/activity'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json()

  const update: Record<string, unknown> = {}
  if (body.external_name !== undefined) update.external_name = body.external_name
  if (body.status        !== undefined) update.status        = body.status

  const db = createAdminClient()

  // Merge config fields (e.g. page_filter_regex) into existing JSONB config
  if (body.config !== undefined && body.config !== null && typeof body.config === 'object') {
    const { data: existing } = await db
      .from('client_connections')
      .select('config')
      .eq('id', id)
      .single()
    const existingConfig = (existing as { config?: Record<string, unknown> } | null)?.config ?? {}
    update.config = { ...existingConfig, ...(body.config as Record<string, unknown>) }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }
  const { data, error } = await db
    .from('client_connections')
    .update(update)
    .eq('id', id)
    .select('id, external_id, external_name, status')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'updated', 'connection', {
    resourceId: id,
    meta: { status: (data as { status?: string } | null)?.status ?? '' },
  })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const db = createAdminClient()
  const { error } = await db.from('client_connections').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'deleted', 'connection', { resourceId: id, meta: {} })
  return NextResponse.json({ deleted: true })
}
