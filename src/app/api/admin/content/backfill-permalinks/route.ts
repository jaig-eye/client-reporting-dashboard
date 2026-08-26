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
import { createAdminClient }         from '@/lib/supabase/server'
import { requireVerifiedAdmin }      from '@/lib/auth'
import { wpCreds, bcCreds }          from '@/lib/content/cmsLifecycle'
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
  // Cross-tenant by default (clientId is optional), reads every client's CMS
  // credentials, and fans out authenticated calls to every client's site for up
  // to five minutes. That is an admin operation, not a "logged in" one.
  const gate = await requireVerifiedAdmin()
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  const body = await request.json().catch(() => ({})) as { clientId?: string; dryRun?: boolean; limit?: number }
  const dryRun = body.dryRun === true

  // Bounded per call, and the bound is reported back.
  //
  // The selector is every published_url IS NULL row across ALL clients — exactly
  // the population migration 202 NULLed — and each one costs a remote CMS round
  // trip. At ~600ms a call, 500 posts is 300s: the function is killed mid-loop,
  // the results array is lost, and the operator sees a timeout with no record of
  // what was repaired. A capped batch that says how many remain is re-runnable;
  // a run that dies is not.
  const limit = Math.min(Math.max(Math.trunc(Number(body.limit) || 150), 1), 400)

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

  const candidates = ((data ?? []) as unknown as PostRow[])
    .filter(p => p.wp_post_id !== null || p.bc_post_id !== null)

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, candidates: 0, repaired: 0, remaining: 0, results: [] })
  }

  const posts     = candidates.slice(0, limit)
  const deferred  = candidates.length - posts.length

  // Credentials are per client, and the BC storefront origin costs an API call —
  // resolve each once rather than per post.
  //
  // The resolvers themselves come from cmsLifecycle rather than being copied
  // here. The config-then-auth precedence they encode is a per-connector
  // convention, and getting it backwards is what made the whole live-post
  // lifecycle a silent no-op for every WordPress client — a fourth hand-written
  // copy is a fourth place for that to go wrong, and it fails by returning null
  // rather than erroring, so it would report success and repair nothing.
  const bcCache = new Map<string, { storeHash: string; accessToken: string; origin: string | null } | null>()
  const wpCache = new Map<string, { siteUrl: string; username: string; app_password: string } | null>()

  async function bcFor(clientId: string) {
    if (bcCache.has(clientId)) return bcCache.get(clientId)!
    const creds = await bcCreds(db, clientId)
    if (!creds) { bcCache.set(clientId, null); return null }
    const origin = await fetchBCStorefrontOrigin(creds.storeHash, creds.accessToken).catch(() => null)
    const v = { ...creds, origin }
    bcCache.set(clientId, v)
    return v
  }

  async function wpFor(clientId: string) {
    if (wpCache.has(clientId)) return wpCache.get(clientId)!
    const creds = await wpCreds(db, clientId)
    wpCache.set(clientId, creds)
    return creds
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

  return NextResponse.json({
    ok: true,
    dryRun,
    candidates: candidates.length,
    processed:  posts.length,
    repaired,
    // Non-zero means run it again; the selector is idempotent so repeats are safe.
    remaining:  deferred,
    results,
  })
}
