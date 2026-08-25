// POST /api/admin/content/backfill-permalinks
//
// Repairs content_posts.published_url for posts that were pushed before
// migration 202, when the BigCommerce path wrote a constant admin URL
// ("https://store-{hash}.mybigcommerce.com/manage/content/blog") into the
// public-permalink column for EVERY post.
//
// Why it matters beyond a broken "view post" link: injectNearbyLinks filters on
// published_url truthiness and then emits it as an href, so internal links
// pointing at a BigCommerce sibling pointed at the store admin panel — a 404 for
// any actual reader. Migration 202 moved those admin URLs to platform_edit_url
// and NULLed published_url, which stops the bleeding; this route refills the
// column with the real permalinks read back from each CMS.
//
// Idempotent: only touches rows where published_url IS NULL and a platform id
// exists. Safe to re-run.
//
// Body: { clientId?: string, dryRun?: boolean }

export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'
import { fetchPost }                 from '@/lib/connectors/wordpress'
import {
  fetchBCBlogPost,
  fetchBCPage,
  fetchBCStorefrontOrigin,
  bcPermalink,
} from '@/lib/connectors/bigcommerce'
import { isPublicPermalink }         from '@/lib/content/postLinks'

interface PostRow {
  id:            string
  client_id:     string
  title:         string | null
  content_type:  string | null
  wp_post_id:    number | null
  wp_site_url:   string | null
  bc_post_id:    number | null
  bc_store_hash: string | null
  published_url: string | null
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { clientId?: string; dryRun?: boolean }
  const dryRun = body.dryRun === true

  const db = createAdminClient()

  let q = db
    .from('content_posts')
    .select('id, client_id, title, content_type, wp_post_id, wp_site_url, bc_post_id, bc_store_hash, published_url')
    .is('published_url', null)
  if (body.clientId) q = q.eq('client_id', body.clientId)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: `Failed to load posts: ${error.message}` }, { status: 500 })
  }

  const posts = ((data ?? []) as unknown as PostRow[])
    .filter(p => p.wp_post_id !== null || p.bc_post_id !== null)

  if (posts.length === 0) {
    return NextResponse.json({ ok: true, candidates: 0, repaired: 0, results: [] })
  }

  // Credentials are per client, and the BC storefront origin costs an API call —
  // resolve each once rather than per post.
  const bcCreds  = new Map<string, { storeHash: string; accessToken: string; origin: string | null } | null>()
  const wpCreds  = new Map<string, { siteUrl: string; username: string; app_password: string } | null>()

  async function bcFor(clientId: string) {
    if (bcCreds.has(clientId)) return bcCreds.get(clientId)!
    const { data: conn } = await db
      .from('client_connections')
      .select('id, connector:connectors!inner(type, auth, config)')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .eq('connector.type', 'bigcommerce')
      .limit(1)
      .maybeSingle()
    const c = conn as { connector: { auth: Record<string, unknown>; config: Record<string, unknown> } } | null
    if (!c) { bcCreds.set(clientId, null); return null }
    const storeHash   = String(c.connector.config.store_hash   || c.connector.auth.store_hash   || '')
    const accessToken = String(c.connector.config.access_token || c.connector.auth.access_token || '')
    if (!storeHash || !accessToken) { bcCreds.set(clientId, null); return null }
    const origin = await fetchBCStorefrontOrigin(storeHash, accessToken).catch(() => null)
    const v = { storeHash, accessToken, origin }
    bcCreds.set(clientId, v)
    return v
  }

  async function wpFor(clientId: string) {
    if (wpCreds.has(clientId)) return wpCreds.get(clientId)!
    const { data: conn } = await db
      .from('client_connections')
      .select('id, connector:connectors!inner(type, auth, config)')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .eq('connector.type', 'wordpress')
      .limit(1)
      .maybeSingle()
    const c = conn as { connector: { auth: Record<string, unknown>; config: Record<string, unknown> } } | null
    if (!c) { wpCreds.set(clientId, null); return null }
    // config-then-auth: WP connectors store credentials in config (see cmsLifecycle).
    const siteUrl      = String(c.connector.config.site_url     || c.connector.auth.site_url     || '')
    const username     = String(c.connector.config.username     || c.connector.auth.username     || '')
    const app_password = String(c.connector.config.app_password || c.connector.auth.app_password || '')
    if (!siteUrl || !username || !app_password) { wpCreds.set(clientId, null); return null }
    const v = { siteUrl, username, app_password }
    wpCreds.set(clientId, v)
    return v
  }

  const results: { id: string; title: string | null; url: string | null; outcome: string }[] = []
  let repaired = 0

  for (const p of posts) {
    try {
      let url: string | null = null

      if (p.bc_post_id !== null) {
        const creds = await bcFor(p.client_id)
        if (!creds) { results.push({ id: p.id, title: p.title, url: null, outcome: 'no BigCommerce connection' }); continue }
        const hash = p.bc_store_hash || creds.storeHash
        const remote = p.content_type === 'service_area'
          ? await fetchBCPage(hash, creds.accessToken, p.bc_post_id)
          : await fetchBCBlogPost(hash, creds.accessToken, p.bc_post_id)
        if (!remote) { results.push({ id: p.id, title: p.title, url: null, outcome: 'gone from BigCommerce (404)' }); continue }
        url = bcPermalink(creds.origin, remote.url)
        if (!url) { results.push({ id: p.id, title: p.title, url: null, outcome: 'could not resolve storefront origin' }); continue }
      } else if (p.wp_post_id !== null) {
        const creds = await wpFor(p.client_id)
        if (!creds) { results.push({ id: p.id, title: p.title, url: null, outcome: 'no WordPress connection' }); continue }
        const siteUrl = p.wp_site_url || creds.siteUrl
        const remote = await fetchPost(siteUrl, { username: creds.username, app_password: creds.app_password }, p.wp_post_id)
        if (!remote) { results.push({ id: p.id, title: p.title, url: null, outcome: 'gone from WordPress (404)' }); continue }
        url = remote.link || null
      }

      // Never re-poison the column with an admin URL.
      if (!url || !isPublicPermalink(url)) {
        results.push({ id: p.id, title: p.title, url, outcome: 'CMS returned a non-public URL; left NULL' })
        continue
      }

      if (!dryRun) {
        const { error: upErr } = await db
          .from('content_posts')
          .update({ published_url: url })
          .eq('id', p.id)
        if (upErr) { results.push({ id: p.id, title: p.title, url, outcome: `write failed: ${upErr.message}` }); continue }
      }

      repaired++
      results.push({ id: p.id, title: p.title, url, outcome: dryRun ? 'would repair' : 'repaired' })
    } catch (e) {
      results.push({ id: p.id, title: p.title, url: null, outcome: `error: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return NextResponse.json({ ok: true, dryRun, candidates: posts.length, repaired, results })
}
