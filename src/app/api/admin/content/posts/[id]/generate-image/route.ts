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

  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: 422 })

  return NextResponse.json({ url: result.url, prompt: result.prompt, provider: result.provider })
}
