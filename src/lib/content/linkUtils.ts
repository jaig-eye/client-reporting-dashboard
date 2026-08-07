// Shared link-sanitization utilities for AI-generated blog content.

// Strips any internal <a href> that is NOT in the provided allowedUrls set.
// Absolute external links (different hostname) and mailto/tel/# are left untouched.
// Absolute internal links (same hostname as the site) ARE validated — the AI generates
// absolute URLs as prompted, so bypassing https:// would make this function a no-op.
//
// Also catches path-extension hallucinations: if the AI takes an allowed URL like
// /step-bars-running-boards/ and links to /services/step-bars-running-boards/ (i.e. prepends
// a path segment), isHallucinatedExtension() detects the suffix match and strips the link.

function norm(u: string): string {
  return u.replace(/\/+$/, '').toLowerCase()
}

function isHallucinatedExtension(href: string, allowedUrls: Set<string>): boolean {
  let u: URL; try { u = new URL(href) } catch { return false }
  const normPath = norm(u.pathname)
  return Array.from(allowedUrls).some(allowed => {
    let a: URL; try { a = new URL(allowed) } catch { return false }
    if (a.hostname.toLowerCase() !== u.hostname.toLowerCase()) return false
    const normAllowed = norm(a.pathname)
    if (normAllowed === '/' || normAllowed === '') return false
    // Strip if the hallucinated path ends with an allowed path (prepend-segment attack)
    return normPath.endsWith(normAllowed) && normPath !== normAllowed
  })
}

export function stripHallucinatedLinks(html: string, allowedUrls: Set<string>): string {
  if (allowedUrls.size === 0) return html
  const normalised = new Set(Array.from(allowedUrls).map(norm))
  // Derive known internal hostnames from the allowed set so we can distinguish
  // absolute internal links from genuine external links.
  const internalHosts = new Set<string>()
  Array.from(normalised).forEach(u => {
    try { internalHosts.add(new URL(u).hostname.toLowerCase()) } catch { /* relative URL — skip */ }
  })
  return html.replace(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs: string, text: string) => {
    const m = attrs.match(/href\s*=\s*["']([^"']*)["']/i)
    if (!m) return match
    const href = m[1].trim()
    if (/^(mailto:|tel:|#)/.test(href)) return match        // safe: not a page link
    if (/^https?:/.test(href)) {
      try {
        const parsed   = new URL(href)
        const hostname = parsed.hostname.toLowerCase()
        // When no internal hosts are known we can't tell internal from external — leave all absolute URLs alone
        if (internalHosts.size === 0) return match
        // External hostname — strip link, keep anchor text (can't verify external URLs at generation time)
        if (!internalHosts.has(hostname)) {
          console.warn('[generate] stripped external link:', href)
          return text
        }
        // Exact match first (normalised trailing slash)
        if (normalised.has(norm(href))) return match
        if (normalised.has(norm(parsed.pathname))) return match
        // Path-extension hallucination: AI prepended/inserted a path segment
        if (isHallucinatedExtension(href, allowedUrls)) {
          console.warn('[generate] stripped path-extension hallucination:', href)
          return text
        }
        console.warn('[generate] stripped hallucinated internal link:', href)
        return text
      } catch { return match }
    }
    // Relative URL — validate against allowed set
    if (normalised.has(norm(href))) return match
    console.warn('[generate] stripped hallucinated internal link:', href)
    return text
  })
}
