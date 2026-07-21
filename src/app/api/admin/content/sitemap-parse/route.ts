// POST /api/admin/content/sitemap-parse?client_id=X
// Fetches and parses the client's configured sitemap(s), upserts page URLs to DB, returns full list.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi), m => m[1].trim())
    .map(u => u.replace(/&amp;/g, '&').replace(/\s/g, ''))
}

// Block private/internal IP ranges and dangerous schemes to prevent SSRF.
function isPublicUrl(rawUrl: string): boolean {
  let u: URL
  try { u = new URL(rawUrl) } catch { return false }
  if (!['http:', 'https:'].includes(u.protocol)) return false
  const host = u.hostname.toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (host === 'metadata.google.internal' || host === 'metadata.goog') return false
  const oct = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (oct) {
    const [a, b] = [Number(oct[1]), Number(oct[2])]
    if (a === 10 || a === 127 || a === 0) return false
    if (a === 172 && b >= 16 && b <= 31)  return false
    if (a === 192 && b === 168)            return false
    if (a === 169 && b === 254)            return false
    if (a === 100 && b >= 64 && b <= 127) return false
  }
  if (host === '::1' || host === '[::1]' || host.startsWith('fe80')) return false
  return true
}

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const db = createAdminClient()

  const { data: settings } = await db
    .from('content_settings')
    .select('sitemap_urls, sitemap_url')
    .eq('client_id', clientId)
    .maybeSingle()

  type Settings = { sitemap_urls?: string[] | null; sitemap_url?: string | null } | null
  const s = settings as Settings

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

  const pageUrls   = new Set<string>()
  const fetchErrors: string[] = []
  const headers = {
    'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
      const res = await fetch(sitemapUrl, { headers, redirect: 'follow' })
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
        // Sitemap index — recurse one level into sub-sitemaps, capped at 20 to prevent DoS
        const subUrls = locs.filter(isPublicUrl).slice(0, 20)
        for (const subUrl of subUrls) {
          try {
            const subRes = await fetch(subUrl, { headers, redirect: 'follow' })
            if (!subRes.ok) {
              const hint = subRes.status === 403
                ? `HTTP 403 — site is blocking server-side requests`
                : `HTTP ${subRes.status}`
              fetchErrors.push(`${subUrl} → ${hint}`)
              continue
            }
            for (const loc of extractLocs(await subRes.text())) pageUrls.add(loc)
          } catch (e) {
            fetchErrors.push(`${subUrl} → ${e instanceof Error ? e.message : 'fetch failed'}`)
          }
        }
      } else {
        for (const loc of locs) pageUrls.add(loc)
      }
    } catch (e) {
      fetchErrors.push(`${sitemapUrl} → ${e instanceof Error ? e.message : 'fetch failed'}`)
    }
  }

  const urls = Array.from(pageUrls)
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
    .slice(0, 500)

  if (urls.length === 0) {
    const detail = fetchErrors.length > 0 ? ` Errors: ${fetchErrors.join('; ')}` : ''
    return NextResponse.json({ error: `No pages found in sitemap.${detail}` }, { status: 400 })
  }

  // Upsert URLs — preserve existing title/flags, only insert new rows
  await db.from('content_sitemap_pages').upsert(
    urls.map(url => ({ client_id: clientId, url })),
    { onConflict: 'client_id,url', ignoreDuplicates: true }
  )

  const { data: allPages } = await db
    .from('content_sitemap_pages')
    .select('url, title, is_priority, is_excluded')
    .eq('client_id', clientId)
    .order('url')

  return NextResponse.json(
    (allPages ?? []).map((p: { url: string; title: string | null; is_priority: boolean; is_excluded: boolean }) => ({
      url:        p.url,
      title:      p.title ?? null,
      isPriority: p.is_priority,
      isExcluded: p.is_excluded,
    }))
  )
}
