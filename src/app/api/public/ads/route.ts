// GET /api/public/ads?token=...
// Public endpoint — validates dashboard_token, returns 30-day aggregated ad data.
// No session cookies required.
//
// Security note: dashboard_token appears in the URL and will be recorded in
// Vercel access logs. For production, configure Vercel WAF rate limiting in
// addition to the per-instance limit below.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase/server'
import { fetchClientAds }            from '@/lib/ads-library'
import type { AdsLibraryResponse }   from '@/lib/ads-library'

export const dynamic = 'force-dynamic'

// Re-export types so external consumers can import from this route if preferred.
export type { MetaAdRow, GoogleAdRow, AdsLibraryResponse } from '@/lib/ads-library'

// ── Per-instance sliding window rate limiter ───────────────────────────────
// 20 requests / 60 seconds per IP. Module-level state is per cold-start
// instance; configure Vercel WAF rules for multi-instance protection.
const rl = new Map<string, { n: number; reset: number }>()
const RL_LIMIT  = 20
const RL_WINDOW = 60_000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  if (rl.size > 500) {
    rl.forEach((v, k) => { if (v.reset < now) rl.delete(k) })
  }
  const e = rl.get(ip)
  if (!e || now > e.reset) { rl.set(ip, { n: 1, reset: now + RL_WINDOW }); return false }
  if (e.n >= RL_LIMIT) return true
  e.n++
  return false
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (checkRateLimit(ip)) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 })
  }

  const token = request.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'token required' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: client, error: clientError } = await db
    .from('clients')
    .select('id, name')
    .eq('dashboard_token', token)
    .maybeSingle()

  if (clientError) {
    console.error('[public/ads] token lookup error:', clientError.message)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
  if (!client) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  const { meta, google, error } = await fetchClientAds(db, client.id)
  if (error) {
    console.error('[public/ads] fetch error:', error)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }

  return NextResponse.json({
    client_name: client.name,
    meta,
    google,
  } satisfies AdsLibraryResponse)
}
