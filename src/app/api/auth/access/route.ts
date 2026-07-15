import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Validates the dashboard_token from the URL, sets a session cookie,
// then redirects to the dashboard. This is the entry point for all client access.
//
// Accepts either:
//   ?token=<dashboard_token>       — existing UUID token link
//   ?ghl_token=<ghl_location_id>   — GoHighLevel location ID (resolved via client_connections)
export async function GET(request: NextRequest) {
  const appUrl     = process.env.NEXT_PUBLIC_APP_URL!
  const tokenParam = request.nextUrl.searchParams.get('token')
  const ghlToken   = request.nextUrl.searchParams.get('ghl_token')

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
    // Path A: look up by external_id (set on client_connections during sync)
    // Avoids filtering on a joined table which can silently return null in PostgREST.
    const { data } = await db
      .from('client_connections')
      .select('client_id, clients!inner(dashboard_token)')
      .eq('external_id', ghlToken)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()

    dashboardToken = (data?.clients as unknown as { dashboard_token: string } | null)?.dashboard_token ?? null

    // Path B: fallback for connections not yet synced — external_id may not be set yet.
    // Scan active GHL connections and match by config.location_id.
    if (!dashboardToken) {
      const { data: allGhl } = await db
        .from('client_connections')
        .select('clients!inner(dashboard_token), connectors!inner(config)')
        .eq('status', 'active')
        .limit(200)

      const match = (allGhl ?? []).find((row: Record<string, unknown>) => {
        const conn = row.connectors as { config?: { location_id?: string } } | null
        return conn?.config?.location_id === ghlToken
      })
      if (match) {
        dashboardToken = (match.clients as unknown as { dashboard_token: string })?.dashboard_token ?? null
      }
    }
  }

  if (!dashboardToken) {
    return NextResponse.redirect(`${appUrl}/access`)
  }

  // Record the IP against this client for future IP-change detection
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  if (ip) {
    const { data: client } = await db
      .from('clients')
      .select('id, last_known_ip')
      .eq('dashboard_token', dashboardToken)
      .maybeSingle()
    if (client && !client.last_known_ip) {
      void db.from('clients').update({ last_known_ip: ip }).eq('id', client.id)
    }
  }

  // Valid — set HttpOnly session cookie (90 days) and redirect to dashboard
  const response = NextResponse.redirect(`${appUrl}/dashboard`)
  response.cookies.set('client_token', dashboardToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 60 * 60 * 24 * 90,
    path: '/',
  })
  return response
}
