import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

export async function GET() {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createAdminClient()
  const { data } = await db.from('clients').select('id, name, website').order('name')
  return NextResponse.json({ clients: data ?? [] })
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name, slug } = await request.json()
  if (!name || !slug) {
    return NextResponse.json({ error: 'name and slug are required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('clients')
    .insert({ name, slug })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'created', 'client', { resourceId: data.id, clientId: data.id, clientName: name, meta: { name, slug } })

  return NextResponse.json(data)
}
