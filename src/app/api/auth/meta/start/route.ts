// GET /api/auth/meta/start
// Kicks off the Meta (Facebook) Ads OAuth flow using the app credentials
// stored in META_APP_ID env var.

import { NextRequest } from 'next/server'
import { beginOAuth, appUrlFrom } from '@/lib/oauthFlow'

export async function GET(request: NextRequest) {
  const appUrl = appUrlFrom(request)

  // Requires a signed-in admin; the state carries a one-time nonce (and ?popup=1). See oauthFlow.
  return beginOAuth(request, {}, encoded => {
    const params = new URLSearchParams({
      client_id:     process.env.META_APP_ID!,
      redirect_uri:  `${appUrl}/api/auth/meta/callback`,
      scope:         'ads_read,ads_management,business_management',
      response_type: 'code',
      state:         encoded,
    })
    return `https://www.facebook.com/v21.0/dialog/oauth?${params}`
  })
}
