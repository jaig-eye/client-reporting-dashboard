import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/auth'
import { clearCookie } from '@/lib/clearSession'

export async function POST() {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  // Not cookies.delete(): that emits no Secure/SameSite=None, which the browser
  // rejects in the cross-origin CRM iframe — so 'Exit preview' silently failed and
  // the admin stayed pinned to the client dashboard.
  clearCookie(res, 'client_token')
  return res
}
