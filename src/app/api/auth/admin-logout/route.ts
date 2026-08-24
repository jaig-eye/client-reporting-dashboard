// Returns JSON so the client-side handler (Sidebar) can do the redirect itself.
// Avoids depending on NEXT_PUBLIC_APP_URL for the redirect target.
import { NextResponse }    from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { logActivity }     from '@/lib/activity'
import { clearSessionCookies } from '@/lib/clearSession'

export async function POST() {
  const adminSession = await getAdminSession()
  logActivity(adminSession, 'logged_out', 'user', { meta: {} })
  // Clears the whole session set with attributes matching how they were set, so the
  // deletion isn't dropped by the browser inside the cross-origin CRM iframe.
  return clearSessionCookies(NextResponse.json({ ok: true }))
}
