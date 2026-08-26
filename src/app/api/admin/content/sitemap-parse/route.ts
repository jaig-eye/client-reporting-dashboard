// POST /api/admin/content/sitemap-parse?client_id=X
// Fetches and parses the client's configured sitemap(s), upserts page URLs to DB, returns full list.
//
// This was the ONLY route under /api/admin/content without a maxDuration export,
// so it ran on the platform default (~10s) while every sibling sets 60-300. A
// sitemap index with 8-10 children fetched sequentially exceeds that, and a
// killed function leaves the page cache empty with nothing to show the user.
//
// That empty cache is not cosmetic: generate/route.ts builds its cannibalization
// avoid-list from cached sitemap rows (the `[existing site post]` entries), so a
// client whose sitemap never parsed has NO protection against the AI rewriting a
// page that already exists on their site.

export const maxDuration = 60

/** Per-sub-sitemap ceiling, so one slow child cannot consume the whole budget. */
const SUB_FETCH_TIMEOUT_MS = 12_000

/** How many URLs we keep per client. Shared fairly across sub-sitemaps below. */
const MAX_CACHED_URLS = 500

/**
 * An individual-PRODUCT sitemap, as opposed to a category or collection one.
 *
 * The distinction matters: category and collection pages are among the best
 * internal-link targets a store has, while individual SKUs are the volume that
 * crowds everything else out. So `product_cat-sitemap.xml` and
 * `collections-sitemap.xml` are kept even when product exclusion is on;
 * `product-sitemap.xml` is not.
 */
function isProductSitemap(sitemapUrl: string): boolean {
  const name = sitemapUrl.toLowerCase().split('/').pop() ?? ''
  if (/categor|_cat|collection|brand|manufacturer/.test(name)) return false
  return /product|shop|store|item|sku/.test(name)
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'
import { BROWSER_BOT_UA }            from '@/lib/platformBot'
import { isPublicUrl }               from '@/lib/ssrf'

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi), m => m[1].trim())
    .map(u => u
      .replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '') // strip CDATA wrappers
      .replace(/&amp;/g, '&')
      .replace(/\s/g, '')
    )
}

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const db = createAdminClient()

  const { data: settings } = await db
    .from('content_settings')
    .select('sitemap_urls, sitemap_url, exclude_product_sitemaps')
    .eq('client_id', clientId)
    .maybeSingle()

  type Settings = { sitemap_urls?: string[] | null; sitemap_url?: string | null; exclude_product_sitemaps?: boolean | null } | null
  const s = settings as Settings
  // Default false: on a store, the product page is usually the most valuable
  // thing an article can link to. The quota below is what handles scale.
  const excludeProducts = s?.exclude_product_sitemaps === true

  const sitemapUrls: string[] = [
    ...(Array.isArray(s?.sitemap_urls) ? (s!.sitemap_urls as string[]) : []),
    ...(s?.sitemap_url ? [s.sitemap_url as string] : []),
  ].filter(Boolean)

  if (sitemapUrls.length === 0) {
    return NextResponse.json(
      { error: 'No sitemap URLs configured. Add sitemap URLs in Brand DNA settings.' },
      { status: 400 }
    )
  }

  // url → source sub-sitemap URL (or top-level sitemap URL for flat sitemaps)
  const pageMap    = new Map<string, string>()
  const fetchErrors: string[] = []
  const headers = {
    'User-Agent':                BROWSER_BOT_UA,
    'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language':           'en-US,en;q=0.5',
    'Accept-Encoding':           'gzip, deflate, br',
    'Connection':                'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  }

  for (const sitemapUrl of sitemapUrls) {
    if (!isPublicUrl(sitemapUrl)) {
      fetchErrors.push(`${sitemapUrl} → blocked (private or non-HTTP URL)`)
      continue
    }
    try {
      const res = await fetch(sitemapUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(SUB_FETCH_TIMEOUT_MS) })
      if (!res.ok) {
        const hint = res.status === 403
          ? `HTTP 403 — site is blocking server-side requests (may be Cloudflare or bot protection)`
          : `HTTP ${res.status}`
        fetchErrors.push(`${sitemapUrl} → ${hint}`)
        continue
      }
      // Detect HTML redirect (WP login page, Cloudflare challenge, etc.)
      const contentType = res.headers.get('content-type') ?? ''
      const xml = (await res.text()).replace(/^﻿/, '') // strip UTF-8 BOM
      if (!xml.includes('<') || contentType.startsWith('text/html')) {
        fetchErrors.push(`${sitemapUrl} → returned HTML (may require authentication or is redirected)`)
        continue
      }

      const locs = extractLocs(xml)

      if (xml.includes('<sitemapindex')) {
        // Sitemap index — recurse one level into sub-sitemaps, capped at 20 to prevent DoS.
        //
        // These used to run in a sequential for-loop, one await per sub-sitemap.
        // A Rank Math / Yoast index routinely has 8-10 children, and at roughly
        // 0.6-1.1s each behind Cloudflare that is 6-11 seconds of wall clock —
        // long enough to hit the serverless time limit and be killed mid-parse,
        // which is what left the cache empty with no error to show for it.
        // Fetching them together turns that into roughly one round trip.
        const subUrls = locs.filter(isPublicUrl).slice(0, 20)
        const subResults = await Promise.all(subUrls.map(async subUrl => {
          try {
            const subRes = await fetch(subUrl, {
              headers,
              redirect: 'follow',
              signal: AbortSignal.timeout(SUB_FETCH_TIMEOUT_MS),
            })
            if (!subRes.ok) {
              const hint = subRes.status === 403
                ? `HTTP 403 — site is blocking server-side requests`
                : `HTTP ${subRes.status}`
              return { subUrl, error: hint, locs: [] as string[] }
            }
            return { subUrl, error: null, locs: extractLocs(await subRes.text()) }
          } catch (e) {
            const msg = e instanceof Error
              ? (e.name === 'TimeoutError' ? `timed out after ${SUB_FETCH_TIMEOUT_MS / 1000}s` : e.message)
              : 'fetch failed'
            return { subUrl, error: msg, locs: [] as string[] }
          }
        }))

        for (const r of subResults) {
          if (r.error) { fetchErrors.push(`${r.subUrl} → ${r.error}`); continue }
          // Record source sub-sitemap so callers can identify blog-post sitemaps later
          for (const loc of r.locs) {
            if (!pageMap.has(loc)) pageMap.set(loc, r.subUrl)
          }
        }
      } else {
        for (const loc of locs) {
          if (!pageMap.has(loc)) pageMap.set(loc, sitemapUrl)
        }
      }
    } catch (e) {
      fetchErrors.push(`${sitemapUrl} → ${e instanceof Error ? e.message : 'fetch failed'}`)
    }
  }

  if (fetchErrors.length > 0) console.log('[sitemap-parse] fetch errors:', fetchErrors)

  const pageUrls = Array.from(pageMap.keys())
  const filtered = pageUrls
    .filter(u => {
      if (!u.startsWith('http')) return false
      // Reject binary/media/archive files by extension
      if (/\.(xml|pdf|jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip|gz|css|js)$/i.test(u)) return false
      try {
        const parsed = new URL(u)
        const path   = parsed.pathname.toLowerCase()
        // Reject sitemap scripts, feed URLs, and PHP scripts with query strings
        if (path.includes('sitemap'))                          return false
        if (path.includes('/feed') || path.includes('/rss') || path.includes('/atom')) return false
        if (path.endsWith('.php') && parsed.search.length > 0) return false
      } catch { return false }
      return true
    })

  // ── Fair share across sub-sitemaps ────────────────────────────────────────
  //
  // A flat .slice(0, 500) takes URLs in sitemap-index order, so a store with a
  // large catalogue fills every slot with products before page-sitemap.xml or
  // post-sitemap.xml is even reached — and the pages that matter for internal
  // linking and cannibalisation never make it into the cache at all.
  //
  // Round-robin instead: one URL from each sub-sitemap in turn. Small sitemaps
  // (pages, posts, services) are taken in full because they run out early, and
  // the catalogue gets whatever is left rather than everything. Same 500 ceiling,
  // very different 500.
  const buckets = new Map<string, string[]>()
  for (const u of filtered) {
    const src = pageMap.get(u) ?? '(root)'
    const arr = buckets.get(src)
    if (arr) arr.push(u)
    else buckets.set(src, [u])
  }

  const excludedProductSitemaps: string[] = []
  if (excludeProducts) {
    Array.from(buckets.keys()).forEach(src => {
      if (isProductSitemap(src)) {
        excludedProductSitemaps.push(src)
        buckets.delete(src)
      }
    })
  }

  const urls: string[] = []
  const lists = Array.from(buckets.values())
  for (let i = 0; urls.length < MAX_CACHED_URLS; i++) {
    let tookAny = false
    for (const list of lists) {
      if (i >= list.length) continue
      urls.push(list[i])
      tookAny = true
      if (urls.length >= MAX_CACHED_URLS) break
    }
    if (!tookAny) break
  }

  if (urls.length === 0) {
    const detail = fetchErrors.length > 0 ? ` Errors: ${fetchErrors.join('; ')}` : ''
    return NextResponse.json({ error: `No pages found in sitemap.${detail}` }, { status: 400 })
  }

  // Upsert URLs — insert new rows and update source_sitemap for existing ones.
  // ignoreDuplicates: false with a 3-column payload is intentional: PostgREST issues
  // ON CONFLICT (client_id, url) DO UPDATE SET source_sitemap = excluded.source_sitemap
  // so only source_sitemap is touched; is_priority / is_excluded / title are NOT overwritten.
  //
  // THE ERROR IS CHECKED, AND THE FALLBACK IS NOT OPTIONAL POLISH.
  // source_sitemap comes from migration 183, which is not applied on every
  // environment. When it is missing PostgREST rejects the whole upsert with
  // PGRST204, and because this call previously ignored its error the route went
  // on to return an empty 200 — a silent no-op that looked to the user like
  // "the sitemap tab returns nothing", with no message anywhere to explain it.
  // Worse, the empty cache silently disables cannibalisation protection at
  // generation time. Degrade to writing without the column rather than writing
  // nothing at all.
  const rows = urls.map(url => ({ client_id: clientId, url, source_sitemap: pageMap.get(url) ?? null }))

  let { error: upsertErr } = await db
    .from('content_sitemap_pages')
    .upsert(rows, { onConflict: 'client_id,url', ignoreDuplicates: false })

  let sourceSitemapMissing = false
  if (upsertErr && /source_sitemap/i.test(upsertErr.message)) {
    sourceSitemapMissing = true
    console.warn('[sitemap-parse] source_sitemap column missing (migration 183 not applied) — retrying without it. Blog-post detection will fall back to URL heuristics.')
    const bare = rows.map(({ client_id, url }) => ({ client_id, url }))
    const retry = await db
      .from('content_sitemap_pages')
      .upsert(bare, { onConflict: 'client_id,url', ignoreDuplicates: false })
    upsertErr = retry.error
  }

  if (upsertErr) {
    console.error('[sitemap-parse] upsert failed:', upsertErr.message)
    return NextResponse.json(
      { error: `Parsed ${urls.length} pages but could not save them: ${upsertErr.message}` },
      { status: 500 },
    )
  }

  // PRUNE what this parse deliberately left out.
  //
  // Without this, both of the controls above are no-ops for any client that has
  // already been parsed once. "Skip individual product pages" only stops NEW
  // product URLs being written; the 400 already cached stay, the route reads the
  // whole table back, and the generator keeps building its internal-linking
  // candidates and cannibalisation avoid-list from them — the exact damage the
  // setting promises to fix. The round-robin fair-share has the same problem: it
  // cannot evict what the old flat `.slice(0, 500)` stored.
  //
  // Scoped to rows the operator did not curate: is_priority and is_excluded are
  // human decisions and a row carrying either is left alone even if this parse
  // did not select it.
  const keep = new Set(urls)
  const { data: cached } = await db
    .from('content_sitemap_pages')
    .select('url, is_priority, is_excluded')
    .eq('client_id', clientId)

  const stale = ((cached ?? []) as { url: string; is_priority: boolean; is_excluded: boolean }[])
    .filter(r => !keep.has(r.url) && !r.is_priority && !r.is_excluded)
    .map(r => r.url)

  let pruned = 0
  if (stale.length > 0) {
    // Chunked: a single .in() with hundreds of URLs makes a request line long
    // enough for PostgREST to reject.
    for (let i = 0; i < stale.length; i += 100) {
      const { error: delErr } = await db
        .from('content_sitemap_pages')
        .delete()
        .eq('client_id', clientId)
        .in('url', stale.slice(i, i + 100))
      if (delErr) {
        console.error('[sitemap-parse] prune failed:', delErr.message)
        break
      }
      pruned += Math.min(100, stale.length - i)
    }
  }

  const { data: allPages } = await db
    .from('content_sitemap_pages')
    .select('url, title, is_priority, is_excluded')
    .eq('client_id', clientId)
    .order('url')

  // Both callers parse the body as a bare array, so the diagnostics ride in a
  // header rather than changing the shape. They were previously computed and
  // then dropped, which meant a client running without migration 183 silently
  // lost blog-post detection with nothing said about it, and the operator who
  // ticked "skip product pages" got no confirmation that anything happened.
  const notes: string[] = []
  if (excludedProductSitemaps.length > 0) {
    notes.push(`Skipped ${excludedProductSitemaps.length} product sitemap${excludedProductSitemaps.length === 1 ? '' : 's'}`)
  }
  if (pruned > 0) notes.push(`Removed ${pruned} cached page${pruned === 1 ? '' : 's'} no longer selected`)
  if (sourceSitemapMissing) {
    notes.push('Saved without source_sitemap (migration 183 not applied) — blog detection falls back to URL heuristics')
  }
  if (fetchErrors.length > 0) notes.push(`${fetchErrors.length} sitemap fetch error(s)`)
  if (notes.length > 0) console.warn('[sitemap-parse]', clientId, notes.join(' | '))

  return NextResponse.json(
    (allPages ?? []).map((p: { url: string; title: string | null; is_priority: boolean; is_excluded: boolean }) => ({
      url:        p.url,
      title:      p.title ?? null,
      isPriority: p.is_priority,
      isExcluded: p.is_excluded,
    })),
    { headers: notes.length > 0 ? { 'X-Sitemap-Notes': notes.join(' | ') } : {} },
  )
}
