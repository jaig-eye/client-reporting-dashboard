/**
 * Site SEO crawler.
 *
 * Fetches pages with AgencyBot/1.0 and extracts SEO signals via regex.
 * No external HTML-parsing library needed — avoids dependency bloat and
 * keeps the bundle edge-compatible.
 *
 * Cloudflare whitelist rule:
 *   cf.bot_management.verified_bot OR http.user_agent contains "AgencyBot"
 */

export const AGENT_UA = 'AgencyBot/1.0'
const FETCH_TIMEOUT_MS = 10_000
const CONCURRENT       = 5
export const MAX_PAGES = 50

// URL patterns that indicate product-level pages on ecom sites — skip these
// in "key pages" mode so we don't crawl 200k product pages.
const PRODUCT_PATTERNS: RegExp[] = [
  /\/products\/[^/]+\/?$/,
  /\/product\/[^/]+\/?$/,
  /\/collections\/[^/]+\/products\//,
  /\/shop\/[^/]+\/[^/]+\/?$/,
  /\/p\/\d/,
  /\/item\/\d/,
  /\/dp\/[A-Z0-9]{10}/,
  /[?&]product[_-]?id=/i,
]

export function isProductUrl(url: string): boolean {
  return PRODUCT_PATTERNS.some(re => re.test(url))
}

/* ── HTML extraction helpers ─────────────────────────────────────── */

function extractText(html: string, re: RegExp): string | null {
  const m = html.match(re)
  if (!m) return null
  return m[1].replace(/<[^>]*>/g, '').trim() || null
}

function stripTags(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function countWords(bodyHtml: string): number {
  return stripTags(bodyHtml).split(/\s+/).filter(w => w.length > 1).length
}

/* ── Types ───────────────────────────────────────────────────────── */

export interface PageIssue {
  type: string
  sev:  'error' | 'warning' | 'info'
  msg:  string
}

export interface PageResult {
  url:             string
  httpStatus:      number
  title:           string | null
  titleLength:     number
  metaDescription: string | null
  metaLength:      number
  h1Count:         number
  h1Text:          string | null
  wordCount:       number
  imgsTotal:       number
  imgsNoAlt:       number
  hasSchema:       boolean
  hasCanonical:    boolean
  metaRobots:      string
  score:           number
  errors:          number
  warnings:        number
  issues:          PageIssue[]
}

export interface AuditResult {
  pages:    PageResult[]
  score:    number
  errors:   number
  warnings: number
  source:   'crawler'
}

/* ── Fetch one page ──────────────────────────────────────────────── */

async function fetchPage(url: string): Promise<{ status: number; html: string }> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal:  ctrl.signal,
      headers: { 'User-Agent': AGENT_UA, 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    })
    clearTimeout(timer)
    const html = await res.text()
    return { status: res.status, html }
  } catch {
    clearTimeout(timer)
    return { status: 0, html: '' }
  }
}

/* ── Audit one page's HTML ───────────────────────────────────────── */

export function auditHtml(url: string, status: number, html: string): PageResult {
  const issues: PageIssue[] = []
  let errors = 0, warnings = 0

  // ── Meta signals ──
  const title       = extractText(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const titleLength = title?.length ?? 0

  const metaDesc   = html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]
                  ?? html.match(/<meta\s+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1]
                  ?? null
  const metaLength = metaDesc?.length ?? 0

  const metaRobotsRaw = html.match(/<meta\s+name=["']robots["'][^>]*content=["']([^"']*)["']/i)?.[1]
                     ?? html.match(/<meta\s+content=["']([^"']*)["'][^>]*name=["']robots["']/i)?.[1]
                     ?? ''
  const metaRobots = metaRobotsRaw.toLowerCase()

  // ── Headings ──
  const h1Matches = Array.from(html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi))
  const h1Count   = h1Matches.length
  const h1Text    = h1Count > 0 ? stripTags(h1Matches[0][1]).slice(0, 200) || null : null

  // ── Body content ──
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const bodyHtml  = bodyMatch?.[1] ?? html
  const wordCount = countWords(bodyHtml)

  // ── Images ──
  const imgTags  = Array.from(html.matchAll(/<img\b([^>]*)>/gi))
  const imgsTotal  = imgTags.length
  const imgsNoAlt  = imgTags.filter(m => {
    const attrs = m[1]
    // Missing alt, or alt="" (empty alt is OK for decorative but flag it)
    return !/\balt\s*=\s*["'][^"']+["']/i.test(attrs)
  }).length

  // ── Schema & canonical ──
  const hasSchema    = /application\/ld\+json/i.test(html)
  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html)

  // ── Issue detection ──
  if (status === 0) {
    issues.push({ type: 'fetch_error', sev: 'error', msg: 'Page unreachable or timed out' }); errors++
  } else if (status >= 400) {
    issues.push({ type: 'http_error', sev: 'error', msg: `HTTP ${status} response` }); errors++
  }

  if (metaRobots.includes('noindex')) {
    issues.push({ type: 'noindex', sev: 'error', msg: 'Page has noindex — invisible to search engines' }); errors++
  }

  if (h1Count === 0) {
    issues.push({ type: 'missing_h1', sev: 'error', msg: 'No H1 tag found' }); errors++
  } else if (h1Count > 1) {
    issues.push({ type: 'multiple_h1', sev: 'error', msg: `${h1Count} H1 tags — should be exactly one` }); errors++
  }

  if (!title) {
    issues.push({ type: 'missing_title', sev: 'error', msg: 'No <title> tag found' }); errors++
  } else if (titleLength > 60) {
    issues.push({ type: 'title_long', sev: 'warning', msg: `Title is ${titleLength} chars — may truncate in SERPs (60 max)` }); warnings++
  } else if (titleLength < 30) {
    issues.push({ type: 'title_short', sev: 'warning', msg: `Title is only ${titleLength} chars — aim for 50–60` }); warnings++
  }

  if (!metaDesc) {
    issues.push({ type: 'missing_meta', sev: 'warning', msg: 'No meta description' }); warnings++
  } else if (metaLength > 160) {
    issues.push({ type: 'meta_long', sev: 'warning', msg: `Meta description ${metaLength} chars — will truncate (160 max)` }); warnings++
  } else if (metaLength < 70) {
    issues.push({ type: 'meta_short', sev: 'warning', msg: `Meta description only ${metaLength} chars — aim for 150–160` }); warnings++
  }

  if (!hasCanonical) {
    issues.push({ type: 'missing_canonical', sev: 'warning', msg: 'No canonical tag' }); warnings++
  }

  if (imgsNoAlt > 0) {
    issues.push({ type: 'missing_alt', sev: 'warning', msg: `${imgsNoAlt} of ${imgsTotal} image${imgsNoAlt > 1 ? 's' : ''} missing alt text` }); warnings++
  }

  if (!hasSchema) {
    issues.push({ type: 'missing_schema', sev: 'warning', msg: 'No structured data (JSON-LD) found' }); warnings++
  }

  if (wordCount < 300 && status === 200 && !metaRobots.includes('noindex')) {
    issues.push({ type: 'thin_content', sev: 'info', msg: `Only ~${wordCount} words — consider expanding` })
  }

  // ── Score (start at 100, deduct per issue) ──
  let score = 100
  score -= errors   * 15
  score -= warnings *  7
  score = Math.max(0, Math.min(100, score))

  return {
    url, httpStatus: status,
    title, titleLength,
    metaDescription: metaDesc ?? null, metaLength,
    h1Count, h1Text,
    wordCount,
    imgsTotal, imgsNoAlt,
    hasSchema, hasCanonical, metaRobots,
    score, errors, warnings, issues,
  }
}

/* ── Fetch sitemap.xml and extract URLs ──────────────────────────── */

async function fetchSitemapUrls(baseUrl: string): Promise<string[]> {
  const sitemapUrl = `${baseUrl.replace(/\/$/, '')}/sitemap.xml`
  const { html: xml } = await fetchPage(sitemapUrl)
  if (!xml) return []
  const locs = Array.from(xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi))
  return locs.map(m => m[1].trim()).filter(u => u.startsWith('http'))
}

/* ── Batch runner ────────────────────────────────────────────────── */

async function runBatch(urls: string[]): Promise<PageResult[]> {
  const results: PageResult[] = []
  for (let i = 0; i < urls.length; i += CONCURRENT) {
    const chunk = urls.slice(i, i + CONCURRENT)
    const settled = await Promise.allSettled(
      chunk.map(async url => {
        const { status, html } = await fetchPage(url)
        return auditHtml(url, status, html)
      })
    )
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value)
    }
  }
  return results
}

/* ── Main entry point ────────────────────────────────────────────── */

export interface SiteAuditInput {
  baseUrl:   string
  scope:     'key' | 'all'
  /** Pre-resolved key pages from content_sitemap_pages (URLs only). */
  keyPages?: string[]
}

export async function runSiteAudit(input: SiteAuditInput): Promise<AuditResult> {
  const base = input.baseUrl.replace(/\/$/, '')

  let urls: string[]

  if (input.scope === 'key' && input.keyPages && input.keyPages.length > 0) {
    // Use pre-resolved sitemap pages from DB (already filtered is_excluded=false)
    urls = input.keyPages.map(u => u.startsWith('http') ? u : `${base}${u.startsWith('/') ? '' : '/'}${u}`)
  } else {
    // Fall back to fetching /sitemap.xml
    const sitemapUrls = await fetchSitemapUrls(base)
    if (sitemapUrls.length > 0) {
      urls = input.scope === 'key'
        ? sitemapUrls.filter(u => !isProductUrl(u))
        : sitemapUrls
    } else {
      // No sitemap — just crawl the homepage
      urls = [base]
    }
  }

  // Always include homepage; deduplicate; cap
  const deduped = Array.from(new Set([base + '/', ...urls])).slice(0, MAX_PAGES)

  const pages = await runBatch(deduped)

  const totalErrors   = pages.reduce((n, p) => n + p.errors,   0)
  const totalWarnings = pages.reduce((n, p) => n + p.warnings, 0)
  const score = pages.length
    ? Math.round(pages.reduce((n, p) => n + p.score, 0) / pages.length)
    : 0

  return { pages, score, errors: totalErrors, warnings: totalWarnings, source: 'crawler' }
}