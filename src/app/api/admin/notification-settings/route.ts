import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import type { NotifConfig }          from '@/lib/notificationConfig'

export async function GET(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('agency_settings')
    .select('notification_config')
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  return NextResponse.json({ config: (data?.notification_config as NotifConfig | null) ?? {} })
}

export async function PUT(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { config: NotifConfig }
  try { body = await request.json() as typeof body } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Validate shape: each key must be { discord, ops, client } booleans
  const config = body.config ?? {}
  for (const [key, val] of Object.entries(config)) {
    if (typeof val !== 'object' || val === null) {
      return NextResponse.json({ error: `Invalid value for key "${key}"` }, { status: 400 })
    }
    const v = val as unknown as Record<string, unknown>
    if (typeof v.discord !== 'boolean' || typeof v.ops !== 'boolean' || typeof v.client !== 'boolean') {
      return NextResponse.json({ error: `Key "${key}" must have boolean discord, ops, client fields` }, { status: 400 })
    }
  }

  const db = createAdminClient()
  const { error } = await db
    .from('agency_settings')
    .update({ notification_config: config })

  if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
