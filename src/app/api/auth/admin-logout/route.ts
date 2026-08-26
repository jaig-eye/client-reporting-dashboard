// Returns JSON so the client-side handler (Sidebar) can do the redirect itself.
// Avoids depending on NEXT_PUBLIC_APP_URL for the redirect target.
import { NextResponse }    from 'next/server'
import { getAdminSession, IDENTITY_COOKIE } from '@/lib/auth'
import { logActivity }     from '@/lib/activity'

export async function POST() {
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'logged_out', 'user', { meta: {} })
  const response = NextResponse.json({ ok: true })
  response.cookies.set('admin_session', '', { maxAge: 0, path: '/' })
  response.cookies.set('admin_user_id', '', { maxAge: 0, path: '/' })
  response.cookies.set(IDENTITY_COOKIE, '', { maxAge: 0, path: '/' })
  return response
}
