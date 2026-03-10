// Returns JSON so the client-side handler (Sidebar) can do the redirect itself.
// Avoids depending on NEXT_PUBLIC_APP_URL for the redirect target.
import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set('admin_session', '', { maxAge: 0, path: '/' })
  response.cookies.set('admin_user_id', '', { maxAge: 0, path: '/' })
  return response
}
