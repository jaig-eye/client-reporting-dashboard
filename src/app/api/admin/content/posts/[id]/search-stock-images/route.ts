// POST /api/admin/content/posts/[id]/search-stock-images
// Body: { query: string }
//
// Free-text search across all three stock sources for the image picker modal, so the
// reviewer can look for something other than what the post's own keyword suggests
// ("workshop bench" instead of "powder coating oven ventilation requirements").
//
// The results REPLACE content_posts.image_candidates rather than being returned and
// forgotten. That is not incidental — /select-stock-image only accepts a candidate that
// is already stored on the post, because taking an arbitrary URL from a request body
// would let any authenticated caller make the server fetch an address of their choosing
// and publish the result to a client's site. Persisting the search results keeps that
// check meaningful while letting the reviewer choose from them.
//
// The relevance floor is deliberately looser here than for the automatic search. An
// unattended suggestion the reviewer has to disbelieve is worse than none, but a person
// who typed a query and is looking at thumbnails IS the filter, and a strict floor just
// hides results they explicitly asked for.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { findStockImageCandidates } from '@/lib/content/stockImages'

const MANUAL_SEARCH_FLOOR = 0.34
const MANUAL_SEARCH_LIMIT = 24
const MAX_QUERY_LENGTH    = 120

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({})) as { query?: string }
  const query = (body.query ?? '').trim().slice(0, MAX_QUERY_LENGTH)

  if (query.length < 3) {
    return NextResponse.json({ error: 'Enter at least 3 characters to search' }, { status: 400 })
  }

  const db = createAdminClient()

  // Confirm the post exists before spending three upstream calls on it, and so a bad id
  // is a 404 rather than a successful search that quietly writes nothing.
  const { data: post } = await db
    .from('content_posts').select('id').eq('id', id).maybeSingle()
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  // Passed as imageConcept so the query ladder treats it as the most specific rung and
  // still broadens if the exact phrase finds nothing.
  const candidates = await findStockImageCandidates(
    { imageConcept: query },
    { minRelevance: MANUAL_SEARCH_FLOOR, limit: MANUAL_SEARCH_LIMIT },
  )

  const { error } = await db.from('content_posts')
    .update({ image_candidates: candidates })
    .eq('id', id)

  if (error) {
    // Deploy-order tolerant: image_candidates only exists from migration 210. Without
    // the column the results cannot be selected, so say so rather than showing a grid
    // whose tiles would all fail.
    console.warn(`[search-stock-images] could not store results (apply migration 210): ${error.message}`)
    return NextResponse.json(
      { error: 'Could not save the search results. Apply migration 210 and try again.' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    query,
    candidates,
    message: candidates.length === 0
      ? `Nothing matched “${query}”. Try a broader or more common phrase.`
      : `${candidates.length} image${candidates.length === 1 ? '' : 's'} found.`,
  })
}
