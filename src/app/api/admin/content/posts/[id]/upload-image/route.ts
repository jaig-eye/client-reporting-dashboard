// POST /api/admin/content/posts/[id]/upload-image
// Accepts multipart/form-data with an 'image' field.
// Uploads to Supabase Storage (uploads bucket) and saves URL to content_posts.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

const MAX_SIZE = 8 * 1024 * 1024 // 8 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const form  = await request.formData()
  const file  = form.get('image') as File | null

  if (!file)            return NextResponse.json({ error: 'No image provided' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'Image too large (max 8 MB)' }, { status: 413 })

  const db = createAdminClient()

  const { data: post } = await db
    .from('content_posts')
    .select('client_id')
    .eq('id', id)
    .single()

  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const ext      = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const filename = `content-images/${post.client_id}/${id}-custom.${ext}`
  const buffer   = Buffer.from(await file.arrayBuffer())

  const { error: upErr } = await db.storage
    .from('uploads')
    .upload(filename, buffer, { contentType: file.type || 'image/jpeg', upsert: true })

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: { publicUrl } } = db.storage.from('uploads').getPublicUrl(filename)

  await db.from('content_posts').update({
    featured_image_url:    publicUrl,
    featured_image_source: 'uploaded',
    featured_image_prompt: null,
  }).eq('id', id)

  return NextResponse.json({ url: publicUrl })
}
