/**
 * Displaying an image that lives on a CLIENT'S site.
 *
 * Their media sits on their server, and a browser fetching it directly arrives as a foreign
 * origin — which hotlink protection and Cloudflare's bot filtering routinely drop, leaving the
 * picker full of broken thumbnails. `/api/admin/content/image-proxy` fetches it server-side
 * with credentials those filters accept and streams the bytes back from our own origin.
 *
 * Only foreign images are routed through it. Anything we host already loads fine, and sending
 * it through the proxy would cost a round trip AND fail the proxy's host check, so the test
 * below decides rather than the caller guessing.
 */

/** Our own storage. Everything the platform generates or uploads ends up here. */
const SUPABASE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname.toLowerCase()
  } catch {
    return ''
  }
})()

/** True when the browser can already load this without help. */
export function isOwnOriginImage(url: string): boolean {
  // Relative paths, data: and blob: are all already ours.
  if (!/^https?:\/\//i.test(url)) return true
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (SUPABASE_HOST && host === SUPABASE_HOST) return true
    if (typeof window !== 'undefined' && host === window.location.hostname.toLowerCase()) return true
    return false
  } catch {
    // Unparseable: leave it alone rather than wrapping something we do not understand.
    return true
  }
}

/**
 * The src to actually put on an <img>.
 *
 * Returns the URL untouched when there is nothing to gain — no connection to authorise the
 * fetch against, or an image we already serve. Callers should keep the original URL around and
 * fall back to it in onError, so a proxy failure is never worse than not having tried.
 */
export function proxiedImageSrc(url: string | null | undefined, connectionId: string | null | undefined): string {
  if (!url) return ''
  if (!connectionId) return url
  if (isOwnOriginImage(url)) return url
  return '/api/admin/content/image-proxy'
    + '?connection_id=' + encodeURIComponent(connectionId)
    + '&url=' + encodeURIComponent(url)
}
