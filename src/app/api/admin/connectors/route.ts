// /api/admin/connectors
// CRUD for agency-level connectors.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { ahrefsConnector } from '@/lib/connectors/ahrefs'
import { dataForSeoConnector } from '@/lib/connectors/dataforseo'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity }     from '@/lib/activity'

// Connectors whose credentials should be live-tested on create.
const TESTABLE = {
  ahrefs:     ahrefsConnector,
  dataforseo: dataForSeoConnector,
} as const

// GET — list all connectors
export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data, error } = await db.from('connectors').select('id, type, label, status, config, last_checked_at, created_at').order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Never return auth field (contains tokens)
  return NextResponse.json(data)
}

// POST — create a new connector
export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { type, label, auth, config } = body

  if (!type) return NextResponse.json({ error: 'type is required' }, { status: 400 })

  const db = createAdminClient()
  const { data, error } = await db
    .from('connectors')
    .insert({ type, label: label ?? '', auth: auth ?? {}, config: config ?? {}, status: 'pending' })
    .select('id, type, label, status, config, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'created', 'connector', {
    resourceId: data.id,
    meta: { type: data.type, label: data.label },
  })

  // For token/credential connectors: auto-test credentials and update status immediately
  const createAdapter = TESTABLE[type as keyof typeof TESTABLE]
  if (createAdapter && data) {
    try {
      const ok = await createAdapter.testConnection!(auth ?? {}, {})
      const newStatus = ok ? 'active' : 'error'
      const newConfig = ok ? (config ?? {}) : { ...(config ?? {}), error: 'Credentials invalid or request failed' }
      await db.from('connectors').update({ status: newStatus, config: newConfig }).eq('id', data.id)
      return NextResponse.json({ ...data, status: newStatus, config: newConfig }, { status: 201 })
    } catch (e) {
      await db.from('connectors').update({ status: 'error', config: { ...(config ?? {}), error: e instanceof Error ? e.message : 'Test failed' } }).eq('id', data.id)
      return NextResponse.json({ ...data, status: 'error' }, { status: 201 })
    }
  }

  return NextResponse.json(data, { status: 201 })
}
