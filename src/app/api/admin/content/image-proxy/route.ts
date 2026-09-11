// GET /api/admin/content/image-proxy?connection_id=<uuid>&url=<absolute image URL>
//
// Streams one image from a CLIENT'S OWN SITE back to the browser.
//
// WHY THIS EXISTS
//
// The picker shows the client's WordPress media library, and those files live on the client's
// server — usually behind Cloudflare. A browser asking for them directly arrives as a foreign
// origin, and on a site with hotlink protection or Bot Fight Mode turned on that request is
// dropped, so the grid rendered as a wall of broken thumbnails.
//
// referrerPolicy="no-referrer" was the first attempt and it did not fix it, which is the
// useful diagnostic: the block is not about the Referer header, it is about who is asking.
// A browser cannot change who it is. A server can — BROWSER_BOT_UA carries the
// "GoLaunchLocal" token clients whitelist in Cloudflare, and a same-site Referer satisfies the
// plain hotlink rules — so the request the browser cannot make, we make on its behalf and hand
// back the bytes.
//
// WHAT KEEPS THIS FROM BEING AN OPEN PROXY
//
// The URL is never taken on trust. The caller must be an authenticated admin, the URL must
// pass the SSRF guard, and its host must match the site_url of the connection named in the
// request. The only thing this route can fetch is an image from the one client site the caller
// already has access to: not an internal address, not another client, nowhere else.
//
// Redirects are followed by hand and re-checked at every hop, because "302 to somewhere else"
// is the ordinary way a host check gets walked around.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { isPublicUrl } from '@/lib/ssrf'
import { createRateLimiter } from '@/lib/rateLimit'
import { BROWSER_BOT_UA } from '@/lib/platformBot'

export const dynamic = 'force-dynamic'

/**
 * Per connection, for the same reason the media search is: the resource being spent is the
 * CLIENT'S bandwidth. A grid is 24 thumbnails and "Load more" adds 24 more, so the budget has
 * to cover a browsing session rather than a single image — 300/min is several minutes of
 * enthusiastic scrolling, and still bounds a component stuck in a re-request loop.
 */
const proxyLimiter = createRateLimiter({ name: 'image-proxy', max: 300, windowMs: 60_000 })

const MAX_BYTES  = 20 * 1024 * 1024
const MAX_HOPS   = 3
const TIMEOUT_MS = 12_000

/**
 * SVG is deliberately absent. It can carry script, and this route serves from OUR origin, so
 * an SVG opened directly would run in our security context. WordPress media is photographs.
 */
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/pjpeg', 'image/png', 'image/gif',
  'image/webp', 'image/avif', 'image/bmp', 'image/tiff', 'image/x-icon',
])

/** www is not a different site. Nothing else is folded — a subdomain IS a different host. */
function canonicalHost(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const connectionId = request.nextUrl.searchParams.get('connection_id')?.trim()
  const target       = request.nextUrl.searchParams.get('url')?.trim()
  if (!connectionId || !target) {
    return NextResponse.json({ error: 'connection_id and url are required' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }
  if (!isPublicUrl(target)) {
    return NextResponse.json({ error: 'Blocked' }, { status: 403 })
  }

  if (!(await proxyLimiter.take(connectionId))) {
    return NextResponse.json({ error: 'Too many image requests for this site.' }, { status: 429 })
  }

  // ── The host check ──────────────────────────────────────────────────────────
  const db = createAdminClient()
  const { data: conn } = await db
    .from('client_connections')
    .select('external_id, connector:connectors(type, config)')
    .eq('id', connectionId)
    .maybeSingle()

  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  type ConnectorShape = { type: string; config: Record<string, unknown> }
  const rawConnector = conn.connector as unknown
  const connector: ConnectorShape | null = Array.isArray(rawConnector)
    ? (rawConnector[0] ?? null)
    : (rawConnector as ConnectorShape | null)

  const siteUrl  = String(connector?.config?.site_url || conn.external_id || '')
  const siteHost = canonicalHost(siteUrl)
  if (!siteHost) {
    return NextResponse.json({ error: 'Connection has no site URL' }, { status: 400 })
  }
  if (canonicalHost(target) !== siteHost) {
    return NextResponse.json({ error: 'URL does not belong to this connection' }, { status: 403 })
  }

  // ── The fetch the browser could not make ────────────────────────────────────
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    let current = target
    let res: Response | null = null

    // Every path out of here stops the upstream transfer. Returning without doing so leaves the
    // client's server streaming a body nobody will read until the socket times out — on their
    // bandwidth, and ours.
    const giveUp = (body: Record<string, string>, status: number) => {
      controller.abort()
      return NextResponse.json(body, { status })
    }


    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      res = await fetch(current, {
        headers: {
          'User-Agent': BROWSER_BOT_UA,
          // Their own site. This is what a plain hotlink rule is looking for.
          Referer: new URL(current).origin + '/',
          Accept:  'image/*,*/*;q=0.8',
        },
        redirect: 'manual',
        signal:   controller.signal,
        cache:    'no-store',
      })

      if (res.status < 300 || res.status >= 400) break

      const location = res.headers.get('location')
      if (!location) break
      const next = new URL(location, current).toString()
      // Every hop re-checked. A redirect that leaves the client's site, or points inward at
      // our own network, is where an origin check normally gets defeated.
      if (!isPublicUrl(next) || canonicalHost(next) !== siteHost) {
        return giveUp({ error: 'Redirect left the connection host' }, 403)
      }
      current = next
      res = null
    }

    if (!res) return giveUp({ error: 'Too many redirects' }, 502)
    if (!res.ok) {
      // Pass the upstream status through so the caller can tell "blocked" (403) from "gone"
      // (404), rather than every failure looking the same.
      return giveUp({ error: 'Upstream responded ' + res.status }, res.status === 404 ? 404 : 502)
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_TYPES.has(contentType)) {
      // A bot filter that "allows" the request usually answers with an HTML challenge page.
      // Serving that as an image would render as a broken picture with no explanation.
      return giveUp({ error: 'Not an image (' + (contentType || 'unknown type') + ')' }, 502)
    }

    // A MISSING Content-Length is unknown, not zero.
    //
    // Number(null) is 0, which sailed through the pre-check — and the only other guard ran after
    // arrayBuffer() had already allocated the whole body. So on a chunked origin the ceiling was
    // really the 12-second timeout, and a grid of full-size originals could allocate hundreds of
    // megabytes per invocation before anything returned 413.
    const rawLength = res.headers.get('content-length')
    const declared  = rawLength === null ? NaN : Number(rawLength)
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return giveUp({ error: 'Image too large' }, 413)
    }

    // Read in chunks so the cap is enforced as the bytes arrive rather than after they are all
    // in memory, and abort the moment it is exceeded.
    const body = res.body
    if (!body) return giveUp({ error: 'Empty response' }, 502)

    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {})
        return giveUp({ error: 'Image too large' }, 413)
      }
      chunks.push(value)
    }

    const buf = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.byteLength }

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type':           contentType,
        'Content-Length':         String(total),
        // private: this is one client's media travelling through our origin, and it must not
        // land in a shared cache where another tenant could be served it.
        'Cache-Control':          'private, max-age=3600',
        'Content-Disposition':    'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Image fetch failed'
    console.error('[content/image-proxy] ' + siteHost + ':', message)
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}
