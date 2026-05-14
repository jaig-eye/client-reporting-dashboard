// POST /api/admin/content/posts/[id]/generate-image
// Generates a featured image for a post using DALL-E 3 (primary)
// or Gemini Imagen 3 (fallback if GEMINI_API_KEY is set).
// Downloads the result and stores it in Supabase Storage (uploads bucket).

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

type PostRow = {
  id: string
  client_id: string
  image_concept: string | null
  seo_title: string | null
  title: string | null
  target_keyword: string | null
}

type ClientSettings = {
  services: string | null
  geographic_focus: string | null
}

type AgencyRow = {
  openai_api_key: string | null
  ai_provider: string | null
}

function buildImagePrompt(post: PostRow, settings: ClientSettings | null): string {
  const concept   = post.image_concept?.trim()
  const keyword   = post.target_keyword?.trim()
  const service   = settings?.services?.split(',')[0]?.trim() ?? 'local service'
  const location  = settings?.geographic_focus?.trim() ?? ''

  const subject = concept || `${keyword ?? 'professional service'} in ${location || 'a local area'}`

  return [
    `Professional, clean blog header image for a local ${service} business.`,
    subject + '.',
    'Natural lighting, photorealistic, no text overlays, no visible people faces.',
    'Style: modern, trustworthy, high-quality local business photography.',
    'Wide landscape format.',
  ].join(' ')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createAdminClient()

  const [postRes, agencyRes] = await Promise.all([
    db.from('content_posts')
      .select('id, client_id, image_concept, seo_title, title, target_keyword')
      .eq('id', id)
      .single(),
    db.from('agency_settings')
      .select('openai_api_key, ai_provider')
      .single(),
  ])

  if (postRes.error || !postRes.data)
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const post     = postRes.data as PostRow
  const agency   = agencyRes.data as AgencyRow | null

  const { data: settingsData } = await db
    .from('content_settings')
    .select('services, geographic_focus')
    .eq('client_id', post.client_id)
    .maybeSingle()

  const prompt = buildImagePrompt(post, settingsData as ClientSettings | null)

  // ── Try DALL-E 3 ────────────────────────────────────────────────────────────
  const openaiKey = agency?.openai_api_key ?? process.env.OPENAI_API_KEY
  let imageUrl: string | null = null
  let usedProvider = ''

  if (openaiKey) {
    try {
      const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size: '1792x1024',
          quality: 'standard',
          style: 'natural',
        }),
      })
      if (dalleRes.ok) {
        const dalleData = await dalleRes.json() as { data?: { url?: string }[] }
        imageUrl = dalleData.data?.[0]?.url ?? null
        if (imageUrl) usedProvider = 'dalle3'
      }
    } catch {
      // fall through to Gemini
    }
  }

  // ── Try Gemini Imagen 3 fallback ─────────────────────────────────────────────
  if (!imageUrl && process.env.GEMINI_API_KEY) {
    try {
      const gemRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: '16:9' },
          }),
        }
      )
      if (gemRes.ok) {
        const gemData = await gemRes.json() as { predictions?: { bytesBase64Encoded?: string }[] }
        const b64 = gemData.predictions?.[0]?.bytesBase64Encoded
        if (b64) {
          // Gemini returns base64 bytes — upload directly
          const buffer = Buffer.from(b64, 'base64')
          const filename = `content-images/${post.client_id}/${post.id}-ai.png`
          const { error: upErr } = await db.storage
            .from('uploads')
            .upload(filename, buffer, { contentType: 'image/png', upsert: true })
          if (!upErr) {
            const { data: { publicUrl } } = db.storage.from('uploads').getPublicUrl(filename)
            imageUrl = publicUrl
            usedProvider = 'gemini'
          }
        }
      }
    } catch {
      // no fallback left
    }
  }

  if (!imageUrl)
    return NextResponse.json({ error: 'Image generation failed — configure OPENAI_API_KEY or GEMINI_API_KEY' }, { status: 422 })

  // ── If DALL-E returned a temp URL, download and re-upload to Supabase ────────
  let finalUrl = imageUrl
  if (usedProvider === 'dalle3') {
    try {
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) })
      if (imgRes.ok) {
        const buffer   = Buffer.from(await imgRes.arrayBuffer())
        const filename = `content-images/${post.client_id}/${post.id}-ai.png`
        const { error: upErr } = await db.storage
          .from('uploads')
          .upload(filename, buffer, { contentType: 'image/png', upsert: true })
        if (!upErr) {
          const { data: { publicUrl } } = db.storage.from('uploads').getPublicUrl(filename)
          finalUrl = publicUrl
        }
      }
    } catch {
      // keep temp URL — will expire but better than nothing
    }
  }

  await db.from('content_posts').update({
    featured_image_url:    finalUrl,
    featured_image_prompt: prompt,
    featured_image_source: 'ai_generated',
    image_generation_error: null,
  }).eq('id', id)

  return NextResponse.json({ url: finalUrl, prompt, provider: usedProvider })
}
