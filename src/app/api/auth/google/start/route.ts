// GET /api/auth/google/start
// Kicks off Google OAuth for any Google connector type.
// Accepts connector_type (google_ads | google_analytics | google_search_console | google_business_profile)
// plus optional developer_token and mcc_customer_id (Google Ads only).
// All params are encoded into the OAuth state so the callback can restore them.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const appUrl        = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const connectorType = request.nextUrl.searchParams.get('connector_type') ?? ''
  const mccCustomerId = request.nextUrl.searchParams.get('mcc_customer_id') ?? ''
  const connectorId   = request.nextUrl.searchParams.get('connector_id') ?? ''

  // Resolve the developer token SERVER-SIDE from the connector row.
  //
  // It used to arrive as a query parameter, which the reconnect link built client-side
  // from connector.auth — so the token was rendered into an href and then travelled in a
  // URL: browser history, Vercel access logs, any referrer. It is still encoded into the
  // OAuth `state` below and therefore reaches Google's logs, but that is a payload we
  // control; a URL the browser navigates to is not.
  //
  // The query parameter is still accepted so links already rendered in an open tab keep
  // working, but nothing generates one any more.
  let developerToken = request.nextUrl.searchParams.get('developer_token') ?? ''
  if (!developerToken && connectorId) {
    try {
      const db = createAdminClient()
      const { data } = await db
        .from('connectors').select('auth').eq('id', connectorId).maybeSingle()
      const auth = (data as { auth?: Record<string, unknown> } | null)?.auth ?? {}
      developerToken = String(auth.developer_token ?? '')
    } catch {
      // Non-fatal: without it Google Ads reconnect proceeds and the callback keeps
      // whatever token is already stored.
    }
  }

  // If connector_type is absent or 'google', use unified mode:
  // the callback will upsert all 4 Google connector types at once.
  // Old per-type links (?connector_type=google_analytics) remain fully backward compatible.
  const isUnified = !connectorType || connectorType === 'google'

  const state = Buffer.from(
    JSON.stringify({
      ...(isUnified
        ? { mode: 'unified' }
        : { connector_type: connectorType }),
      developer_token: developerToken,
      mcc_customer_id: mccCustomerId,
    })
  ).toString('base64url')

  // Request all Google scopes in a single OAuth flow so one token set covers
  // Google Ads, GA4, Search Console, and Business Profile connectors.
  const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/adwords',
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/business.manage',
  ].join(' ')

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  `${appUrl}/api/auth/google/callback`,
    response_type: 'code',
    scope:         GOOGLE_SCOPES,
    access_type:   'offline',
    prompt:        'consent', // always get a refresh_token
    state,
  })

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  )
}
