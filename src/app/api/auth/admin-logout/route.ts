// Returns JSON so the client-side handler (Sidebar) can do the redirect itself.
// Avoids depending on NEXT_PUBLIC_APP_URL for the redirect target.
import { NextResponse }    from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { logActivity }     from '@/lib/activity'

export async function POST() {
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'logged_out', 'user', { meta: {} })
  const response = NextResponse.json({ ok: true })
  // Clear the entire session cookie set so nothing survives on a shared machine —
  // including any preview client_token and the raw-cost view flag.
  for (const name of ['admin_session', 'admin_user_id', 'client_token', 'admin_raw_mode']) {
    response.cookies.set(name, '', { maxAge: 0, path: '/' })
  }
  return response
}
