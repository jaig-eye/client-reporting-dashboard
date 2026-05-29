// POST /api/admin/content/generate-brand-dna
// Fetches a client's website and uses AI to auto-fill Brand DNA + E-E-A-T fields.
// Body: { client_id: string, site_url?: string }

import { NextRequest, NextResponse } from 'next/server'
import { cookies }                   from 'next/headers'
import { createAdminClient }         from '@/lib/supabase/server'
import { isAdminAuthed }             from '@/lib/auth'

export const maxDuration = 60

interface BrandDnaResult {
  // Brand DNA (always returned)
  business_background: string
  services:            string
  target_audience:     string
  geographic_focus:    string
  brand_voice:         string
  // E-E-A-T signals (omitted if not found on site)
  years_in_business?:      string
  review_count?:           string
  licenses?:               string
  insurance?:              string
  awards?:                 string
  owner_details?:          string
  team_experience?:        string
  guarantees?:             string
  brands_used?:            string
  financing_options?:      string
  warranties?:             string
  emergency_availability?: boolean
  case_studies?:           string
  before_after_proof?:     string
  common_objections?:      string
  // Suggested CTAs
  cta_list?:               string
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BrandAnalyzer/1.0)' },
    })
    if (!res.ok) return ''
    const html = await res.text()
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 2000)
  } catch {
    return ''
  }
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { client_id: string; site_url?: string }
  const { client_id } = body
  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()

  // Resolve site_url — from body or WordPress connection
  let siteUrl = body.site_url?.trim()
  if (!siteUrl) {
    const { data: conn } = await db
      .from('client_connections')
      .select('connector:connectors!inner(config)')
      .eq('client_id', client_id)
      .eq('connectors.type', 'wordpress')
      .eq('status', 'active')
      .maybeSingle()
    const config = (conn as unknown as { connector: { config: { site_url?: string } } } | null)?.connector?.config
    siteUrl = config?.site_url?.trim()
  }

  if (!siteUrl) {
    return NextResponse.json({ error: 'site_url_required' }, { status: 422 })
  }

  if (!/^https?:\/\//i.test(siteUrl)) siteUrl = `https://${siteUrl}`
  const base = siteUrl.replace(/\/$/, '')

  // Fetch homepage + about + services + contact for full context
  const [home, about, services, contact] = await Promise.all([
    fetchPageText(base),
    fetchPageText(`${base}/about`),
    fetchPageText(`${base}/services`),
    fetchPageText(`${base}/contact`),
  ])
  const content = [home, about, services, contact].filter(Boolean).join('\n\n').slice(0, 6000)

  if (!content.trim()) {
    return NextResponse.json({ error: 'Could not fetch website content. Check the URL and try again.' }, { status: 422 })
  }

  // Load AI credentials from agency_settings
  const { data: settings } = await db
    .from('agency_settings')
    .select('ai_provider, ai_model, ai_api_key')
    .single()

  const provider = (settings?.ai_provider as string | null) || 'anthropic'
  const model    = (settings?.ai_model    as string | null) || (provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini')
  const apiKey   = settings?.ai_api_key as string | null

  if (!apiKey) {
    return NextResponse.json({ error: 'AI not configured — add an API key in Agency Settings' }, { status: 400 })
  }

  const prompt = `Analyze the following website content and return a JSON object with the keys below.
Return ONLY valid JSON — no markdown fences, no explanation.

Required keys (always include these):
{
  "business_background": "1–3 sentences describing what this business does and who it serves",
  "services": "comma-separated list of the main services or products offered",
  "target_audience": "describe the typical customer (e.g. homeowners in Dallas, small business owners)",
  "geographic_focus": "primary city, region, or state served — or 'nationwide' if applicable",
  "brand_voice": "2–4 words describing the tone (e.g. professional and trustworthy, friendly and approachable)"
}

Optional trust & credibility keys — include only if the information is clearly stated on the site. Do NOT guess or invent values. Omit keys you cannot confidently determine:
{
  "years_in_business": "number of years or a phrase like 'Since 2008' or '15+ years'",
  "review_count": "e.g. '200+ Google reviews, 4.9 stars' or '500 five-star reviews'",
  "licenses": "license types, numbers, or certifications mentioned (e.g. 'Licensed & Insured, TX #12345')",
  "insurance": "insurance or bonding information mentioned",
  "awards": "any awards, recognitions, or 'Best of' mentions",
  "owner_details": "owner or founder name and brief background if mentioned",
  "team_experience": "team size or collective experience mentioned (e.g. '30+ years combined experience')",
  "guarantees": "any service guarantees or satisfaction promises",
  "brands_used": "notable product brands, equipment, or materials used",
  "financing_options": "financing or payment plan options offered",
  "warranties": "warranty terms mentioned",
  "emergency_availability": true if 24/7 availability or emergency service is mentioned (boolean),
  "case_studies": "notable projects, success stories, or case studies mentioned",
  "before_after_proof": "any mentions of before/after photos, results, or transformations",
  "common_objections": "FAQs, common concerns, or objections addressed on the site"
}

Call-to-action key — always include this based on the business type and services:
{
  "cta_list": "2–3 short, compelling CTAs on separate lines, e.g.:\nCall for a free estimate\nBook online in 60 seconds\nGet your free quote today"
}

Website content:
${content}`

  let rawText = ''
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      rawText    = (data.content as Array<{ type: string; text: string }>)?.find(b => b.type === 'text')?.text ?? ''
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      rawText    = (data.choices as Array<{ message: { content: string } }>)?.[0]?.message?.content ?? ''
    }
  } catch (err) {
    return NextResponse.json({ error: `AI error: ${err}` }, { status: 500 })
  }

  let result: BrandDnaResult
  try {
    const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    result = JSON.parse(stripped) as BrandDnaResult
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response. Try again.' }, { status: 500 })
  }

  return NextResponse.json(result)
}
