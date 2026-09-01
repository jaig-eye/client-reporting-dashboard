// POST /api/admin/content/posts/[id]/select-stock-image
// Body: { candidateId: string }
//
// Applies one of the Openverse candidates stored on the post as its featured image.
//
// The file is DOWNLOADED and re-uploaded into our own `uploads` bucket rather than
// hotlinked. Three reasons: the provider's CDN can rotate or remove a URL and the
// client's published post would silently lose its image; several providers' terms
// discourage hotlinking outright; and the published site should not make requests to
// a third party on every page view.
//
// Attribution is preserved on the post so it can be rendered where the license
// requires it — CC BY and BY-SA both do.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed, getAdminSession } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import type { StockImageCandidate } from '@/lib/content/stockImages'

const DOWNLOAD_TIMEOUT_MS = 20_000
const MAX_BYTES = 15 * 1024 * 1024

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { candidateId } = await request.json().catch(() => ({})) as { candidateId?: string }
  if (!candidateId) {
    return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
  }

  const db = createAdminClient()

  const { data: post } = await db
    .from('content_posts')
    .select('id, client_id, image_candidates')
    .eq('id', id)
    .maybeSingle()

  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const row = post as { client_id: string; image_candidates: StockImageCandidate[] | null }

  // The chosen image must come from the stored candidate list. Taking a URL from the
  // request body instead would let any authenticated caller make the server fetch an
  // arbitrary address (SSRF) and publish the result to a client's site.
  const candidate = (row.image_candidates ?? []).find(c => c.id === candidateId)
  if (!candidate) {
    return NextResponse.json({ error: 'That image is not one of this post’s candidates' }, { status: 400 })
  }

  // ── Download ───────────────────────────────────────────────────────────────
  let buffer: Buffer
  let contentType: string
  try {
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(candidate.url, {
        headers: { 'User-Agent': 'client-reporting-dashboard/1.0 (+https://dash.golaunchlocal.com)' },
        signal: ctrl.signal,
        redirect: 'follow',
      })
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Could not download that image (HTTP ${res.status}). It may have been removed at the source.` },
        { status: 502 },
      )
    }

    contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!EXT_BY_TYPE[contentType]) {
      return NextResponse.json(
        { error: `Unsupported image type "${contentType || 'unknown'}"` },
        { status: 415 },
      )
    }

    const bytes = await res.arrayBuffer()
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'That image is larger than 15 MB' }, { status: 413 })
    }
    buffer = Buffer.from(bytes)
  } catch (e) {
    return NextResponse.json(
      { error: `Download failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  // ── Store in our bucket ────────────────────────────────────────────────────
  const filename = `content-images/${row.client_id}/${id}-stock-${Date.now()}.${EXT_BY_TYPE[contentType]}`
  const { error: upErr } = await db.storage
    .from('uploads')
    .upload(filename, buffer, { contentType, upsert: true })

  if (upErr) {
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })
  }

  const { data: { publicUrl } } = db.storage.from('uploads').getPublicUrl(filename)

  // Attribution string kept human-readable and self-contained, so whatever renders it
  // does not need to re-derive the license terms.
  const attribution = candidate.attribution
    ?? [
      candidate.title,
      candidate.creator ? `by ${candidate.creator}` : null,
      candidate.license ? `(CC ${candidate.license.toUpperCase()})` : null,
    ].filter(Boolean).join(' ')

  const { error: updErr } = await db.from('content_posts').update({
    featured_image_url:     publicUrl,
    featured_image_source:  `openverse:${candidate.provider ?? 'unknown'}`,
    featured_image_prompt:  `Stock image — ${attribution}${candidate.sourceUrl ? ` — ${candidate.sourceUrl}` : ''}`,
    image_generation_error: null,
  }).eq('id', id)

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  const adminSession = await getAdminSession()
  logActivity(adminSession, 'updated', 'post', {
    resourceId: id,
    meta: { field: 'featured_image', source: 'openverse', candidateId, license: candidate.license },
  })

  return NextResponse.json({ ok: true, url: publicUrl, attribution })
}
