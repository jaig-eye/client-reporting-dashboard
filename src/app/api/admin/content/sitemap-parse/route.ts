// POST /api/admin/content/sitemap-parse?client_id=X
// Fetches and parses the client's configured sitemap(s), upserts page URLs to DB, returns full list.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi), m => m[1].trim())
    .map(u => u.replace(/&amp;/g, '&').replace(/\s/g, ''))
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

  const pageUrls = new Set<string>()
  const headers  = { 'User-Agent': 'Mozilla/5.0 (compatible; LaunchLocal/1.0)' }

  for (const sitemapUrl of sitemapUrls) {
    try {
      const res = await fetch(sitemapUrl, { headers })
      if (!res.ok) continue
      const xml  = await res.text()
      const locs = extractLocs(xml)

      if (xml.includes('<sitemapindex')) {
        // Sitemap index — recurse one level into each sub-sitemap
        for (const subUrl of locs) {
          try {
            const subRes = await fetch(subUrl, { headers })
            if (!subRes.ok) continue
            for (const loc of extractLocs(await subRes.text())) pageUrls.add(loc)
          } catch { /* skip */ }
        }
      } else {
        for (const loc of locs) pageUrls.add(loc)
      }
    } catch { /* skip */ }
  }

  const urls = Array.from(pageUrls)
    .filter(u => u.startsWith('http') && !u.match(/\.(xml|pdf|jpg|jpeg|png|gif|svg|mp4|zip|gz)$/i))
    .slice(0, 500)

  if (urls.length === 0) {
    return NextResponse.json({ error: 'No pages found in sitemap' }, { status: 400 })
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
