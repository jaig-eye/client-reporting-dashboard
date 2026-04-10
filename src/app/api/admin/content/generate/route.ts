import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

/**
 * POST /api/admin/content/generate
 *
 * Uses the agency-configured AI model to generate blog post content.
 * Supports Anthropic (Claude) and OpenAI-compatible providers.
 *
 * Returns: { title, content, metaDescription, slug }
 */

const SYSTEM_PROMPT = (agency: string) => `\
You are a professional SEO content writer for ${agency}.

Your writing demonstrates E-E-A-T (Experience, Expertise, Authority, Trustworthiness):
- Experience: include real-world examples, scenarios, or case studies
- Expertise: demonstrate deep knowledge of the subject
- Authority: use confident, well-supported statements
- Trustworthiness: be accurate, transparent, and avoid clickbait

SEO guidelines:
- Use the focus keyword naturally in the H1, first paragraph, and 2–3 subheadings
- Structure content with H2/H3 subheadings for scannability
- Include a compelling meta description (150–160 characters) that contains the primary keyword
- Suggest a clean URL slug (lowercase, hyphens only, no stop words)
- Write introduction paragraphs that hook the reader and include the primary keyword early
- End with a clear call-to-action relevant to the business

Formatting:
- Return valid HTML for the content body (use <h2>, <h3>, <p>, <ul>, <ol>, <strong> tags)
- Do NOT include <html>, <head>, or <body> tags — just the inner content
- Paragraphs should be concise (3–5 sentences max)

Return ONLY a JSON object with exactly these four fields:
{
  "title": "The post title (H1 equivalent, includes primary keyword)",
  "content": "Full HTML post body (h2, h3, p, ul, strong tags as needed)",
  "metaDescription": "SEO meta description, 150–160 characters, includes primary keyword",
  "slug": "url-friendly-slug"
}
Do not include markdown fences or any text outside the JSON object.`

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (!isAdminAuthed(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { prompt } = body

  if (!prompt) {
    return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data: settings } = await db
    .from('agency_settings')
    .select('ai_provider, ai_model, ai_api_key, agency_name')
    .single()

  if (!settings?.ai_api_key) {
    return NextResponse.json({ error: 'AI not configured. Add an API key in Agency Settings.' }, { status: 400 })
  }

  const provider = settings.ai_provider || 'anthropic'
  const model    = settings.ai_model || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = settings.ai_api_key
  const agency   = settings.agency_name || 'the agency'

  function parseResponse(rawText: string) {
    // Strip markdown code fences if present
    const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { title: '', content: rawText, metaDescription: '', slug: '' }
    try {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        title:           String(parsed.title           || ''),
        content:         String(parsed.content         || rawText),
        metaDescription: String(parsed.metaDescription || ''),
        slug:            String(parsed.slug            || ''),
      }
    } catch {
      return { title: '', content: rawText, metaDescription: '', slug: '' }
    }
  }

  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT(agency),
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`AI API error: ${text}`)
      }

      const data = await res.json()
      const textBlock = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
      return NextResponse.json(parseResponse(textBlock?.text || ''))
    }

    // OpenAI-compatible fallback
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT(agency) },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`AI API error: ${text}`)
    }

    const data = await res.json()
    return NextResponse.json(parseResponse(data.choices?.[0]?.message?.content || ''))

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
