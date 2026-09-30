// Shared image generation logic — called by the generate-image API route (a reviewer's
// regenerate) and in the background by the blog and service-area generate routes.

import { createAdminClient } from '@/lib/supabase/server'
import { updatePostReleasingMediaLink } from '@/lib/content/featuredMediaLink'
import { getDirection, UNIVERSAL_CONSTRAINTS } from '@/lib/content/imageDirections'
import { recordAiUsage } from '@/lib/ai/usage'
import { priceImages, priceImageUsage, type ImageUsage } from '@/lib/ai/pricing'
import { searchAndStoreStockCandidates } from '@/lib/content/stockImages'
import { IMAGE_MODELS, IMAGE_REQUEST, DEFAULT_IMAGE_MODEL, resolveImageModel } from '@/lib/content/imageModels'
import { splitPhrases } from '@/lib/content/phrases'

/** OpenAI's own ceiling for a slow generation, "up to 2 minutes" — see the call below. */
const OPENAI_TIMEOUT_MS = 120_000

/** Less than OpenAI: the fallback can start after OpenAI has used its full two minutes. */
const GEMINI_TIMEOUT_MS = 60_000

/** AbortSignal.timeout rejects with a DOMException named TimeoutError. */
function isTimeout(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'TimeoutError'
}

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

/**
 * The same seven intents, said the way a person describes a photograph.
 *
 * INTENT_SCENE above is written for an image MODEL: it carries negatives ("no paperwork,
 * screens or written matter of any kind"), parentheticals and staging notes. None of that
 * belongs in something a screen reader announces aloud, so the alt text gets its own short
 * phrase per intent rather than reusing the prompt.
 */
const INTENT_ALT: Record<string, string> = {
  how_to:           'the task being carried out, tools in hand',
  cost_pricing:     'the materials and equipment the job needs, laid out on a work surface',
  comparison:       'two options placed side by side for comparison',
  faq:              'the work environment',
  problem_solution: 'the problem shown in context',
  buyer_education:  'a close detail shot of the product being explained',
  informational:    'the subject in its real-world setting',
}

/** "an auto repair setting", not "a auto repair setting" — this one gets read aloud. */
function article(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? 'an' : 'a'
}

/**
 * The industry and place both the prompt and the alt text situate the picture in: the first
 * service and the first (primary) service area.
 *
 * Both lists are read with splitPhrases, the way the chip input wrote them. Cutting services on
 * the first comma turned "gutter guards (mesh, micro-mesh)" into "gutter guards (mesh", and the
 * whole geographic_focus string put every service area into one sentence the picture is "in" —
 * "in Melbourne, FL, Palm Bay, FL, Cocoa, FL" — which reads badly aloud as alt text.
 */
function describeSetting(settings: ClientSettings | null): { industry: string; location: string } {
  return {
    industry: splitPhrases(settings?.services)[0] || 'local service',
    location: splitPhrases(settings?.geographic_focus)[0] || '',
  }
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
  const { industry, location } = describeSetting(settings)

  // Derive a concrete subject from what we actually know about the post.
  const subject = post.image_concept?.trim() || keyword || title || `${industry} work`
  const scene   = INTENT_SCENE[inferIntentFromTitle(title || keyword)]
  const context = title ? ` for a blog article titled "${title}"` : ''
  const setting = `real-world ${industry} setting${location ? ` in ${location}` : ''}`

  // Push hard toward a REAL photograph. Image models default to a glossy, over-lit,
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

/**
 * Alt text for a generated featured image.
 *
 * Describes the PICTURE, not the article — those are different jobs and the post title is
 * already doing the second one.
 *
 * The first version of this leaned on `image_concept` for the description and fell back to the
 * bare target keyword. Nothing in this codebase ever writes image_concept, so the fallback was
 * the only branch that ran and every generated image shipped with exact-match keyword-only alt
 * text: the canonical form of image keyword stuffing, and no use whatsoever to somebody
 * listening to it. It was a downgrade on the post title it replaced.
 *
 * So the description now comes from what the prompt actually ASKED FOR, which is the one thing
 * we reliably know about the picture. The keyword follows the description instead of being it,
 * and is dropped when the description already carries it. With nothing to describe, this
 * returns empty and the approve route falls back to the post title — a sentence a person
 * wrote, which beats a keyword every time.
 *
 * Kept under ~125 characters: screen readers read it aloud in full, and a paragraph of alt text
 * is worse than none.
 */
function buildAltText(
  post: { image_concept?: string | null; title?: string | null; seo_title?: string | null },
  keyword: string,
  /** What the prompt put in frame — see INTENT_ALT. */
  depiction?: string,
): string {
  const concept = post.image_concept?.trim() || ''
  const title   = (post.title || post.seo_title || '').trim()

  const shown = concept || (depiction ?? '').trim()
  if (!shown) return ''

  const lead    = shown.charAt(0).toUpperCase() + shown.slice(1)
  const subject = keyword || title
  const text = subject && !shown.toLowerCase().includes(subject.toLowerCase())
    ? `${lead} — ${subject}`
    : lead

  return text.length > 125 ? `${text.slice(0, 122).trimEnd()}…` : text
}

export type ImageGenResult =
  | { ok: true;  url: string; prompt: string; provider: string }
  | { ok: false; error: string }

/**
 * Generate a featured image for a post and write the result back to the DB — the image on
 * success, the reason in image_generation_error on failure.
 * Pass `openaiKey` from agency_settings.openai_api_key; null falls back to OPENAI_API_KEY.
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
    .maybeSingle()

  // Nothing to record the failure on.
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

  // The same derivation the prompt uses, in words fit to be read aloud. Built here rather than
  // inside buildAltText so both descriptions of this picture come from one place and cannot
  // drift apart — the alt text has to describe the image we actually asked for.
  const { industry: altIndustry, location: altLocation } = describeSetting(clientSettings as ClientSettings | null)
  const altIntent    = inferIntentFromTitle(post.seo_title?.trim() || post.title?.trim() || post.target_keyword?.trim() || '')
  const altDepiction = `${INTENT_ALT[altIntent]}, in ${article(altIndustry)} ${altIndustry} setting${altLocation ? ` in ${altLocation}` : ''}`

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
  // One entry per provider that was tried and did not produce an image, in order. Kept rather
  // than overwritten, so a fallback's failure cannot hide why the primary failed.
  const failures: string[] = []

  // Which model. Every model on offer takes the same arguments (IMAGE_REQUEST) plus its own quality
  // (IMAGE_MODELS), so this is a bare swap. A stored value that is no longer offered — the retired gpt-image-1 or dall-e-3 included —
  // resolves to the default rather than being sent to an API that no longer serves it.
  const chosenModel = await (async () => {
    try {
      const { data, error } = await db.from('agency_settings').select('image_model').maybeSingle()
      // Column absent (migration 227 not applied) or unreadable: use the default.
      if (error) return DEFAULT_IMAGE_MODEL
      return resolveImageModel((data as { image_model?: unknown } | null)?.image_model)
    } catch { return DEFAULT_IMAGE_MODEL }
  })()

  // ── OpenAI image generation ─────────────────────────────────────────────────
  if (effectiveKey) {
    try {
      const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${effectiveKey}`,
        },
        body: JSON.stringify({ model: chosenModel, prompt, n: 1, ...IMAGE_REQUEST, quality: IMAGE_MODELS[chosenModel].quality }),
        // OpenAI documents complex prompts taking "up to 2 minutes"
        // (https://developers.openai.com/api/docs/guides/image-generation#limitations). Without a
        // bound, a hung request holds the function until the platform kills it, and nothing after
        // this point — the stock search it awaits, the error it would record — ever runs.
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      })
      if (imageRes.ok) {
        const data = await imageRes.json().catch(() => null) as
          { data?: { b64_json?: string }[]; usage?: ImageUsage } | null

        // These models bill per token, split by modality, and the response says how many were
        // used — so the cost comes from that, not a flat per-image figure. The flat estimate is
        // only for a response that omits usage (the API reference marks it optional). Recorded
        // for any 2xx: OpenAI has charged for it whether or not the image then reaches storage.
        const usage = data?.usage
        await recordAiUsage({
          provider:     'openai',
          model:        chosenModel,
          operation:    'image',
          units:        1,
          inputTokens:  usage?.input_tokens,
          outputTokens: usage?.output_tokens,
          costUsd:      priceImageUsage(chosenModel, usage) ?? priceImages(chosenModel, 1),
          clientId:     String(post.client_id ?? '') || null,
          postId,
        })

        // GPT image models only ever answer with base64; there is no URL form to fall back to.
        const b64 = data?.data?.[0]?.b64_json

        if (b64) {
          const buffer   = Buffer.from(b64, 'base64')
          const filename = `content-images/${post.client_id}/${postId}-ai-${Date.now()}.png`
          const { error: upErr } = await db.storage
            .from('uploads')
            .upload(filename, buffer, { contentType: 'image/png', upsert: true })
          if (!upErr) {
            const { data: { publicUrl } } = db.storage.from('uploads').getPublicUrl(filename)
            imageUrl     = publicUrl
            usedProvider = chosenModel
          } else {
            failures.push(`The ${chosenModel} image could not be saved: ${upErr.message}`)
          }
        } else {
          failures.push(`OpenAI ${chosenModel} answered without an image`)
        }
      } else {
        const errData = await imageRes.json().catch(() => ({})) as { error?: { message?: string } }
        failures.push(`OpenAI ${chosenModel} failed (${imageRes.status}): ${errData?.error?.message ?? imageRes.statusText}`)
      }
    } catch (e) {
      failures.push(isTimeout(e)
        ? `OpenAI ${chosenModel} did not answer within ${OPENAI_TIMEOUT_MS / 1000}s`
        : `OpenAI ${chosenModel} could not be reached: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    failures.push('No OpenAI API key — add one in Settings → AI → Image Generation')
  }

  // ── Gemini Imagen fallback ──────────────────────────────────────────────────
  // KNOWN DEAD: Google has shut Imagen down in the Gemini API ("Imagen models are shut down. Use
  // Nano Banana for image generation." — https://ai.google.dev/gemini-api/docs/imagen), so this
  // call now fails and its reason is recorded after OpenAI's. The replacement (gemini-*-image via
  // :generateContent) takes a different request and returns the image as a content part, so it is
  // a port, not a model-id swap.
  //
  // The key travels in the x-goog-api-key header, not the query string: a URL is what request
  // logs, proxies and error messages record.
  if (!imageUrl && process.env.GEMINI_API_KEY) {
    try {
      const gemRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict',
        {
          method: 'POST',
          headers: {
            'Content-Type':   'application/json',
            'x-goog-api-key': process.env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: '16:9' },
          }),
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        }
      )
      if (gemRes.ok) {
        const gemData = await gemRes.json().catch(() => null) as { predictions?: { bytesBase64Encoded?: string }[] } | null
        const b64 = gemData?.predictions?.[0]?.bytesBase64Encoded
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
          } else {
            failures.push(`The Gemini fallback image could not be saved: ${upErr.message}`)
          }
        } else {
          failures.push('Gemini fallback answered without an image')
        }
      } else {
        const errData = await gemRes.json().catch(() => ({})) as { error?: { message?: string } }
        failures.push(`Gemini fallback failed (${gemRes.status}): ${errData?.error?.message ?? gemRes.statusText}`)
      }
    } catch (e) {
      failures.push(isTimeout(e)
        ? `Gemini fallback did not answer within ${GEMINI_TIMEOUT_MS / 1000}s`
        : `Gemini fallback could not be reached: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Settle the stock search before ANY return. On a serverless runtime the function
  // instance is frozen once the handler resolves, so an un-awaited promise is simply
  // dropped and image_candidates would never be written. It matters most on exactly
  // this path: when AI generation fails, the stock options are all the reviewer has.
  await candidatesPromise

  if (!imageUrl)
    return { ok: false, error: await recordImageFailure(db, postId, failures.join(' · ') || 'Image generation failed') }

  // Both providers hand back bytes, and both paths above upload them before setting imageUrl, so
  // it is always our own storage URL — never a provider-hosted link that expires.
  const { error: saveErr } = await updatePostReleasingMediaLink(db, postId, {
    featured_image_url:     imageUrl,
    featured_image_prompt:  prompt,
    featured_image_source:  'ai_generated',
    // Cleared here, on the only path that produced an image, so a reason recorded by an earlier
    // failed attempt does not outlive the image that replaced it.
    image_generation_error: null,
    // Written at generation because this is the only point where what the picture SHOWS is
    // known — the prompt describes it, and nobody is going to come back and describe it
    // again by hand. It is what WordPress receives as alt_text on upload, which is what
    // screen readers announce and what image search indexes.
    image_alt_text:         buildAltText(post, post.target_keyword?.trim() || '', altDepiction),
  })

  // The picture exists in storage but the post does not point at it, so as far as anyone reading
  // the post can tell there is no image. Reporting success here would show the reviewer a URL that
  // is gone on the next reload.
  if (saveErr)
    return { ok: false, error: await recordImageFailure(db, postId, `The image was generated but could not be attached to the post: ${saveErr.message}`) }

  return { ok: true, url: imageUrl, prompt, provider: usedProvider }
}

/** Long enough for a provider's own explanation; short enough to read at a glance. */
const MAX_REASON_CHARS = 300

/**
 * Leave the reason on the post when no image came out of a run, and return it.
 *
 * Two of the three callers start this in the background, where nobody sees what it returns (the
 * blog route discards it outright) — so a post written by the pipeline used to ship with no
 * featured image and nothing on it saying why.
 * content_posts.image_generation_error (migration 108) is where that goes. It is only a trace: the
 * featured image already on the post, if any, is left alone, so a failed regenerate never costs a
 * working picture.
 */
async function recordImageFailure(
  db: ReturnType<typeof createAdminClient>,
  postId: string,
  reason: string,
): Promise<string> {
  const short = reason.length > MAX_REASON_CHARS ? `${reason.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…` : reason
  console.warn(`[generatePostImage] no image for post ${postId}: ${short}`)
  const { error } = await db.from('content_posts').update({ image_generation_error: short }).eq('id', postId)
  if (error) console.warn(`[generatePostImage] could not record the failure on post ${postId}: ${error.message}`)
  return short
}
