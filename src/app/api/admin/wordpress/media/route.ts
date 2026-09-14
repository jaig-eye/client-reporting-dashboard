// GET /api/admin/wordpress/media?connection_id=<uuid>&q=<search>&page=<n>
//
// Searches the CLIENT'S OWN WordPress media library, so a reviewer can reuse a photograph
// the client already has instead of borrowing a stranger's from a stock library.
//
// This is the best image source available and it was the one we did not offer: the client's
// media is already licensed, already on their site, already on-brand, and often shows the
// actual premises, vehicles and staff the article is about. A stock photo of *a* workshop is
// always second best to a photo of *their* workshop.
//
// Results are shaped as StockImageCandidate so they merge into the picker the free libraries
// already feed, rather than living in a parallel UI with its own selection rules.
//
// TWO THINGS THIS ROUTE IS CAREFUL ABOUT
//
//   1. It talks to SOMEONE ELSE'S SERVER. A client on shared hosting with 4,000 attachments
//      is not obliged to be fast, and every request here is a request they pay for. Search
//      and the image-only filter are pushed upstream so one page comes back rather than a
//      library; the connector applies a hard timeout; and the limiter below bounds how often
//      an open picker can hit them.
//   2. It is READ-ONLY and returns no credentials. isAdminAuthed is the right gate —
//      requireWriteAdmin would be wrong, since listing media changes nothing on the site.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { createRateLimiter } from '@/lib/rateLimit'
import { searchMedia, WpBlockedError, type WpMediaItem } from '@/lib/connectors/wordpress'
import type { StockImageCandidate } from '@/lib/content/stockImages'

export const dynamic = 'force-dynamic'

/**
 * Per CONNECTION, not per admin and not per IP.
 *
 * The resource being protected is the client's web server, so the budget belongs to the site
 * being hit. Keying on the admin would let two people hammer one small site; keying on IP
 * would make one office share a budget across every client they manage.
 *
 * 40/minute is generous for a human typing in a search box — the UI debounces — while still
 * bounding a stuck component that re-requests in a loop.
 */
const mediaLimiter = createRateLimiter({ name: 'wp-media', max: 40, windowMs: 60_000 })

/** Media items are not scored: the reviewer asked for these by name. */
const OWNED_RELEVANCE = 1

function toCandidate(m: WpMediaItem, siteHost: string, query: string): StockImageCandidate {
  return {
    id:        `wp-${m.id}`,
    source:    'wp_media',
    title:     m.title || m.alt || 'Untitled',
    url:       m.url,
    thumbnail: m.thumbnail || m.url,
    creator:   null,
    // Not a licence in the stock sense — it is the client's own file. Said plainly, because
    // the picker shows this string and "CC BY-SA 4.0" next to it would be misleading.
    license:    'Client media library',
    licenseUrl: null,
    sourceUrl:  m.url,
    provider:   siteHost,
    width:      m.width,
    height:     m.height,
    attribution: null,
    relevance:   OWNED_RELEVANCE,
    matchedQuery: query,
  }
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const connectionId = request.nextUrl.searchParams.get('connection_id')
  if (!connectionId) {
    return NextResponse.json({ error: 'Missing connection_id' }, { status: 400 })
  }

  const query = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 120)
  const rawPage = Number(request.nextUrl.searchParams.get('page'))
  const page = Number.isFinite(rawPage) ? Math.min(200, Math.max(1, Math.trunc(rawPage))) : 1

  if (!(await mediaLimiter.take(connectionId))) {
    return NextResponse.json(
      { error: 'Too many media requests for this site. Wait a moment and try again.' },
      { status: 429 },
    )
  }

  const db = createAdminClient()
  const { data: conn } = await db
    .from('client_connections')
    .select('external_id, connector:connectors(type, auth, config)')
    .eq('id', connectionId)
    .maybeSingle()

  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  type ConnectorShape = { type: string; auth: Record<string, unknown>; config: Record<string, unknown> }
  const rawConnector = conn.connector as unknown
  const connector: ConnectorShape | null = Array.isArray(rawConnector)
    ? (rawConnector[0] ?? null)
    : (rawConnector as ConnectorShape | null)

  if (!connector) return NextResponse.json({ error: 'Connector not found' }, { status: 404 })
  if (connector.type !== 'wordpress') {
    // BigCommerce has no equivalent library endpoint; say so rather than failing obscurely.
    return NextResponse.json(
      { items: [], total: 0, totalPages: 0, unsupported: true, reason: 'Media search is only available for WordPress sites.' },
    )
  }

  const siteUrl     = String(connector.config?.site_url     || conn.external_id || '')
  const username    = String(connector.config?.username     || connector.auth?.username     || '')
  const appPassword = String(connector.config?.app_password || connector.auth?.app_password || '')

  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: 'WordPress credentials incomplete' }, { status: 400 })
  }

  let siteHost = siteUrl
  try { siteHost = new URL(siteUrl).hostname } catch { /* keep the raw value */ }

  try {
    const { items, total, totalPages } = await searchMedia(
      siteUrl,
      { username, app_password: appPassword },
      { search: query || undefined, page, perPage: 24 },
    )
    return NextResponse.json({
      items: items.map(m => toCandidate(m, siteHost, query)),
      total,
      totalPages,
      page,
    })
  } catch (e) {
    // The client's site failing is not our 500. Report it as a reachability problem with the
    // reason attached, so the picker can say "couldn't reach their site" rather than
    // rendering an empty strip that looks like "they have no images".
    const message = e instanceof Error ? e.message : 'WordPress media request failed'
    console.error(`[wordpress/media] ${siteHost}:`, message)
    // A blocked request DID reach the site — it was turned away. Its message already names the
    // site and the fix, so don't bury it under "Could not reach".
    const blocked = e instanceof WpBlockedError
    return NextResponse.json(
      { error: blocked ? message : `Could not reach ${siteHost}. ${message.slice(0, 200)}` },
      { status: 502 },
    )
  }
}
