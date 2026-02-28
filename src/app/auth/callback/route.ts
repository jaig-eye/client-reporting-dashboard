import { NextResponse } from 'next/server'

// Supabase Auth callback removed — using token-based access instead
export async function GET() {
  return NextResponse.redirect(
    new URL('/access', process.env.NEXT_PUBLIC_APP_URL!)
  )
}
