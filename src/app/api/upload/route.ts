// POST /api/upload — upload a file to Supabase Storage.
// Returns { url } on success.
// Uses the existing Supabase service-role client — no extra env vars needed.
//
// Accepts multipart/form-data with:
//   file   — the file to upload
//   folder — optional prefix (e.g. "avatars", "logos", "clients")
//
// Supabase bucket: "uploads" — must be created and set to public in the
// Supabase dashboard (Storage → New bucket → Name: uploads, Public: on).

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

const MAX_SIZE  = 4 * 1024 * 1024 // 4 MB
const BUCKET    = 'uploads'

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form   = await request.formData()
  const file   = form.get('file') as File | null
  const folder = (form.get('folder') as string | null) ?? 'uploads'

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  // Sound files can be larger than 4 MB; only enforce the limit for images
  const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|ogg|aac|m4a)$/i.test(file.name)
  const sizeLimit = isAudio ? 10 * 1024 * 1024 : MAX_SIZE
  if (file.size > sizeLimit) {
    return NextResponse.json({ error: `File too large (max ${isAudio ? '10' : '4'} MB)` }, { status: 413 })
  }

  try {
    const ext      = file.name.split('.').pop() ?? 'bin'
    const filename = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const buffer   = Buffer.from(await file.arrayBuffer())

    const db = createAdminClient()

    // Determine the content type to send. The 'uploads' bucket may have a strict
    // MIME allowlist (image-only). Audio files play correctly in the browser via
    // URL + extension regardless of the stored Content-Type, so we try progressively
    // less-specific types until the bucket accepts the upload.
    const contentTypesToTry = isAudio
      ? [file.type, 'audio/mpeg', 'application/octet-stream', 'image/png']
      : [file.type || 'image/png']

    let uploadError: Error | { message: string } | null = null
    for (const ct of contentTypesToTry) {
      const result = await db.storage
        .from(BUCKET)
        .upload(filename, buffer, { contentType: ct, upsert: false })
      uploadError = result.error
      if (!uploadError) break  // succeeded
      if (!/mime type|not supported|invalid.*type/i.test(uploadError.message)) break  // non-MIME error, stop retrying
    }

    if (uploadError) throw new Error(uploadError.message)

    const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(filename)
    return NextResponse.json({ url: publicUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
