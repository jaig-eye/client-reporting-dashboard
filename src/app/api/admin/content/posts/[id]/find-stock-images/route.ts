// POST /api/admin/content/posts/[id]/find-stock-images
//
// Searches Openverse for free stock candidates for this post and stores them, then
// returns them. Idempotent — safe to press repeatedly.
//
// This exists because candidates are otherwise only captured at generation time, which
// leaves two gaps:
//   • every post written BEFORE this feature shipped has none (169 of them at the time
//     of writing), and there was no way to get any short of regenerating the AI image;
//   • clients with content_image_generation turned OFF never run the image pipeline at
//     all — and they are precisely the ones who want a non-AI option.
//
// It is also just useful: re-running after editing the target keyword gives a fresh set
// aimed at the corrected topic.
//
// Costs nothing but a free third-party call, so it is a plain button rather than
// anything gated. Uses the same context and the same relevance floor as the automatic
// path, so results are identical to what generation would have produced.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { searchAndStoreStockCandidates } from '@/lib/content/stockImages'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = createAdminClient()

  const { data: post } = await db
    .from('content_posts')
    .select('id, client_id, image_concept, seo_title, title, target_keyword')
    .eq('id', id)
    .maybeSingle()

  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const row = post as {
    client_id: string
    image_concept: string | null; seo_title: string | null
    title: string | null; target_keyword: string | null
  }

  // Same geography stripping the automatic path uses, so a manual refetch builds the
  // same query rather than a subtly worse one.
  const { data: cs } = await db
    .from('content_settings')
    .select('geographic_focus, services')
    .eq('client_id', row.client_id)
    .maybeSingle()

  const candidates = await searchAndStoreStockCandidates(db, id, {
    targetKeyword: row.target_keyword,
    imageConcept:  row.image_concept,
    title:         row.seo_title ?? row.title,
    geographicFocus: (cs as { geographic_focus?: string | null } | null)?.geographic_focus ?? null,
  })

  // An empty list is a legitimate, common answer rather than a failure — most
  // specialised industrial topics have no usable free imagery, and saying so plainly
  // is better than implying something went wrong.
  return NextResponse.json({
    ok: true,
    candidates,
    message: candidates.length === 0
      ? 'No free images matched this topic closely enough. The AI image is the better option here.'
      : `Found ${candidates.length} free image${candidates.length === 1 ? '' : 's'}.`,
  })
}
