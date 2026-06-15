import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { parseBody } from '@/lib/apiError'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createAdminClient()
  const { data, error } = await db
    .from('client_contacts')
    .select('*')
    .eq('client_id', id)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await parseBody<{ name: string; email?: string; phone?: string; role?: string }>(request)
  if (!body?.name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const db = createAdminClient()
  const { data, error } = await db
    .from('client_contacts')
    .insert({
      client_id: id,
      name:      body.name,
      email:     body.email ?? null,
      phone:     body.phone ?? null,
      role:      body.role  ?? 'contact',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
