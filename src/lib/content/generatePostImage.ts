// Shared image generation logic — called by the generate-image API route and
// by the content generate route (auto-gen after post creation).

import { createAdminClient } from '@/lib/supabase/server'
import { updatePostReleasingMediaLink } from '@/lib/content/featuredMediaLink'
import { getDirection, UNIVERSAL_CONSTRAINTS } from '@/lib/content/imageDirections'
import { recordAiUsage } from '@/lib/ai/usage'
import { priceImages } from '@/lib/ai/pricing'
import { searchAndStoreStockCandidates } from '@/lib/content/stockImages'

type PostRow = {
  id:             string
  client_id:      string
  image_concept:  string | null
  seo_title:      string | null
  title:          string | null
  target_keyword: string | null
}

type ClientSettings = {
  services:             string | null
  geographic_focus:     string | null
  content_image_prompt: string | null
}

// Intent → concrete scene direction, so the image reflects the article's angle rather
// than a generic "service work" stock shot.
//
// NONE of these may call for an object that carries writing. The cost/pricing direction
// used to ask for "documents, a calculator, or materials laid out on a work surface",
// which set the prompt against itself: it requested paperwork in frame while the
// constraints forbade text, and the model resolved that by rendering paper covered in
// malformed pseudo-lettering — the single most common and most obviously synthetic
// failure in these images. Screens, signage, packaging, invoices and forms are out for
// the same reason. Where an intent genuinely needs the idea of measurement or planning,
// it is carried by tools and materials instead, which photograph better anyway.
const INTENT_SCENE: Record<string, string> = {
  how_to:           'the task being performed up close — the relevant tools mid-action on the workpiece',
  cost_pricing:     'the materials and equipment the job requires, arranged on a clean work surface — a tape measure and tools conveying estimation, with no paperwork, screens or written matter of any kind',
  comparison:       'two contrasting options or materials placed side by side for comparison, unlabelled',
  faq:              'a clean, approachable establishing shot of the real work environment',
  problem_solution: 'the problem condition shown clearly in context (e.g. the item that needs repair or attention)',
  buyer_education:  'a considered, well-lit detail shot of the product or material being explained, with any branding or labelling out of frame',
  informational:    'an editorial establishing shot of the subject in its real-world setting',
}

// PostRow carries no search_intent, so infer the angle from the title/keyword.
function inferIntentFromTitle(t: string): keyof typeof INTENT_SCENE {
  const s = t.toLowerCase()
  if (/\bhow to\b|\bstep|\bguide\b|\btutorial\b/.test(s))          return 'how_to'
  if (/\b(cost|price|pricing|budget|\$)\b/.test(s))               return 'cost_pricing'
  if (/\bvs\b|\bversus\b|\bcompare|\bcomparison\b/.test(s))        return 'comparison'
  if (s.includes('?'))                                            return 'faq'
  if (/\bsigns?\b|\bproblem|\bfix\b|\brepair|\bavoid\b/.test(s))   return 'problem_solution'
  if (/\bbest\b|\bchoosing|\bchoose|\bbuyer|\btypes? of\b/.test(s)) return 'buyer_education'
  return 'informational'
}

export function buildImagePrompt(
  post: PostRow,
  settings: ClientSettings | null,
  promptOverride?: string,
  directionId?: string | null,
): string {
  const title    = post.seo_title?.trim() || post.title?.trim() || ''
  const keyword  = post.target_keyword?.trim() || ''
  const industry = settings?.services?.split(',')[0]?.trim() || 'local service'
  const location = settings?.geographic_focus?.trim() || ''

  // Derive a concrete subject from what we actually know about the post.
  const subject = post.image_concept?.trim() || keyword || title || `${industry} work`
  const scene   = INTENT_SCENE[inferIntentFromTitle(title || keyword)]
  const context = title ? ` for a blog article titled "${title}"` : ''
  const setting = `real-world ${industry} setting${location ? ` in ${location}` : ''}`

  // Push hard toward a REAL photograph. gpt-image-1 / Imagen default to a glossy, over-lit,
  // oversaturated "AI look"; photojournalistic grounding + an explicit anti-AI negative list
  // (the visual equivalent of the banned-phrase list for copy) counters it.
  // Style comes from the chosen direction. It used to be hardcoded photojournalism, which
  // silently contradicted any non-photographic request — see lib/content/imageDirections.ts.
  const direction = getDirection(directionId)
  const realism   = direction.style
  const avoid = direction.avoid
  // Text and people are the two things these models get visibly wrong, so both are
  // stated first (models weight early instruction most heavily), in absolute terms,
  // and repeated in the negative list rather than mentioned once in passing.
  //
  // TEXT: image models render text as malformed pseudo-lettering. Any signage, label
  // or UI in frame is a giveaway that the picture is synthetic, and it cannot be
  // corrected after the fact.
  //
  // PEOPLE: the previous wording banned only "human faces", which still permitted
  // full bodies — and bodies are where the tells are (extra fingers, broken limbs,
  // impossible posture). The subject of these articles is the work and the equipment,
  // so people are almost never necessary; where the scene genuinely requires a human
  // (a task being demonstrated), hands and forearms alone carry it.
  const constraints = UNIVERSAL_CONSTRAINTS

  if (promptOverride?.trim()) {
    // Client creative direction leads; post context anchors it to the topic, and the
    // realism + anti-AI direction still applies so their brief doesn't come back looking AI.
    // Order matters: the STYLE leads, then the reviewer's direction, then the subject. The
    // old form opened with "Candid documentary photograph" regardless, so a request for a
    // vector illustration contradicted itself in its first three words and the model resolved
    // it by ignoring the direction.
    return `${realism} Subject${context}: "${subject}" in a ${setting}. Creative direction: ${promptOverride.trim()}. ${avoid} ${constraints}`
  }

  return `${realism} Scene${context}: ${scene}, showing "${subject}", in a ${setting}. ${avoid} ${constraints}`
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
  /** Art direction id from lib/content/imageDirections. Omitted = documentary. */
  directionId?: string | null,
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
    .select('services, geographic_focus, content_image_prompt')
    .eq('client_id', post.client_id)
    .maybeSingle()

  const imagePrompt = promptOverride ?? (clientSettings as ClientSettings | null)?.content_image_prompt ?? undefined
  const prompt = buildImagePrompt(post, clientSettings as ClientSettings | null, imagePrompt, directionId)

  // ── Stock alternatives, searched with the SAME context as the AI prompt ─────
  // Runs alongside generation rather than instead of it, so the reviewer always has
  // both options. Started here and awaited before every return: Openverse is a
  // third-party API on anonymous rate limits and must never delay the AI call, but a
  // serverless instance is frozen once the handler resolves, so an un-awaited promise
  // would simply be dropped and nothing would be written.
  const candidatesPromise = searchAndStoreStockCandidates(db, postId, {
    targetKeyword: post.target_keyword,
    imageConcept:  post.image_concept,
    title:         post.seo_title ?? post.title,
    // Stripped from the query: no stock library indexes a service area, so those tokens
    // either match nothing or match something unrelated that shares a word.
    geographicFocus: (clientSettings as ClientSettings | null)?.geographic_focus ?? null,
    // Anchors the query on the post's actual subject — see buildQueryLadder.
    services:        (clientSettings as ClientSettings | null)?.services ?? null,
  })

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
        // Billed per image, not per token, so the ledger records units and prices through
        // priceImages. Only a successful generation is charged.
        await recordAiUsage({
          provider: 'openai',
          model:    'gpt-image-1',
          operation: 'image',
          units:    1,
          costUsd:  priceImages('gpt-image-1', 1),
          clientId: String(post.client_id ?? '') || null,
          postId,
        })
        const data = await dalleRes.json() as { data?: { b64_json?: string; url?: string }[] }
        const item = data.data?.[0]
        if (item?.b64_json) {
          // gpt-image-1 returns base64 — decode and upload to Supabase directly
          const buffer   = Buffer.from(item.b64_json, 'base64')
          const filename = `content-images/${post.client_id}/${postId}-ai-${Date.now()}.png`
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
          const filename = `content-images/${post.client_id}/${postId}-ai-${Date.now()}.png`
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

  // Settle the stock search before ANY return. On a serverless runtime the function
  // instance is frozen once the handler resolves, so an un-awaited promise is simply
  // dropped and image_candidates would never be written. It matters most on exactly
  // this path: when AI generation fails, the stock options are all the reviewer has.
  await candidatesPromise

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
        const filename = `content-images/${post.client_id}/${postId}-ai-${Date.now()}.png`
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

  await updatePostReleasingMediaLink(db, postId, {
    featured_image_url:     finalUrl,
    featured_image_prompt:  prompt,
    featured_image_source:  'ai_generated',
    image_generation_error: null,
  })

  return { ok: true, url: finalUrl, prompt, provider: usedProvider }
}
