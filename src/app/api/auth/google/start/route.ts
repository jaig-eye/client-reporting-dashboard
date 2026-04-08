// GET /api/auth/google/start
// Kicks off the Google Ads OAuth flow.
// Accepts developer_token and mcc_customer_id as query params, encodes them
// in the OAuth state so the callback can persist them alongside the tokens.

import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const appUrl         = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const developerToken = request.nextUrl.searchParams.get('developer_token') ?? ''
  const mccCustomerId  = request.nextUrl.searchParams.get('mcc_customer_id') ?? ''

  const state = Buffer.from(
    JSON.stringify({ developer_token: developerToken, mcc_customer_id: mccCustomerId })
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
