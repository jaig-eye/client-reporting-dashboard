import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.redirect(
    new URL('/access', process.env.NEXT_PUBLIC_APP_URL!)
  )
  // Clear every session cookie so nothing survives on a shared machine.
  for (const name of ['client_token', 'admin_session', 'admin_user_id', 'admin_raw_mode']) {
    response.cookies.set(name, '', { maxAge: 0, path: '/' })
  }
  return response
}
