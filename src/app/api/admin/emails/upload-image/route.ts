import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed }             from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES  = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function hasMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg')
    return buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF
  if (mimeType === 'image/png')
    return buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
  if (mimeType === 'image/gif')
    return buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46
  if (mimeType === 'image/webp')
    return buf.length >= 12 && buf.slice(0, 4).toString('binary') === 'RIFF' && buf.slice(8, 12).toString('binary') === 'WEBP'
  return false
}

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

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!hasMagicBytes(buffer, file.type)) {
    return NextResponse.json({ error: 'File content does not match declared image type' }, { status: 400 })
  }

  const ext      = file.type.split('/')[1].replace('jpeg', 'jpg')
  const filename = `email-previews/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

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
