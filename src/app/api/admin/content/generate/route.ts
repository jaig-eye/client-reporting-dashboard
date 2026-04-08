import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

/**
 * POST /api/admin/content/generate
 *
 * Uses the agency-configured AI model to generate blog post content.
 * Currently supports Anthropic (Claude) API.
 */
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

  const provider = settings.ai_provider || 'openai'
  const model    = settings.ai_model || 'gpt-4o'
  const apiKey   = settings.ai_api_key
  const agency   = settings.agency_name || 'the agency'

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
          system: `You are a professional content writer for ${agency}. Write engaging, SEO-optimized blog posts. Return your response as JSON with two fields: "title" (the post title) and "content" (the full HTML post body with proper heading tags, paragraphs, and formatting).`,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`AI API error: ${text}`)
      }

      const data = await res.json()
      const textBlock = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
      const rawText = textBlock?.text || ''

      // Parse JSON from the response
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return NextResponse.json({
          title:   parsed.title || '',
          content: parsed.content || rawText,
        })
      }

      return NextResponse.json({ title: '', content: rawText })
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
          { role: 'system', content: `You are a professional content writer for ${agency}. Write engaging, SEO-optimized blog posts. Return your response as JSON with two fields: "title" and "content" (HTML).` },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`AI API error: ${text}`)
    }

    const data = await res.json()
    const rawText = data.choices?.[0]?.message?.content || ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return NextResponse.json({ title: parsed.title || '', content: parsed.content || rawText })
    }
    return NextResponse.json({ title: '', content: rawText })

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
