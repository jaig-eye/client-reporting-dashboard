// /api/admin/connections/[id]
// PATCH: update connection display name or status. DELETE: disconnect.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

function requireAdmin(req: NextRequest): boolean {
  const session = req.cookies.get('admin_session')?.value
  return !!session && session === process.env.ADMIN_PASSWORD
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json()

  const update: Record<string, unknown> = {}
  if (body.external_name !== undefined) update.external_name = body.external_name
  if (body.status        !== undefined) update.status        = body.status

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('client_connections')
    .update(update)
    .eq('id', id)
    .select('id, external_id, external_name, status')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const db = createAdminClient()
  const { error } = await db.from('client_connections').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
