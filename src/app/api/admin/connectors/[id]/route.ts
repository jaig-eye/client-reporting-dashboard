// /api/admin/connectors/[id]
// PATCH: update connector label/config. DELETE: remove connector.

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

  const db = createAdminClient()
  const update: Record<string, unknown> = {}
  if (body.label  !== undefined) update.label  = body.label
  if (body.config !== undefined) update.config = body.config
  if (body.status !== undefined) update.status = body.status

  // auth_patch: merge specific auth fields without overwriting OAuth tokens
  if (body.auth_patch && typeof body.auth_patch === 'object') {
    const { data: existing } = await db
      .from('connectors')
      .select('auth')
      .eq('id', id)
      .single()
    update.auth = { ...((existing?.auth ?? {}) as object), ...body.auth_patch }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await db
    .from('connectors')
    .update(update)
    .eq('id', id)
    .select('id, type, label, status, config, last_checked_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const db = createAdminClient()
  const { error } = await db.from('connectors').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
