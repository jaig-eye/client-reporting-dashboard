import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId } = await params
  const db = createAdminClient()
  const { data: client } = await db
    .from('clients')
    .select('dashboard_token')
    .eq('id', clientId)
    .single()

  if (!client?.dashboard_token) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('client_token', client.dashboard_token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8, // 8 hours
  })
  return res
}
