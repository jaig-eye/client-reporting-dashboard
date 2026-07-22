import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'

const SELECT = 'id, client_id, is_active, emails_per_week, assigned_user_id, reminder_days_before, created_at, updated_at, users(id, name, avatar_url)'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId } = await params
  const db = createAdminClient()

  const { data, error } = await db
    .from('email_schedules')
    .select(SELECT)
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 })

  return NextResponse.json({ schedule: data })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId } = await params

  let body: {
    is_active?:            boolean
    emails_per_week?:      number
    assigned_user_id?:     string | null
    reminder_days_before?: number
  }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = createAdminClient()

  const { data, error } = await db
    .from('email_schedules')
    .upsert({
      client_id:            clientId,
      is_active:            body.is_active            ?? true,
      emails_per_week:      body.emails_per_week      ?? 1,
      assigned_user_id:     body.assigned_user_id     ?? null,
      reminder_days_before: body.reminder_days_before ?? 2,
      updated_at:           new Date().toISOString(),
    }, { onConflict: 'client_id' })
    .select(SELECT)
    .maybeSingle()

  if (error) {
    console.error('[email-schedule PUT]', error)
    return NextResponse.json({ error: 'Failed to save schedule' }, { status: 500 })
  }

  return NextResponse.json({ schedule: data })
}
