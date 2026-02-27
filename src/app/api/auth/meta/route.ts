import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('clientId') || ''
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/meta/callback`,
    scope: 'ads_read,ads_management,business_management',
    response_type: 'code',
    state: clientId,
  })
  return NextResponse.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params}`)
}
