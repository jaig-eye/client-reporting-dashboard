// ─────────────────────────────────────────────────────────────────────────────
// WordPress Connector
//
// Implements ConnectorAdapter for WordPress REST API.
// Primary purpose: content publishing via WP REST API using Application Passwords.
//
// Auth object shape:
//   { username: string, app_password: string }
//
// Config object shape:
//   { site_url: string }
//
// External ID: the WordPress site URL (e.g. 'https://example.com')
//
// This connector is primarily a write connector (publishing posts).
// The fetchMetrics method returns basic site stats for connectivity validation.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'
import { BROWSER_BOT_UA } from '@/lib/platformBot'

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

function wpApiUrl(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/+$/, '')
  return `${base}/wp-json/wp/v2${path}`
}

function authHeader(username: string, appPassword: string): string {
  const encoded = Buffer.from(`${username}:${appPassword}`).toString('base64')
  return `Basic ${encoded}`
}

/**
 * A client site that accepts the connection and never answers would otherwise
 * hold a serverless invocation open until the platform kills it — which on the
 * permalink backfill (a serial loop under maxDuration=300) means one dead site
 * consumes the whole budget and every remaining post is silently skipped.
 */
const WP_TIMEOUT_MS = 15_000

/**
 * Every outbound WordPress call goes through these headers.
 *
 * BROWSER_BOT_UA matters: sites behind Cloudflare or Wordfence are allow-listed
 * on it, and the four lifecycle functions below originally hand-rolled their
 * fetch without it — so update/delete/unpublish 403'd on exactly the sites where
 * publishing worked.
 */
function wpHeaders(
  auth: { username: string; app_password: string },
  json = false,
): Record<string, string> {
  return {
    Authorization: authHeader(auth.username, auth.app_password),
    'User-Agent':  BROWSER_BOT_UA,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

async function wpGet(
  siteUrl: string,
  path: string,
  auth: { username: string; app_password: string },
  params: Record<string, string> = {}
): Promise<unknown> {
  const url = new URL(wpApiUrl(siteUrl, path))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), {
    headers: {
      Authorization:  authHeader(auth.username, auth.app_password),
      'Content-Type': 'application/json',
      'User-Agent':   BROWSER_BOT_UA,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WordPress API error ${res.status}: ${text}`)
  }
  return res.json()
}

async function wpPost(
  siteUrl: string,
  path: string,
  auth: { username: string; app_password: string },
  body: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(wpApiUrl(siteUrl, path), {
    method: 'POST',
    headers: {
      Authorization:  authHeader(auth.username, auth.app_password),
      'Content-Type': 'application/json',
      'User-Agent':   BROWSER_BOT_UA,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WordPress API error ${res.status}: ${text}`)
  }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// Content publishing
// ─────────────────────────────────────────────────────────────────────────────

export interface WpPostPayload {
  title: string
  content: string
  status?: 'publish' | 'draft' | 'pending' | 'future'
  date?: string
  categories?: number[]
  tags?: number[]
  featured_media?: number
  excerpt?: string
  slug?: string
  author?: number
  meta?: Record<string, string>
}

/**
 * Reads back the SEO meta WordPress stored, and says which keys did not stick.
 *
 * WordPress accepts a `meta` object and silently ignores any key not registered with
 * `show_in_rest`, answering 200 either way — so a push can look completely successful and set
 * nothing. This asks the question directly: fetch the post as the editor sees it and compare.
 *
 * A key that does not stick is repaired over XML-RPC — see lib/connectors/wordpressXmlrpc.ts.
 * Rank Math never registers these keys with `show_in_rest` and its own REST namespace is
 * read-only, so REST will always discard them; wp.editPost writes the meta directly instead.
 *
 * Best-effort by design. A site that refuses `context=edit`, a plugin that hides the field, or
 * any network failure returns an empty list rather than failing a publish that already worked.
 */
export async function verifyPostMeta(
  siteUrl: string,
  auth: { username: string; app_password: string },
  postId: number,
  expected: Record<string, string>,
  // Service-area pages carry the same Rank Math fields and live on a different REST route.
  postType: 'posts' | 'pages' = 'posts',
): Promise<{ key: string; sent: string; stored: string }[]> {
  try {
    const res = await fetch(wpApiUrl(siteUrl, `/${postType}/${postId}?context=edit`), {
      headers: { Authorization: authHeader(auth.username, auth.app_password) },
    })
    if (!res.ok) return []
    const data  = await res.json() as { meta?: Record<string, unknown> }
    const meta  = data.meta
    // No meta object at all means the site doesn't expose it — that is not evidence of a problem.
    if (!meta || typeof meta !== 'object') return []
    const wrong: { key: string; sent: string; stored: string }[] = []
    // WordPress sanitizes on the way in — sanitize_text_field collapses whitespace — so a title
    // with a double space comes back legitimately different. Comparing raw would report that as
    // "not stored", and a report that cries wolf is worse than no report.
    const comparable = (v: string) => v.replace(/\s+/g, ' ').trim()
    for (const [key, sent] of Object.entries(expected)) {
      // A key we deliberately sent empty is not expected to come back.
      if (!sent) continue
      // A key absent from the response was never registered; a key present but different was
      // registered and then overwritten. Both are worth seeing, and the value says which.
      const stored = meta[key] == null ? '' : String(meta[key])
      if (comparable(stored) !== comparable(sent)) wrong.push({ key, sent, stored })
    }
    return wrong
  } catch {
    return []
  }
}

export interface WpPublishedPost {
  id: number
  link: string
  title: string
  status: string
  date: string
}

/**
 * Publish a post to a WordPress site.
 * Returns the published/draft post with its URL.
 */
export async function publishPost(
  siteUrl: string,
  auth: { username: string; app_password: string },
  post: WpPostPayload
): Promise<WpPublishedPost> {
  const result = (await wpPost(siteUrl, '/posts', auth, {
    title: post.title,
    content: post.content,
    status: post.status ?? 'draft',
    ...(post.date ? { date: post.date } : {}),
    categories: post.categories,
    tags: post.tags,
    featured_media: post.featured_media,
    excerpt: post.excerpt,
    slug: post.slug,
    author: post.author,
    meta: post.meta,
  })) as Record<string, unknown>

  return {
    id: Number(result.id),
    link: String(result.link || ''),
    title: String((result.title as Record<string, unknown>)?.rendered || post.title),
    status: String(result.status),
    date: String(result.date),
  }
}

export interface WpPagePayload {
  title:    string
  content:  string
  status?:  'publish' | 'draft' | 'pending' | 'future'
  date?:    string
  slug?:    string
  parent?:  number
  excerpt?: string
  meta?:    Record<string, string>
}

/**
 * Publish a page (not a post) to a WordPress site.
 * Returns the created/updated page.
 */
export async function publishPage(
  siteUrl: string,
  auth: { username: string; app_password: string },
  page: WpPagePayload
): Promise<WpPublishedPost> {
  const result = (await wpPost(siteUrl, '/pages', auth, {
    title:   page.title,
    content: page.content,
    status:  page.status ?? 'draft',
    ...(page.date    ? { date:    page.date    } : {}),
    ...(page.slug    ? { slug:    page.slug    } : {}),
    ...(page.parent  ? { parent:  page.parent  } : {}),
    ...(page.excerpt ? { excerpt: page.excerpt } : {}),
    ...(page.meta    ? { meta:    page.meta    } : {}),
  })) as Record<string, unknown>

  return {
    id:     Number(result.id),
    link:   String(result.link   || ''),
    title:  String((result.title as Record<string, unknown>)?.rendered || page.title),
    status: String(result.status || ''),
    date:   String(result.date   || ''),
  }
}

/**
 * Update an existing WP page by ID (for nearby-link injection).
 */
export async function updatePage(
  siteUrl: string,
  auth: { username: string; app_password: string },
  pageId: number,
  patch: {
    content?: string
    title?:   string
    slug?:    string
    status?:  string
    meta?:    Record<string, string>
  }
): Promise<WpPublishedPost> {
  const res = await fetch(wpApiUrl(siteUrl, `/pages/${pageId}`), {
    method: 'POST',
    headers: {
      Authorization: authHeader(auth.username, auth.app_password),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WordPress API error ${res.status}: ${text}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  return {
    id:     Number(data.id),
    link:   String(data.link || ''),
    title:  String((data.title as Record<string, unknown> | undefined)?.rendered ?? ''),
    status: String(data.status || ''),
    date:   String(data.date || ''),
  }
}

/**
 * Overwrite an existing WordPress POST (not page).
 *
 * The counterpart to publishPost, used when a post that is already live gets
 * regenerated: it keeps its wp_post_id, so the live copy is replaced in place
 * and every existing link to it still resolves.
 */
export async function updatePost(
  siteUrl: string,
  auth: { username: string; app_password: string },
  postId: number,
  patch: {
    title?:          string
    content?:        string
    excerpt?:        string
    slug?:           string
    status?:         string
    categories?:     number[]
    tags?:           number[]
    featured_media?: number
    meta?:           Record<string, string>
  },
): Promise<WpPublishedPost> {
  const res = await fetch(wpApiUrl(siteUrl, `/posts/${postId}`), {
    method:  'POST',
    headers: wpHeaders(auth, true),
    body:    JSON.stringify(patch),
    signal:  AbortSignal.timeout(WP_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WordPress API error ${res.status}: ${text}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  return {
    id:     Number(data.id),
    link:   String(data.link || ''),
    title:  String((data.title as Record<string, unknown> | undefined)?.rendered ?? ''),
    status: String(data.status || ''),
    date:   String(data.date || ''),
  }
}

/** Read one post — used by the published_url backfill. */
export async function fetchPost(
  siteUrl: string,
  auth: { username: string; app_password: string },
  postId: number,
): Promise<{ id: number; link: string; status: string } | null> {
  const res = await fetch(wpApiUrl(siteUrl, `/posts/${postId}?context=edit`), {
    headers: wpHeaders(auth),
    signal:  AbortSignal.timeout(WP_TIMEOUT_MS),
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WordPress API error ${res.status}: ${text}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  return { id: Number(data.id), link: String(data.link || ''), status: String(data.status || '') }
}

/**
 * Create a new category in WordPress and return its ID.
 * Returns null if the category already exists (409) — callers should retry getCategories() in that case.
 */
export async function createCategory(
  siteUrl: string,
  auth: { username: string; app_password: string },
  name: string
): Promise<{ id: number; name: string; slug: string } | null> {
  try {
    const result = (await wpPost(siteUrl, '/categories', auth, { name })) as Record<string, unknown>
    return {
      id:   Number(result.id),
      name: String(result.name || name),
      slug: String(result.slug || ''),
    }
  } catch (err) {
    // 409 = term already exists — non-fatal; caller falls back to existing match
    if (err instanceof Error && err.message.includes('409')) return null
    throw err
  }
}

/**
 * Get existing categories from the WordPress site.
 */
export async function getCategories(
  siteUrl: string,
  auth: { username: string; app_password: string }
): Promise<{ id: number; name: string; slug: string }[]> {
  const result = (await wpGet(siteUrl, '/categories', auth, { per_page: '100' })) as Record<string, unknown>[]
  return result.map(c => ({
    id: Number(c.id),
    name: String((c.name as Record<string, unknown>)?.rendered || c.name || ''),
    slug: String(c.slug || ''),
  }))
}

export async function getAuthors(
  siteUrl: string,
  auth: { username: string; app_password: string }
): Promise<{ id: number; name: string }[]> {
  try {
    const result = (await wpGet(siteUrl, '/users', auth, { per_page: '50', who: 'authors' })) as Record<string, unknown>[]
    return result.map(u => ({
      id:   Number(u.id),
      name: String(u.name || ''),
    }))
  } catch {
    return []
  }
}

/**
 * Get existing tags from the WordPress site.
 */
export async function getTags(
  siteUrl: string,
  auth: { username: string; app_password: string }
): Promise<{ id: number; name: string; slug: string }[]> {
  try {
    const result = (await wpGet(siteUrl, '/tags', auth, { per_page: '100' })) as Record<string, unknown>[]
    return result.map(t => ({
      id:   Number(t.id),
      name: String(t.name || ''),
      slug: String(t.slug || ''),
    }))
  } catch {
    return []
  }
}

/**
 * Resolve tag names to WordPress tag IDs.
 * Searches for existing tags by name; creates any that don't exist yet.
 * Returns an array of tag IDs.
 */
export async function ensureTagIds(
  siteUrl: string,
  auth: { username: string; app_password: string },
  tagNames: string[]
): Promise<number[]> {
  if (tagNames.length === 0) return []

  const existing = await getTags(siteUrl, auth)
  const byName = new Map(existing.map(t => [t.name.toLowerCase(), t.id]))

  const ids: number[] = []
  for (const name of tagNames) {
    const key = name.toLowerCase().trim()
    if (!key) continue
    if (byName.has(key)) {
      ids.push(byName.get(key)!)
    } else {
      try {
        const created = (await wpPost(siteUrl, '/tags', auth, { name })) as Record<string, unknown>
        if (created.id) ids.push(Number(created.id))
      } catch {
        // skip tags that fail to create (e.g. duplicate slug conflict)
      }
    }
  }
  return ids
}

/**
 * Download an image from a URL and upload it to the WordPress Media Library.
 * Returns the WP media item ID, which can be used as `featured_media` in publishPost.
 */
/**
 * Upload an image into the client's media library and return its attachment id.
 *
 * ONLY for images we are introducing. An image the reviewer picked out of the client's own
 * library is referenced by id and never comes through here — renaming or re-describing a file
 * they already organised is not ours to do.
 *
 * Everything WordPress will use for SEO is set at upload, because it is the only moment we
 * have: alt text is what screen readers and image search read, the title is what the media
 * library shows, and the FILENAME becomes part of the attachment URL and cannot be changed
 * afterwards without breaking it. "featured.jpg" for every image on a site was a wasted
 * signal repeated on every post.
 */
export async function uploadMediaToWordPress(
  siteUrl: string,
  auth: { username: string; app_password: string },
  imageUrl: string,
  meta?: {
    /** What the image shows, in words, ideally carrying the target keyword. */
    altText?: string
    /** Shown in the media library and used by some themes as a caption. */
    title?: string
    /** Becomes part of the attachment URL. Slug-shaped; extension is added here. */
    filenameBase?: string
  },
): Promise<number> {
  const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': BROWSER_BOT_UA } })
  if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`)
  const buffer  = Buffer.from(await imgRes.arrayBuffer())
  const mime    = imgRes.headers.get('content-type') ?? 'image/jpeg'
  const ext     = mime.split('/')[1]?.replace(/;.*$/, '') ?? 'jpg'

  // Slug-safe, length-capped, and never empty — a bad filename is permanent in the URL.
  // The trailing-dash strip runs AFTER the length cap, because cutting at 60 characters can
  // land mid-separator and reintroduce the dash the earlier strip removed.
  const base = (meta?.filenameBase || 'featured')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'featured'

  const formData = new FormData()
  formData.append('file', new Blob([buffer], { type: mime }), `${base}.${ext}`)
  if (meta?.altText) formData.append('alt_text', meta.altText)
  if (meta?.title)   formData.append('title', meta.title)

  const res = await fetch(`${siteUrl.replace(/\/+$/, '')}/wp-json/wp/v2/media`, {
    method:  'POST',
    headers: { Authorization: authHeader(auth.username, auth.app_password), 'User-Agent': BROWSER_BOT_UA },
    body:    formData,
  })
  if (!res.ok) throw new Error(`WP media upload failed: ${await res.text()}`)
  const data = (await res.json()) as Record<string, unknown>
  return Number(data.id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector adapter (minimal — WP is primarily a write connector)
// ─────────────────────────────────────────────────────────────────────────────

export const wordpressConnector: ConnectorAdapter = {
  type: 'wordpress',

  async fetchMetrics(
    _externalId: string,
    _auth: Record<string, unknown>,
    _config: Record<string, unknown>,
    _dateFrom: string,
    _dateTo: string
  ): Promise<SyncResult> {
    // WordPress connector doesn't sync traditional metrics
    // It's primarily used for content publishing
    return { rows: [] }
  },

  async discoverAccounts(
    auth: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<DiscoveredAccount[]> {
    const siteUrl = String(config.site_url || '')
    const username = String(auth.username || '')
    const appPassword = String(auth.app_password || '')

    if (!siteUrl || !username || !appPassword) return []

    try {
      // Fetch site info via /users/me to verify credentials
      const user = (await wpGet(siteUrl, '/users/me', { username, app_password: appPassword })) as Record<string, unknown>
      return [{
        external_id: siteUrl,
        external_name: String(user.name || siteUrl),
        metadata: { roles: user.roles, avatar_url: user.avatar_urls },
      }]
    } catch {
      return []
    }
  },

  async testConnection(
    auth: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<boolean> {
    const siteUrl = String(config.site_url || '')
    const username = String(auth.username || '')
    const appPassword = String(auth.app_password || '')

    if (!siteUrl || !username || !appPassword) return false

    try {
      await wpGet(siteUrl, '/users/me', { username, app_password: appPassword })
      return true
    } catch {
      return false
    }
  },
}

/**
 * Move a WordPress post or page to the trash, or delete it permanently.
 *
 * `force: false` (the default) trashes, which is recoverable from wp-admin —
 * the right default when a human is removing published content, because an
 * accidental click should not be unrecoverable.
 */
export async function deleteWpContent(
  siteUrl: string,
  auth: { username: string; app_password: string },
  kind: 'post' | 'page',
  id: number,
  force = false,
): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  const path = kind === 'page' ? `/pages/${id}` : `/posts/${id}`
  const res = await fetch(wpApiUrl(siteUrl, `${path}?force=${force ? 'true' : 'false'}`), {
    method:  'DELETE',
    headers: wpHeaders(auth),
    signal:  AbortSignal.timeout(WP_TIMEOUT_MS),
  })
  if (res.ok) return { deleted: true, alreadyGone: false }

  const text = await res.text()

  // "Already gone" is a success for our purposes — the goal state is "not on the
  // site" — but ONLY when WordPress itself says the id does not exist. A bare
  // 404 is not proof of that: /wp/v2/pages/{id} also 404s when {id} is a post,
  // a stale wp_site_url pointing at a parked domain 404s, and a WAF can 404 the
  // whole /wp-json route. Treating those as "deleted" made the caller clear the
  // platform ids and permanently orphan an article that is still live, which is
  // the exact failure this module exists to prevent. A REST error carries a JSON
  // body with a `rest_*` code; an infrastructure 404 returns HTML.
  if (res.status === 404 || res.status === 410) {
    let code = ''
    try { code = String((JSON.parse(text) as { code?: unknown }).code ?? '') } catch { /* not JSON */ }
    if (/^rest_/.test(code)) return { deleted: false, alreadyGone: true }
  }

  throw new Error(`WordPress API error ${res.status}: ${text}`)
}

/** Flip a live post or page back to draft without deleting it. */
export async function setWpContentStatus(
  siteUrl: string,
  auth: { username: string; app_password: string },
  kind: 'post' | 'page',
  id: number,
  status: 'draft' | 'publish' | 'private',
): Promise<void> {
  const path = kind === 'page' ? `/pages/${id}` : `/posts/${id}`
  const res = await fetch(wpApiUrl(siteUrl, path), {
    method:  'POST',
    headers: wpHeaders(auth, true),
    body:    JSON.stringify({ status }),
    signal:  AbortSignal.timeout(WP_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WordPress API error ${res.status}: ${text}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Media library
// ─────────────────────────────────────────────────────────────────────────────

export interface WpMediaItem {
  id:        number
  title:     string
  /** Full-size source URL. */
  url:       string
  /** Smallest sensible preview, falling back to the full image. */
  thumbnail: string
  width:     number | null
  height:    number | null
  alt:       string | null
  mimeType:  string
  uploadedAt: string | null
}

/**
 * One page of the client's own WordPress media library.
 *
 * Deliberately NOT exhaustive. A mature site can hold thousands of attachments, and pulling
 * them all to filter in memory would be slow for the reviewer, hostile to the client's server,
 * and pointless — WordPress already indexes media for search, so `search` is pushed upstream
 * and only a page comes back.
 *
 * `media_type=image` is a server-side filter: a media library also holds PDFs, audio and
 * video, none of which can be a featured image, and letting those consume page slots is how
 * a search for "roof" returns four results out of twenty.
 *
 * Returns the page plus WordPress's own total counts, taken from the X-WP-Total headers, so
 * the caller can page without guessing whether more exists.
 */
export async function searchMedia(
  siteUrl: string,
  auth: { username: string; app_password: string },
  opts: { search?: string; page?: number; perPage?: number } = {},
): Promise<{ items: WpMediaItem[]; total: number; totalPages: number }> {
  const page    = Math.max(1, Math.trunc(opts.page ?? 1))
  // Capped at 60: the picker shows a strip, and WordPress's own ceiling is 100. A large
  // per_page on a slow client host is the difference between a responsive picker and a
  // timeout, and nobody scans 100 thumbnails at once anyway.
  const perPage = Math.min(60, Math.max(1, Math.trunc(opts.perPage ?? 24)))

  const url = new URL(wpApiUrl(siteUrl, '/media'))
  url.searchParams.set('media_type', 'image')
  url.searchParams.set('per_page', String(perPage))
  url.searchParams.set('page', String(page))
  url.searchParams.set('orderby', opts.search?.trim() ? 'relevance' : 'date')
  if (!opts.search?.trim()) url.searchParams.set('order', 'desc')
  if (opts.search?.trim()) url.searchParams.set('search', opts.search.trim())
  // Only the fields the picker renders. Media rows carry a large `description`/`caption`
  // payload per item that would otherwise be transferred and discarded.
  url.searchParams.set('_fields', 'id,title,source_url,media_details,alt_text,mime_type,date')

  // A client site that accepts the connection and never answers must not hold this request
  // open until the platform kills it — the reviewer is waiting on this one.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WP_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: {
        Authorization:  authHeader(auth.username, auth.app_password),
        'Content-Type': 'application/json',
        'User-Agent':   BROWSER_BOT_UA,
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WordPress media error ${res.status}: ${text.slice(0, 300)}`)
  }

  const rows = (await res.json()) as Record<string, unknown>[]
  const total      = Number(res.headers.get('x-wp-total')       ?? rows.length)
  const totalPages = Number(res.headers.get('x-wp-totalpages')  ?? 1)

  const items: WpMediaItem[] = rows.map(r => {
    const details = (r.media_details ?? {}) as Record<string, unknown>
    const sizes   = (details.sizes   ?? {}) as Record<string, { source_url?: string; width?: number; height?: number }>
    // Prefer a real thumbnail size; a media library's full-size originals are routinely
    // several megabytes each and a strip of twenty would be tens of megabytes.
    const preview =
      sizes.medium?.source_url
      ?? sizes.thumbnail?.source_url
      ?? sizes.medium_large?.source_url
      ?? String(r.source_url ?? '')

    return {
      id:        Number(r.id),
      title:     String((r.title as Record<string, unknown>)?.rendered ?? r.title ?? '').trim(),
      url:       String(r.source_url ?? ''),
      thumbnail: preview,
      width:     details.width  != null ? Number(details.width)  : null,
      height:    details.height != null ? Number(details.height) : null,
      alt:       r.alt_text ? String(r.alt_text) : null,
      mimeType:  String(r.mime_type ?? 'image/jpeg'),
      uploadedAt: r.date ? String(r.date) : null,
    }
  }).filter(m => m.url)

  return { items, total, totalPages }
}

/**
 * One attachment by id.
 *
 * Exists so the apply path can resolve a chosen media item WITHOUT trusting a URL from the
 * request body. select-stock-image refuses arbitrary URLs on purpose — accepting one would
 * let any authenticated caller make the server fetch an address of their choosing and publish
 * the result to a client's site. Resolving the id against the client's own authenticated API
 * keeps that property: the URL comes from their WordPress, not from the caller.
 */
export async function getMediaItem(
  siteUrl: string,
  auth: { username: string; app_password: string },
  mediaId: number,
): Promise<WpMediaItem | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WP_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(
      `${wpApiUrl(siteUrl, `/media/${mediaId}`)}?_fields=id,title,source_url,media_details,alt_text,mime_type,date`,
      {
        headers: {
          Authorization:  authHeader(auth.username, auth.app_password),
          'Content-Type': 'application/json',
          'User-Agent':   BROWSER_BOT_UA,
        },
        signal: controller.signal,
      },
    )
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 404) return null
  if (!res.ok) throw new Error(`WordPress media error ${res.status}`)

  const r = (await res.json()) as Record<string, unknown>
  if (!r.source_url) return null
  const details = (r.media_details ?? {}) as Record<string, unknown>
  const sizes   = (details.sizes   ?? {}) as Record<string, { source_url?: string }>

  return {
    id:        Number(r.id),
    title:     String((r.title as Record<string, unknown>)?.rendered ?? r.title ?? '').trim(),
    url:       String(r.source_url),
    thumbnail: sizes.medium?.source_url ?? sizes.thumbnail?.source_url ?? String(r.source_url),
    width:     details.width  != null ? Number(details.width)  : null,
    height:    details.height != null ? Number(details.height) : null,
    alt:       r.alt_text ? String(r.alt_text) : null,
    mimeType:  String(r.mime_type ?? 'image/jpeg'),
    uploadedAt: r.date ? String(r.date) : null,
  }
}
