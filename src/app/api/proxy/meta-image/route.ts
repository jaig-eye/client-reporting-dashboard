// GET /api/proxy/meta-image?ad_id=X&client_id=Y
//
// Fetches a fresh Meta CDN image URL for the given ad creative and redirects (302).
// Meta CDN signed URLs expire quickly when stored in the DB — this proxy fetches
// a live URL from the Graph API each time (cached 30 min per ad_id).
//
// Auth: requires either admin_session or client_token cookie.

import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

const API_VERSION = 'v21.0'
const BASE_URL    = `https://graph.facebook.com/${API_VERSION}`

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

function getFreshMetaImageUrl(adId: string, clientId: string) {
  return unstable_cache(
    async () => {
      const accessToken = await resolveMetaToken(clientId)
      if (!accessToken) return null

      const url = new URL(`${BASE_URL}/${adId}`)
      // Request high-res image; thumbnail_width/height upgrades low-res fallback thumbnails
      url.searchParams.set('fields', 'creative{image_url,thumbnail_url,thumbnail_width,thumbnail_height}')
      url.searchParams.set('thumbnail_width',  '1080')
      url.searchParams.set('thumbnail_height', '1080')
      url.searchParams.set('access_token', accessToken)

      const res = await fetch(url.toString(), { next: { revalidate: 0 } })
      if (!res.ok) return null

      const data = await res.json() as Record<string, unknown>
      const creative = data.creative as Record<string, unknown> | undefined
      // Prefer high-res image_url; fall back to (now enlarged) thumbnail_url
      return (creative?.image_url ?? creative?.thumbnail_url ?? null) as string | null
    },
    [`meta-img-${adId}-${clientId}`],
    { revalidate: 1800 }  // 30 min
  )()
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const adminSession  = cookieStore.get('admin_session')?.value
  const clientToken   = cookieStore.get('client_token')?.value

  if (!isAdminAuthed(adminSession) && !clientToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const adId     = searchParams.get('ad_id')?.trim()
  const clientId = searchParams.get('client_id')?.trim()

  if (!adId || !clientId) {
    return NextResponse.json({ error: 'ad_id and client_id are required' }, { status: 400 })
  }

  const freshUrl = await getFreshMetaImageUrl(adId, clientId)
  if (!freshUrl) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  return NextResponse.redirect(freshUrl, { status: 302 })
}
