import { NextResponse } from 'next/server'
import { clearSessionCookies } from '@/lib/clearSession'

export async function POST() {
  // Attributes must mirror how the cookies were set, or the browser drops the deletion
  // inside the cross-origin CRM iframe and the session silently survives.
  return clearSessionCookies(NextResponse.redirect(
    new URL('/access', process.env.NEXT_PUBLIC_APP_URL!)
  ))
}
