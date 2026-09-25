// GET /api/admin/content/serp-insights?client_id=…
//
// What Google showed for this client's keywords: the questions people also ask, related searches,
// who the AI Overview cites, who holds the featured snippet, the local pack. Captured when a post
// is written (its target keyword) and when research probes the seed services; this only reads
// what is stored. Never spends.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { readSerpInsight, type SerpInsightRow } from '@/lib/content/serpInsights'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()
  const { data, error } = await db
    .from('seo_keywords')
    .select('keyword, metadata, is_tracked, content_post_id')
    .eq('client_id', clientId)
    .not('metadata->serp', 'is', null)
    .limit(300)
  if (error) {
    // seo_keywords arrives with migration 189; until then there is nothing to show.
    console.warn('[serp-insights] read failed:', error.message)
    return NextResponse.json({ insights: [] })
  }

  const insights: SerpInsightRow[] = ((data ?? []) as Record<string, unknown>[])
    .map(r => {
      const insight = readSerpInsight(r.metadata)
      return insight ? {
        keyword:       String(r.keyword ?? '').trim(),
        tracked:       r.is_tracked === true,
        contentPostId: r.content_post_id == null ? null : String(r.content_post_id),
        insight,
      } : null
    })
    .filter((r): r is SerpInsightRow => !!r && !!r.keyword)
    // Newest first; a keyword a post was written for ahead of a research probe on a tie.
    .sort((a, b) => b.insight.checked_at.localeCompare(a.insight.checked_at) || Number(b.tracked) - Number(a.tracked))
    .slice(0, 100)

  return NextResponse.json({ insights })
}
