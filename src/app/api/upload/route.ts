// POST /api/upload — upload a file to Vercel Blob storage.
// Returns { url } on success.
// Requires: npm install @vercel/blob
// Requires: BLOB_READ_WRITE_TOKEN environment variable (set in Vercel dashboard)
//
// Accepts multipart/form-data with:
//   file   — the file to upload
//   folder — optional prefix (e.g. "avatars", "logos", "clients")

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/auth'

const MAX_SIZE = 4 * 1024 * 1024 // 4 MB

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'Blob storage not configured. Add BLOB_READ_WRITE_TOKEN to your Vercel environment.' },
      { status: 503 }
    )
  }

  const form = await request.formData()
  const file   = form.get('file') as File | null
  const folder = (form.get('folder') as string | null) ?? 'uploads'

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 4 MB)' }, { status: 413 })
  }

  try {
    // Dynamic import so the app works even if @vercel/blob isn't installed yet
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { put } = require('@vercel/blob')

    const ext      = file.name.split('.').pop() ?? 'bin'
    const filename = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const blob = await put(filename, file, {
      access:      'public',
      contentType: file.type || 'application/octet-stream',
    })

    return NextResponse.json({ url: blob.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Cannot find module')) {
      return NextResponse.json(
        { error: 'Run `npm install @vercel/blob` to enable file uploads.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
