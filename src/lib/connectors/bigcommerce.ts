// ─────────────────────────────────────────────────────────────────────────────
// BigCommerce Connector
//
// Content connection: publishes blog posts to BigCommerce Blog API (default).
// Analytics connection: fetches orders for daily sales reports (role='analytics').
//
// Auth/config object shape (stored in connectors.auth or connectors.config):
//   { store_hash: string, access_token: string, role?: 'content' | 'analytics' }
// ─────────────────────────────────────────────────────────────────────────────

import type { ConnectorAdapter, SyncResult, DiscoveredAccount } from './types'

const BC_API = (storeHash: string) => `https://api.bigcommerce.com/stores/${storeHash}`

export interface BCOrderSummary {
  grossRevenue: number
  orderCount:   number
}

// Fetch gross revenue and order count for a given date window.
// Excludes Incomplete (0), Refunded (4), and Cancelled (5) orders.
export async function fetchBCOrders(
  storeHash:   string,
  accessToken: string,
  dateFrom:    Date,
  dateTo:      Date,
): Promise<BCOrderSummary> {
  const headers = { 'X-Auth-Token': accessToken, Accept: 'application/json' }
  const base    = `${BC_API(storeHash)}/v2/orders`
  const minDate = dateFrom.toISOString()
  const maxDate = dateTo.toISOString()
  const EXCLUDED_STATUSES = new Set([0, 4, 5])

  let grossRevenue = 0
  let orderCount   = 0
  let page         = 1

  for (;;) {
    const qs = new URLSearchParams({ min_date_created: minDate, max_date_created: maxDate, limit: '250', page: String(page) })
    const res = await fetch(`${base}?${qs}`, { headers })
    if (res.status === 204 || res.status === 404) break
    if (!res.ok) throw new Error(`BigCommerce Orders API ${res.status}`)

    const orders = (await res.json()) as Array<{ total_inc_tax: string; status_id: number }>
    if (!Array.isArray(orders) || orders.length === 0) break

    for (const o of orders) {
      if (EXCLUDED_STATUSES.has(o.status_id)) continue
      grossRevenue += parseFloat(o.total_inc_tax) || 0
      orderCount++
    }

    if (orders.length < 250) break
    page++
  }

  return { grossRevenue, orderCount }
}

export async function fetchBCStoreTimezone(
  storeHash:   string,
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${BC_API(storeHash)}/v2/store`, {
      headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, unknown>
    const name = (data.timezone as Record<string, unknown> | null)?.name
    return typeof name === 'string' ? name : null
  } catch {
    return null
  }
}

export interface BCPagePayload {
  name:       string
  body:       string
  url?:       string
  is_visible?: boolean
  parent_id?:  number
}

export interface BCPublishedPage {
  id:  number
  url: string
}

/**
 * Publish a static page to BigCommerce via v2/pages API.
 */
export async function publishBCPage(
  storeHash:   string,
  accessToken: string,
  page:        BCPagePayload
): Promise<BCPublishedPage> {
  const res = await fetch(`${BC_API(storeHash)}/v2/pages`, {
    method:  'POST',
    headers: { 'X-Auth-Token': accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      type:       'raw',
      name:       page.name,
      body:       page.body,
      url:        page.url ?? '',
      is_visible: page.is_visible ?? false,
      ...(page.parent_id ? { parent_id: page.parent_id } : {}),
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`BigCommerce API error ${res.status}: ${text}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  return { id: Number(data.id), url: String(data.url || '') }
}

/**
 * Update an existing BC page body (for nearby-link injection).
 */
export async function updateBCPage(
  storeHash:   string,
  accessToken: string,
  pageId:      number,
  patch:       { body?: string }
): Promise<void> {
  const res = await fetch(`${BC_API(storeHash)}/v2/pages/${pageId}`, {
    method:  'PUT',
    headers: { 'X-Auth-Token': accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`BigCommerce API error ${res.status}: ${text}`)
  }
}

export const bigcommerceConnector: ConnectorAdapter = {
  type: 'bigcommerce',

  async fetchMetrics(): Promise<SyncResult> {
    return { rows: [] }
  },

  async discoverAccounts(
    auth: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<DiscoveredAccount[]> {
    const storeHash   = String(config.store_hash   || auth.store_hash   || '')
    const accessToken = String(config.access_token || auth.access_token || '')
    if (!storeHash || !accessToken) return []
    try {
      const res = await fetch(
        `https://api.bigcommerce.com/stores/${storeHash}/v2/store`,
        { headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' } }
      )
      if (!res.ok) return []
      const data = (await res.json()) as Record<string, unknown>
      return [{
        external_id:   storeHash,
        external_name: String(data.name || `BigCommerce (${storeHash})`),
        metadata:      { domain: data.domain },
      }]
    } catch {
      return []
    }
  },

  async testConnection(
    auth: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<boolean> {
    const storeHash   = String(config.store_hash   || auth.store_hash   || '')
    const accessToken = String(config.access_token || auth.access_token || '')
    if (!storeHash || !accessToken) return false
    const isAnalytics = config.role === 'analytics'
    try {
      // Analytics: test orders endpoint (requires Orders/Read scope).
      // Content: test blog/posts endpoint (requires Content scope).
      const endpoint = isAnalytics
        ? `${BC_API(storeHash)}/v2/orders?limit=1`
        : `${BC_API(storeHash)}/v2/blog/posts?limit=1`
      const res = await fetch(endpoint, { headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' } })
      return res.ok || res.status === 204
    } catch {
      return false
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Blog posts (v2/blog/posts) — the counterpart to the create call in
// /api/admin/content/posts/[id]/approve.
// ─────────────────────────────────────────────────────────────────────────────

export interface BCBlogPostPatch {
  title?:            string
  body?:             string
  url?:              string
  meta_description?: string
  meta_keywords?:    string
  tags?:             string[]
  thumbnail_path?:   string
  is_published?:     boolean
}

/**
 * Overwrite an existing BigCommerce blog post.
 *
 * This is what makes "regenerate a post that is already live" work: the post
 * keeps its bc_post_id and the CMS copy is replaced in place, rather than a
 * second post being created (or, as before, the new content never shipping).
 */
export async function updateBCBlogPost(
  storeHash:   string,
  accessToken: string,
  postId:      number,
  patch:       BCBlogPostPatch,
): Promise<{ id: number; url: string }> {
  const res = await fetch(`${BC_API(storeHash)}/v2/blog/posts/${postId}`, {
    method:  'PUT',
    headers: { 'X-Auth-Token': accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(res.status === 401
      ? 'BigCommerce rejected the access token (401). Reconnect the integration.'
      : `BigCommerce API error ${res.status}: ${text}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  return { id: Number(data.id), url: String(data.url || '') }
}

/** Read one blog post — used by the published_url backfill. */
export async function fetchBCBlogPost(
  storeHash:   string,
  accessToken: string,
  postId:      number,
): Promise<{ id: number; url: string; title: string } | null> {
  const res = await fetch(`${BC_API(storeHash)}/v2/blog/posts/${postId}`, {
    headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`BigCommerce API error ${res.status}: ${text}`)
  }
  const d = (await res.json()) as Record<string, unknown>
  return { id: Number(d.id), url: String(d.url || ''), title: String(d.title || '') }
}

/** Read one page — used by the published_url backfill for service-area pages. */
export async function fetchBCPage(
  storeHash:   string,
  accessToken: string,
  pageId:      number,
): Promise<{ id: number; url: string } | null> {
  const res = await fetch(`${BC_API(storeHash)}/v2/pages/${pageId}`, {
    headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`BigCommerce API error ${res.status}: ${text}`)
  }
  const d = (await res.json()) as Record<string, unknown>
  return { id: Number(d.id), url: String(d.url || '') }
}

/**
 * The storefront's public origin (honours a custom domain).
 *
 * Needed because BC returns only a path ("/blog/my-post/") and the
 * store-{hash}.mybigcommerce.com host is an admin/preview host, not where a
 * client's readers actually are.
 */
export async function fetchBCStorefrontOrigin(
  storeHash:   string,
  accessToken: string,
): Promise<string | null> {
  const res = await fetch(`${BC_API(storeHash)}/v2/store`, {
    headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' },
  })
  if (!res.ok) return null
  const d = (await res.json()) as Record<string, unknown>
  const raw = String(d.secure_url || d.domain || '')
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}

/** Join a storefront origin and a BC-relative path into a public permalink. */
export function bcPermalink(origin: string | null, path: string): string | null {
  if (!origin || !path) return null
  return `${origin}/${path.replace(/^\/+/, '')}`
}

/**
 * Delete a BigCommerce blog post or page.
 *
 * BigCommerce has no trash: v2 DELETE is permanent. Callers must treat this as
 * irreversible and say so in the UI — unlike WordPress, there is nothing to
 * restore from afterwards.
 */
export async function deleteBCContent(
  storeHash:   string,
  accessToken: string,
  kind: 'blog' | 'page',
  id: number,
): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  const path = kind === 'page' ? `/v2/pages/${id}` : `/v2/blog/posts/${id}`
  const res = await fetch(`${BC_API(storeHash)}${path}`, {
    method:  'DELETE',
    headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' },
  })
  if (res.status === 404) return { deleted: false, alreadyGone: true }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(res.status === 401
      ? 'BigCommerce rejected the access token (401). Reconnect the integration.'
      : `BigCommerce API error ${res.status}: ${text}`)
  }
  return { deleted: true, alreadyGone: false }
}

/** Hide a BC blog post or page from the storefront without deleting it. */
export async function setBCContentVisibility(
  storeHash:   string,
  accessToken: string,
  kind: 'blog' | 'page',
  id: number,
  visible: boolean,
): Promise<void> {
  const path = kind === 'page' ? `/v2/pages/${id}` : `/v2/blog/posts/${id}`
  // Pages use is_visible; blog posts use is_published.
  const body = kind === 'page' ? { is_visible: visible } : { is_published: visible }
  const res = await fetch(`${BC_API(storeHash)}${path}`, {
    method:  'PUT',
    headers: { 'X-Auth-Token': accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`BigCommerce API error ${res.status}: ${text}`)
  }
}
