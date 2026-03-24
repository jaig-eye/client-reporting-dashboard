// GET /api/auth/meta/start
// Kicks off the Meta (Facebook) Ads OAuth flow using the app credentials
// stored in META_APP_ID env var.

import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

  const params = new URLSearchParams({
    client_id:     process.env.META_APP_ID!,
    redirect_uri:  `${appUrl}/api/auth/meta/callback`,
    scope:         'ads_read,ads_management,business_management',
    response_type: 'code',
  })

  return NextResponse.redirect(
    `https://www.facebook.com/v18.0/dialog/oauth?${params}`
  )
}
