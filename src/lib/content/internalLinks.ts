// How many of an article's links point back into the client's own site.
//
// Shared so every writing path records the same number. full-regenerate kept its own counter,
// which treated any href containing "http" as external — and the pipeline writes internal links as
// absolute URLs read from the client's sitemap, so a regenerated post always recorded zero.
//
// Pure function, no I/O.

/**
 * How many of the article's links point back into the client's own site.
 *
 * `allowed` is the set the pipeline was permitted to link to — the sitemap, manual links, silo
 * pages — which is the same set stripHallucinatedLinks validates against. Anything in it is by
 * definition internal, whatever shape the URL takes.
 *
 * Counting anchors that contain neither http:// nor https:// assumes internal links are relative.
 * They are not: the pipeline injects absolute URLs read from the client's own sitemap, so every
 * genuine internal link was counted as external and every post recorded zero.
 */
export function computeInternalLinks(html: string, allowed?: Iterable<string>): number {
  const hrefs = Array.from(html.matchAll(/<a [^>]*href=["']([^"']+)["']/gi)).map(m => m[1])
  if (!hrefs.length) return 0

  // Compare on host + path so a trailing slash or a http/https difference does not hide a match.
  const key = (u: string) => u.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  const allowedKeys = new Set(Array.from(allowed ?? []).map(key))
  const ownHosts = new Set(Array.from(allowedKeys).map(k => k.split('/')[0]).filter(Boolean))

  return hrefs.filter(h => {
    const raw = h.trim()
    if (!raw || raw.startsWith('#') || /^(mailto|tel):/i.test(raw)) return false
    // A relative path can only be our own site.
    if (!/^https?:\/\//i.test(raw)) return true
    const k = key(raw)
    return allowedKeys.has(k) || ownHosts.has(k.split('/')[0])
  }).length
}
