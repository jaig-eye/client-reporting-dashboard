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
export async function uploadMediaToWordPress(
  siteUrl: string,
  auth: { username: string; app_password: string },
  imageUrl: string,
  altText?: string
): Promise<number> {
  const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': BROWSER_BOT_UA } })
  if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`)
  const buffer  = Buffer.from(await imgRes.arrayBuffer())
  const mime    = imgRes.headers.get('content-type') ?? 'image/jpeg'
  const ext     = mime.split('/')[1]?.replace(/;.*$/, '') ?? 'jpg'

  const formData = new FormData()
  formData.append('file', new Blob([buffer], { type: mime }), `featured.${ext}`)
  if (altText) formData.append('alt_text', altText)

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
