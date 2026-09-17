/**
 * The image a published post is actually showing, read off the live page.
 *
 * Some posts have their image attached inside WordPress after we publish, so our own record holds
 * none while the page itself has one. Showing the client a gap that isn't there would misreport
 * the work, so for a post that is live and has no image on file we read the page's own og:image.
 *
 * Deliberately narrow:
 *   · only pages we published ourselves, by their stored URL
 *   · http and https only, and never a host that resolves inside our own network
 *   · a handful of pages per render, each with a short deadline and a capped read
 *   · a miss is a miss — the caller falls back to a post with no image, which is a fine post
 *
 * Cached for a day: a featured image does not change hourly, and this is the only place in the
 * dashboard that reaches out to a client's own site while a page is rendering.
 */

import { unstable_cache } from 'next/cache'
import { BROWSER_BOT_UA } from '../platformBot'

/** Enough of the document to carry the head. Nothing useful lives past this. */
const MAX_BYTES   = 120_000
const TIMEOUT_MS  = 4_000
/** A client-facing page shows a handful of posts; anything past this is not worth the wait. */
const MAX_LOOKUPS = 6

/**
 * Hosts that could reach something on our own side of the network. A published_url is written by
 * our own publish flow, so this should never fire — it is here so that a bad row in the table can
 * never turn a dashboard render into a request against internal infrastructure.
 */
const PRIVATE_HOST = /^(localhost|\[?::1\]?|0\.0\.0\.0|169\.254\.|10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (PRIVATE_HOST.test(u.hostname)) return null
    if (!u.hostname.includes('.')) return null
    return u
  } catch {
    return null
  }
}

/** og:image, then twitter:image, then the first link rel="image_src". First one wins. */
function readImageMeta(html: string, pageUrl: URL): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url|:url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ]
  for (const re of patterns) {
    const found = html.match(re)?.[1]
    if (!found) continue
    const resolved = safeUrl(new URL(found, pageUrl).toString())
    if (resolved) return resolved.toString()
  }
  return null
}

/** One page, best-effort. Never throws. */
async function imageFromPage(raw: string): Promise<string | null> {
  const url = safeUrl(raw)
  if (!url) return null
  try {
    const res = await fetch(url.toString(), {
      // Our own UA, so a client's Cloudflare skip rule still matches and we don't get hotlink-blocked.
      headers: { 'User-Agent': BROWSER_BOT_UA, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok || !res.body) return null
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return null

    // Read the head and stop. A long post is mostly body, and we only need the meta tags.
    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let html = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      if (html.length >= MAX_BYTES || html.includes('</head>')) { await reader.cancel(); break }
    }
    return readImageMeta(html, url)
  } catch {
    return null
  }
}

const _cachedImages = unstable_cache(
  async (urls: string[]): Promise<Record<string, string>> => {
    const found: Record<string, string> = {}
    const results = await Promise.all(urls.slice(0, MAX_LOOKUPS).map(imageFromPage))
    urls.slice(0, MAX_LOOKUPS).forEach((u, i) => {
      const img = results[i]
      if (img) found[u] = img
    })
    return found
  },
  ['live-page-image-v1'],
  { revalidate: 86_400, tags: ['client-metrics'] },
)

/**
 * Images for the given live post URLs, keyed by the URL asked for. A URL that is unreachable,
 * blocked, or simply has no image is absent from the result rather than present and empty.
 */
export async function fetchLivePageImages(urls: string[]): Promise<Record<string, string>> {
  const wanted = Array.from(new Set(urls.filter(Boolean))).sort().slice(0, MAX_LOOKUPS)
  if (wanted.length === 0) return {}
  try {
    return await _cachedImages(wanted)
  } catch {
    return {}
  }
}
