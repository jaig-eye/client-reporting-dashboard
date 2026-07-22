import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES  = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'File must be an image (JPG, PNG, GIF, WebP)' }, { status: 400 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'File must be under 10 MB' }, { status: 400 })
  }

  const ext      = file.type.split('/')[1].replace('jpeg', 'jpg')
  const filename = `email-previews/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const buffer   = Buffer.from(await file.arrayBuffer())

  const db = createAdminClient()
  const { error } = await db.storage
    .from('uploads')
    .upload(filename, buffer, { contentType: file.type, upsert: false })

  if (error) {
    console.error('[email upload-image]', error)
    return NextResponse.json({ error: 'Storage upload failed' }, { status: 500 })
  }

  const { data: { publicUrl } } = db.storage.from('uploads').getPublicUrl(filename)

  return NextResponse.json({ url: publicUrl })
}
