// POST /api/admin/content/posts/[id]/generate-image
// Generates a featured image for a post using DALL-E 3 (primary)
// or Gemini Imagen 3 (fallback if GEMINI_API_KEY is set).

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { generatePostImage } from '@/lib/content/generatePostImage'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createAdminClient()

  const { data: agency } = await db
    .from('agency_settings')
    .select('openai_api_key')
    .single()

  const result = await generatePostImage(db, id, (agency as { openai_api_key?: string | null } | null)?.openai_api_key)

  // generatePostImage ALSO rewrites image_candidates as a side effect (it awaits the
  // stock search before returning), at the strict automatic floor and cap. Read the new
  // list back and return it so the client can re-render its picker: a reviewer who had
  // just run a manual search would otherwise be looking at up to 24 tiles of which only
  // the first 8 still exist in the stored list, and every stale tile 400s on click with
  // nothing on screen explaining why. Returned on the failure path too, because the
  // overwrite happens there as well.
  const { data: fresh } = await db
    .from('content_posts')
    .select('image_candidates')
    .eq('id', id)
    .maybeSingle()
  const candidates = Array.isArray((fresh as { image_candidates?: unknown } | null)?.image_candidates)
    ? (fresh as { image_candidates: unknown[] }).image_candidates
    : []

  if (!result.ok)
    return NextResponse.json({ error: result.error, candidates }, { status: 422 })

  return NextResponse.json({ url: result.url, prompt: result.prompt, provider: result.provider, candidates })
}
