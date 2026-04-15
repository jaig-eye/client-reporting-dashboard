// /api/admin/connectors/[id]
// PATCH: update connector label/config. DELETE: remove connector.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { ahrefsConnector } from '@/lib/connectors/ahrefs'

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
    const { data: existing, error: fetchErr } = await db
      .from('connectors')
      .select('auth')
      .eq('id', id)
      .single()
    if (fetchErr) {
      console.error('Failed to fetch existing auth for merge:', fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }
    const merged = { ...((existing?.auth ?? {}) as object), ...(body.auth_patch as object) }
    console.log('Merging auth_patch, keys:', Object.keys(merged))
    update.auth = merged
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await db
    .from('connectors')
    .update(update)
    .eq('id', id)
    .select('id, type, label, status, config, auth, last_checked_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // For Ahrefs: re-test connection whenever auth is patched
  if (data?.type === 'ahrefs' && body.auth_patch) {
    try {
      const ok = await ahrefsConnector.testConnection!(data.auth as Record<string, unknown>, {})
      const testStatus = ok ? 'active' : 'error'
      const testConfig = ok
        ? { ...(data.config as object ?? {}) }
        : { ...(data.config as object ?? {}), error: 'API key invalid or request failed' }
      await db.from('connectors').update({ status: testStatus, config: testConfig, last_checked_at: new Date().toISOString() }).eq('id', id)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { auth: _auth, ...safeData } = data
      return NextResponse.json({ ...safeData, status: testStatus, config: testConfig })
    } catch (e) {
      await db.from('connectors').update({ status: 'error' }).eq('id', id)
    }
  }

  // Never return raw auth field
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth: _auth, ...safeData } = data as typeof data & { auth?: unknown }
  return NextResponse.json(safeData)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const db = createAdminClient()
  const { error } = await db.from('connectors').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
