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

  // Validate shape: each key must have at least one known boolean field
  const config = body.config ?? {}
  for (const [key, val] of Object.entries(config)) {
    if (typeof val !== 'object' || val === null) {
      return NextResponse.json({ error: `Invalid value for key "${key}"` }, { status: 400 })
    }
    const v = val as unknown as Record<string, unknown>
    const knownFields = ['agency', 'email', 'manager', 'client']
    const hasKnown = knownFields.some(f => f in v && typeof v[f] === 'boolean')
    if (!hasKnown) {
      return NextResponse.json({ error: `Key "${key}" must have at least one of: agency, email, manager, client` }, { status: 400 })
    }
  }

  const db = createAdminClient()
  const { data: existing, error: fetchErr } = await db
    .from('agency_settings')
    .select('id')
    .maybeSingle()

  if (fetchErr) return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Agency settings not found' }, { status: 404 })

  const { error } = await db
    .from('agency_settings')
    .update({ notification_config: config })
    .eq('id', existing.id)

  if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
