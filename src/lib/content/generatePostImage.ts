// Shared image generation logic — called by the generate-image API route and
// by the content generate route (auto-gen after post creation).

import { createAdminClient } from '@/lib/supabase/server'

type PostRow = {
  id:             string
  client_id:      string
  image_concept:  string | null
  seo_title:      string | null
  title:          string | null
  target_keyword: string | null
}

type ClientSettings = {
  services:          string | null
  geographic_focus:  string | null
}

export function buildImagePrompt(
  post: PostRow,
  settings: ClientSettings | null,
  promptOverride?: string,
): string {
  if (promptOverride?.trim()) return promptOverride.trim()

  const concept  = post.image_concept?.trim()
  const keyword  = post.target_keyword?.trim()
  const service  = settings?.services?.split(',')[0]?.trim() ?? 'local service'
  const location = settings?.geographic_focus?.trim() ?? ''

  const subject = concept || `${keyword ?? 'professional service'} in ${location || 'a local area'}`

  return [
    `Professional, clean blog header image for a local ${service} business.`,
    subject + '.',
    'Natural lighting, photorealistic, no text overlays, no visible people faces.',
    'Style: modern, trustworthy, high-quality local business photography.',
    'Wide landscape format.',
  ].join(' ')
}

export type ImageGenResult =
  | { ok: true;  url: string; prompt: string; provider: string }
  | { ok: false; error: string }

/**
 * Generate a featured image for a post and write the result back to the DB.
 * Pass `openaiKey` from agency_settings.openai_api_key (or env fallback).
 */
export async function generatePostImage(
  db: ReturnType<typeof createAdminClient>,
  postId: string,
  openaiKey: string | null | undefined,
  promptOverride?: string,
): Promise<ImageGenResult> {
  const postRes = await db.from('content_posts')
    .select('id, client_id, image_concept, seo_title, title, target_keyword')
    .eq('id', postId)
    .single()

  if (postRes.error || !postRes.data)
    return { ok: false, error: 'Post not found' }

  const post = postRes.data as PostRow

  const { data: clientSettings } = await db
    .from('content_settings')
    .select('services, geographic_focus')
    .eq('client_id', post.client_id)
    .maybeSingle()

  const prompt = buildImagePrompt(post, clientSettings as ClientSettings | null, promptOverride)

  const effectiveKey = openaiKey ?? process.env.OPENAI_API_KEY
  let imageUrl: string | null = null
  let usedProvider = ''
  let lastError = ''

  // ── OpenAI Image Generation (gpt-image-1) ───────────────────────────────────
  if (effectiveKey) {
    try {
      const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${effectiveKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt,
          n: 1,
          size: '1536x1024',
          quality: 'medium',
        }),
      })
      if (dalleRes.ok) {
        const data = await dalleRes.json() as { data?: { b64_json?: string; url?: string }[] }
        const item = data.data?.[0]
        if (item?.b64_json) {
          // gpt-image-1 returns base64 — decode and upload to Supabase directly
          const buffer   = Buffer.from(item.b64_json, 'base64')
          const filename = `content-images/${post.client_id}/${postId}-ai.png`
          const { error: upErr } = await db.storage
            .from('uploads')
            .upload(filename, buffer, { contentType: 'image/png', upsert: true })
          if (!upErr) {
            const { data: { publicUrl } } = db.storage.from('uploads').getPublicUrl(filename)
            imageUrl     = publicUrl
            usedProvider = 'gpt-image-1'
          } else {
            lastError = `Storage upload failed: ${upErr.message}`
          }
        } else if (item?.url) {
          imageUrl     = item.url
          usedProvider = 'gpt-image-1'
        }
      } else {
        const errData = await dalleRes.json().catch(() => ({})) as { error?: { message?: string } }
        lastError = `DALL-E error (${dalleRes.status}): ${errData?.error?.message ?? dalleRes.statusText}`
      }
    } catch (e) {
      lastError = `DALL-E request failed: ${e instanceof Error ? e.message : String(e)}`
    }
  } else {
    lastError = 'No OpenAI API key configured — add it in Agency Settings → AI → Image Generation'
  }

  // ── Gemini Imagen 3 fallback ────────────────────────────────────────────────
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
          const buffer   = Buffer.from(b64, 'base64')
          const filename = `content-images/${post.client_id}/${postId}-ai.png`
          const { error: upErr } = await db.storage
            .from('uploads')
            .upload(filename, buffer, { contentType: 'image/png', upsert: true })
          if (!upErr) {
            const { data: { publicUrl } } = db.storage.from('uploads').getPublicUrl(filename)
            imageUrl = publicUrl
            usedProvider = 'gemini'
          }
        }
      } else {
        const errData = await gemRes.json().catch(() => ({})) as { error?: { message?: string } }
        lastError = `Gemini error (${gemRes.status}): ${errData?.error?.message ?? gemRes.statusText}`
      }
    } catch (e) {
      lastError = `Gemini request failed: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  if (!imageUrl)
    return { ok: false, error: lastError || 'Image generation failed — configure an API key in Agency Settings → AI → Image Generation' }

  // gpt-image-1 responses are already uploaded to Supabase above (b64_json path).
  // If a temp URL was returned (url path), download and re-upload so it doesn't expire.
  let finalUrl = imageUrl
  if (usedProvider === 'gpt-image-1' && imageUrl && !imageUrl.includes('supabase')) {
    try {
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) })
      if (imgRes.ok) {
        const buffer   = Buffer.from(await imgRes.arrayBuffer())
        const filename = `content-images/${post.client_id}/${postId}-ai.png`
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
    featured_image_url:     finalUrl,
    featured_image_prompt:  prompt,
    featured_image_source:  'ai_generated',
    image_generation_error: null,
  }).eq('id', postId)

  return { ok: true, url: finalUrl, prompt, provider: usedProvider }
}
