import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

function isAdminAuthed(session: string | undefined) {
  return session && session === process.env.ADMIN_PASSWORD
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data, error } = await db.from('agency_settings').select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()

  const allowed = [
    'agency_name', 'agency_logo_url',
    'benchmark_roas', 'benchmark_ctr', 'benchmark_cpc', 'benchmark_conv_rate', 'benchmark_cpm',
    'default_date_range_days', 'default_conversion_value',
    'cron_enabled',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key]
  }

  const db = createAdminClient()
  const { data: existing } = await db.from('agency_settings').select('id').single()
  if (!existing?.id) {
    return NextResponse.json({ error: 'Settings row not found — run migrations' }, { status: 500 })
  }

  const { data, error } = await db
    .from('agency_settings')
    .update(patch)
    .eq('id', existing.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidatePath('/admin/settings')
  revalidatePath('/admin')

  return NextResponse.json(data)
}
