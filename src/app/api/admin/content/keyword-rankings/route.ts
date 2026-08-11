// /api/admin/content/keyword-rankings?client_id=…
// Returns the tracked keyword ranks for a client (from the OpenSEO datastream).
// Soft-returns [] when the seo_keywords/seo_rankings tables aren't present yet.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/auth'
import { getClientKeywordRankings, getRankForPost } from '@/lib/content/seoRankings'

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Single-post rank (for the post editor's SEO panel).
  const postId = req.nextUrl.searchParams.get('post_id')
  if (postId) {
    const rank = await getRankForPost(postId)
    return NextResponse.json({ rank })
  }

  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id or post_id required' }, { status: 400 })

  const rankings = await getClientKeywordRankings(clientId)
  return NextResponse.json({ rankings })
}
