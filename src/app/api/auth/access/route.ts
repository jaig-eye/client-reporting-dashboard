import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Validates the dashboard_token from the URL, sets a session cookie,
// then redirects to the dashboard. This is the entry point for all client access.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  if (!token) {
    return NextResponse.redirect(`${appUrl}/access`)
  }

  const db = createAdminClient()
  const { data: client } = await db
    .from('clients')
    .select('id, name')
    .eq('dashboard_token', token)
    .single()

  if (!client) {
    return NextResponse.redirect(`${appUrl}/access`)
  }

  // Valid token — set HttpOnly session cookie and redirect to dashboard
  const response = NextResponse.redirect(`${appUrl}/dashboard`)
  response.cookies.set('client_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year — permanent access
    path: '/',
  })
  return response
}
