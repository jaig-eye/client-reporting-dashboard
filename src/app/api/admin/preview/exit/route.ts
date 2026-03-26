import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/auth'

export async function POST() {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.delete('client_token')
  return res
}
