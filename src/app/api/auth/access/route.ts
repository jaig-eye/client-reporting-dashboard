import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Validates the dashboard_token from the URL, sets a session cookie,
// then redirects to the dashboard. This is the entry point for all client access.
//
// Accepts either:
//   ?token=<dashboard_token>       — existing UUID token link
//   ?ghl_token=<ghl_location_id>   — GoHighLevel location ID (resolved via client_connections)
export async function GET(request: NextRequest) {
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL!
  const tokenParam  = request.nextUrl.searchParams.get('token')
  const ghlToken    = request.nextUrl.searchParams.get('ghl_token')

  if (!tokenParam && !ghlToken) {
    return NextResponse.redirect(`${appUrl}/access`)
  }

  const db = createAdminClient()
  let dashboardToken: string | null = null

  if (tokenParam) {
    // Direct dashboard_token lookup
    const { data } = await db
      .from('clients')
      .select('dashboard_token')
      .eq('dashboard_token', tokenParam)
      .single()
    dashboardToken = data?.dashboard_token ?? null
  } else if (ghlToken) {
    // Resolve GHL location ID → client → dashboard_token
    // client_connections.external_id is the GHL location ID for ghl-type connectors
    const { data } = await db
      .from('client_connections')
      .select('client_id, clients!inner(dashboard_token), connectors!inner(type)')
      .eq('external_id', ghlToken)
      .eq('connectors.type', 'ghl')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()

    const clientRow = data?.clients as { dashboard_token: string } | null | undefined
    dashboardToken = clientRow?.dashboard_token ?? null
  }

  if (!dashboardToken) {
    return NextResponse.redirect(`${appUrl}/access`)
  }

  // Valid — set HttpOnly session cookie and redirect to dashboard
  const response = NextResponse.redirect(`${appUrl}/dashboard`)
  response.cookies.set('client_token', dashboardToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 60 * 60 * 24 * 365, // 1 year — permanent access
    path: '/',
  })
  return response
}
