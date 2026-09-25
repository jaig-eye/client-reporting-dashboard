// GET /api/proxy/meta-image?ad_id=X&client_id=Y
//
// Fetches a fresh Meta CDN image URL for the given ad creative and redirects (302).
// Meta CDN signed URLs expire quickly when stored in the DB — this proxy fetches
// a live URL from the Graph API each time (cached 30 min per ad_id).
//
// Auth:
//   admin_session cookie — any client_id is trusted (admins view all clients)
//   client_token cookie  — client_id is derived from the token; query param is ignored (IDOR fix)
//   no session           — public share context; client_id param is verified against DB

import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

const API_VERSION = 'v21.0'
const BASE_URL    = `https://graph.facebook.com/${API_VERSION}`

// In-memory rate limit: 30 requests per minute per IP (per serverless instance)
const proxyRateLimit = new Map<string, { count: number; resetAt: number }>()
function checkProxyRateLimit(ip: string): boolean {
  const now   = Date.now()
  const entry = proxyRateLimit.get(ip)
  if (!entry || now > entry.resetAt) {
    proxyRateLimit.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (entry.count >= 30) return false
  entry.count++
  return true
}

async function resolveMetaToken(clientId: string): Promise<string | null> {
  const db = createAdminClient()
  const { data } = await db
    .from('client_connections')
    .select('connectors!inner(type, auth)')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .eq('connectors.type', 'meta_ads')
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const auth = ((data.connectors as unknown) as { type: string; auth: Record<string, unknown> } | null)?.auth ?? {}
  return (auth.system_user_token ?? auth.access_token ?? null) as string | null
}

/**
 * Resolve a live Meta CDN URL, caching ONLY a success.
 *
 * This used to return null on failure from inside unstable_cache, which cached the null for the
 * full 30 minutes. When the agency Meta token expired, every ad anyone loaded during the outage
 * had a failure pinned under its key — so re-authorising fixed nothing for another half hour,
 * and each fresh page view during that window re-armed the clock. A broken minute poisoned the
 * library long after it was repaired.
 *
 * Throwing instead keeps the cache clean: Next does not cache a rejected call, so the very next
 * request after the token is fixed asks Meta again.
 */
function getFreshMetaImageUrl(adId: string, clientId: string): Promise<string | null> {
  return unstable_cache(
    async () => {
      const accessToken = await resolveMetaToken(clientId)
      if (!accessToken) throw new Error('no-meta-token')

      const url = new URL(`${BASE_URL}/${adId}`)
      url.searchParams.set('fields', 'creative{image_url,thumbnail_url}')
      url.searchParams.set('thumbnail_width', '1080')
      url.searchParams.set('thumbnail_height', '1080')

      // Use Authorization header — avoids logging the token in server/proxy access logs
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        next: { revalidate: 0 },
      })
      if (!res.ok) throw new Error(`meta-${res.status}`)

      const data = await res.json() as Record<string, unknown>
      const creative = data.creative as Record<string, unknown> | undefined
      // Prefer static image_url; fall back to thumbnail (may be 1080px if Meta honours the size params)
      const fresh = (creative?.image_url ?? creative?.thumbnail_url ?? null) as string | null
      // An ad with genuinely no creative image is still not worth caching as a failure: it is
      // rare, and a wrong "no image" outlives the reason far longer than one extra call costs.
      if (!fresh) throw new Error('no-creative-image')
      return fresh
    },
    [`meta-img-${adId}-${clientId}`],
    { revalidate: 1800 }  // 30 min, successes only
  )().catch(() => null)
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!checkProxyRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const cookieStore  = await cookies()
  const adminSession = cookieStore.get('admin_session')?.value
  const clientToken  = cookieStore.get('client_token')?.value

  const { searchParams } = new URL(request.url)
  const adId          = searchParams.get('ad_id')?.trim()
  const clientIdParam = searchParams.get('client_id')?.trim()

  const db = createAdminClient()
  let clientId: string | null = null

  if (isAdminAuthed(adminSession)) {
    // Admin: trust the client_id param (admins can view any client's images)
    clientId = clientIdParam ?? null
  } else if (clientToken) {
    // Client session: resolve client_id from the cookie — never trust the query param
    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('dashboard_token', clientToken)
      .maybeSingle()
    clientId = client?.id ?? null
    if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  } else {
    // Public share context: no session cookies — verify client_id exists in DB
    if (!clientIdParam) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('id', clientIdParam)
      .maybeSingle()
    if (!client) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    clientId = clientIdParam
  }

  if (!adId || !clientId) {
    return NextResponse.json({ error: 'ad_id and client_id are required' }, { status: 400 })
  }

  const freshUrl = await getFreshMetaImageUrl(adId, clientId)
  if (!freshUrl) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  return NextResponse.redirect(freshUrl, { status: 302 })
}
