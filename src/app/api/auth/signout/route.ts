import { NextRequest, NextResponse } from 'next/server'
import { clearSessionCookies } from '@/lib/clearSession'

export async function POST(request: NextRequest) {
  // CLIENT scope only. This is the client-portal sign-out; widening it to every
  // session cookie meant an admin who had entered a client dashboard via preview
  // and hit sign-out also lost their admin session.
  //
  // The redirect target is built from the REQUEST url, not NEXT_PUBLIC_APP_URL.
  // `new URL('/access', undefined)` throws, which produced a 500 carrying no
  // Set-Cookie at all — so a missing env var turned sign-out into a silent no-op
  // that left client_token alive. admin-logout deliberately avoids the same
  // dependency by returning JSON.
  const res = NextResponse.redirect(new URL('/access', request.url))
  return clearSessionCookies(res, 'client')
}
