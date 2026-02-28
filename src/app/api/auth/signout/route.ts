import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.redirect(
    new URL('/access', process.env.NEXT_PUBLIC_APP_URL!)
  )
  response.cookies.delete('client_token')
  return response
}
