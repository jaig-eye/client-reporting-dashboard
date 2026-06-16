/**
 * Silo Optimization Engine — core utilities
 *
 * Provides: silo plan generation, optimization brief creation,
 * content scoring/auditing, and internal link recommendations.
 * All functions fail gracefully so a caller failure never blocks publishing.
 */

import { createAdminClient } from '@/lib/supabase/server'
import type {
  OptimizationBrief,
  RecommendedHeading,
  TermRequirement,
  LsiTerm,
  GoogleEntity,
  SchemaRecommendation,
  EeatSignal,
  PageStructureItem,
  InternalLinkRecommendation,
  TermUsage,
  AuditFinding,
  SchemaFinding,
  InternalLinkType,
} from '@/lib/types'

// ─── AI call (matches pattern in content/generate/route.ts) ──────────────────

async function callAI(
  provider: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 8000,
): Promise<string> {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    })
    if (!res.ok) throw new Error(`AI API error: ${await res.text()}`)
    const data = await res.json()
    const tb = data.content?.find((b: Record<string, unknown>) => b.type === 'text')
    return tb?.text || ''
  } else {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
    })
    if (!res.ok) throw new Error(`AI API error: ${await res.text()}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  }
}

function parseJson<T>(raw: string): T | null {
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const m = stripped.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!m) return null
  try { return JSON.parse(m[0]) as T } catch { return null }
}

// ─── Page text fetching ───────────────────────────────────────────────────────

/**
 * Fetches the plain-text body of a URL for content analysis.
 * Strips HTML tags, collapses whitespace.
 * Returns null on fetch failure so callers can skip gracefully.
 */
export async function fetchPageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentBot/1.0)' },
    })
    if (!res.ok) return null
    const html = await res.text()
    // Strip scripts, styles, nav, header, footer before extracting body text
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return cleaned.slice(0, 50_000) // cap to avoid huge payloads
  } catch {
    return null
  }
}

// ─── Silo plan builder ───────────────────────────────────────────────────────

export interface SiloPlanInput {
  siloId:         string
  clientId:       string
  hubKeyword:     string
  hubPageUrl?:    string | null
  hubPageTitle?:  string | null
  centralEntity?: string | null
  targetLocation?: string | null
  clientContext?: string
  provider:       string
  model:          string
  apiKey:         string
}

interface RawSiloPlan {
  top_level_keyword: string
  secondary_top_level_keywords: Array<{ keyword: string; intent: string; monthly_searches_low: number; monthly_searches_high: number; keyword_score: number }>
  supporting_keywords: Array<{ keyword: string; intent: string; monthly_searches_low: number; monthly_searches_high: number; keyword_score: number; page_type: string }>
  planned_pages: Array<{ title: string; slug: string; page_type: string; primary_keyword: string; priority: number; sort_order: number }>
  internal_link_plan: Array<{ source_title: string; target_title: string; anchor_text: string; link_type: string; reason: string }>
}

/**
 * Generates a full silo keyword map and content plan using AI.
 * Saves keywords, planned pages, and link recommendations to the database.
 * Returns the IDs of created records.
 */
export async function buildSiloPlan(input: SiloPlanInput): Promise<{
  keywordIds: string[]
  pageIds: string[]
  linkIds: string[]
}> {
  const { siloId, clientId, hubKeyword, hubPageUrl, hubPageTitle, centralEntity, targetLocation, clientContext, provider, model, apiKey } = input

  const systemPrompt = `You are a topical authority SEO strategist. Your job is to build a complete silo plan — a structured keyword map and content architecture — for a given hub topic.

IMPORTANT:
- Return ONLY a valid JSON object, no explanation or markdown fences.
- All keyword suggestions should be realistic, specific, and commercially relevant.
- Avoid keyword cannibalization: each keyword should target a distinct page.
- Distinguish clearly between top-level (hub), secondary top-level (pillar), and supporting (cluster) keywords.
- Supporting pages should answer specific questions or cover subtopics that link naturally to the hub.
- Internal link plan should only include genuinely useful links, not forced ones.`

  const locationNote = targetLocation ? ` (target location: ${targetLocation})` : ''
  const contextNote  = clientContext  ? `\n\nBusiness context:\n${clientContext}` : ''

  const userPrompt = `Build a comprehensive silo plan for the hub topic: "${hubKeyword}"${locationNote}.
${hubPageTitle ? `Hub page title: ${hubPageTitle}` : ''}
${hubPageUrl   ? `Hub page URL: ${hubPageUrl}` : ''}
${centralEntity ? `Central entity: ${centralEntity}` : ''}
${contextNote}

Return a JSON object with this exact structure:
{
  "top_level_keyword": "primary hub keyword",
  "secondary_top_level_keywords": [
    { "keyword": "...", "intent": "transactional|informational|commercial|navigational|local", "monthly_searches_low": 100, "monthly_searches_high": 500, "keyword_score": 45 }
  ],
  "supporting_keywords": [
    { "keyword": "...", "intent": "...", "monthly_searches_low": 50, "monthly_searches_high": 200, "keyword_score": 30, "page_type": "supporting_article|guide|faq|comparison" }
  ],
  "planned_pages": [
    { "title": "Page H1 title", "slug": "url-slug", "page_type": "hub|supporting_article|guide|faq|comparison", "primary_keyword": "target keyword", "priority": 1, "sort_order": 1 }
  ],
  "internal_link_plan": [
    { "source_title": "source page title", "target_title": "target page title", "anchor_text": "descriptive anchor", "link_type": "hub_to_supporting|supporting_to_hub|supporting_to_supporting", "reason": "why this link adds value" }
  ]
}

Guidelines:
- 1 top-level keyword
- 3–5 secondary top-level keywords
- 8–15 supporting keywords
- 1 hub page + 8–15 supporting/guide pages in planned_pages
- Internal link plan: every supporting page links back to hub; hub links to all supporting pages; 2–4 supporting-to-supporting links where relevant`

  const raw = await callAI(provider, model, apiKey, systemPrompt, userPrompt, 6000)
  const plan = parseJson<RawSiloPlan>(raw)
  if (!plan) throw new Error('AI returned invalid JSON for silo plan')

  const db = createAdminClient()
  const keywordIds: string[] = []
  const pageIds: string[] = []
  const linkIds: string[] = []

  // Save top-level keyword
  if (plan.top_level_keyword) {
    const { data: tlKw } = await db.from('content_silo_keywords').insert({
      client_id: clientId, silo_id: siloId,
      keyword: plan.top_level_keyword, keyword_type: 'top_level',
      selected: true,
    }).select('id').single()
    if (tlKw) keywordIds.push(tlKw.id)
  }

  // Save secondary top-level keywords
  for (const kw of plan.secondary_top_level_keywords ?? []) {
    const { data: k } = await db.from('content_silo_keywords').insert({
      client_id: clientId, silo_id: siloId,
      keyword: kw.keyword, keyword_type: 'secondary_top_level',
      intent: kw.intent || null,
      monthly_searches_low: kw.monthly_searches_low || null,
      monthly_searches_high: kw.monthly_searches_high || null,
      keyword_score: kw.keyword_score || null,
      selected: true,
    }).select('id').single()
    if (k) keywordIds.push(k.id)
  }

  // Save supporting keywords
  for (const kw of plan.supporting_keywords ?? []) {
    const { data: k } = await db.from('content_silo_keywords').insert({
      client_id: clientId, silo_id: siloId,
      keyword: kw.keyword, keyword_type: 'supporting',
      intent: kw.intent || null,
      monthly_searches_low: kw.monthly_searches_low || null,
      monthly_searches_high: kw.monthly_searches_high || null,
      keyword_score: kw.keyword_score || null,
      selected: false,
    }).select('id').single()
    if (k) keywordIds.push(k.id)
  }

  // Save planned pages
  const pageTitleToId = new Map<string, string>()
  for (const page of plan.planned_pages ?? []) {
    const { data: p } = await db.from('content_silo_pages').insert({
      client_id: clientId, silo_id: siloId,
      title: page.title,
      slug: page.slug || null,
      page_type: page.page_type || 'supporting_article',
      status: 'planned',
      priority: page.priority ?? 0,
      sort_order: page.sort_order ?? 0,
    }).select('id').single()
    if (p) {
      pageIds.push(p.id)
      pageTitleToId.set(page.title, p.id)
    }
  }

  // Save internal link plan
  for (const link of plan.internal_link_plan ?? []) {
    const sourcePid = pageTitleToId.get(link.source_title) ?? null
    const targetPid = pageTitleToId.get(link.target_title) ?? null
    const { data: l } = await db.from('content_silo_internal_links').insert({
      client_id: clientId, silo_id: siloId,
      source_silo_page_id: sourcePid,
      target_silo_page_id: targetPid,
      anchor_text: link.anchor_text,
      link_type: (link.link_type as InternalLinkType) || 'supporting_to_hub',
      status: 'recommended',
      reason: link.reason || null,
    }).select('id').single()
    if (l) linkIds.push(l.id)
  }

  return { keywordIds, pageIds, linkIds }
}

// ─── Optimization brief builder ───────────────────────────────────────────────

export interface BuildBriefInput {
  clientId:        string
  siloId?:         string | null
  siloPageId?:     string | null
  contentTopicId?: string | null
  contentPostId?:  string | null
  primaryKeyword:  string
  targetUrl?:      string | null
  targetLocation?: string | null
  competitorUrls?: string[]
  provider:        string
  model:           string
  apiKey:          string
}

interface RawBrief {
  recommended_word_count_min: number
  recommended_word_count_target: number
  recommended_word_count_max: number
  recommended_headings: Array<{ level: string; text: string; required: boolean }>
  required_terms: Array<{ term: string; importance: string; target_min: number; target_max: number }>
  keyword_variations: string[]
  lsi_terms: Array<{ term: string; importance_pct: number; target_min: number; target_max: number }>
  google_entities: Array<{ name: string; type: string; salience: number }>
  related_questions: string[]
  schema_recommendations: Array<{ schema_type: string; priority: string; reason: string }>
  eeat_recommendations: Array<{ signal: string; status: string; priority: string }>
  page_structure_recommendations: Array<{ element: string; current: number; target: number; status: string }>
}

/**
 * Builds a structured optimization brief using AI analysis.
 * Incorporates competitor page text when URLs are provided.
 */
export async function buildOptimizationBrief(input: BuildBriefInput): Promise<string> {
  const {
    clientId, siloId, siloPageId, contentTopicId, contentPostId,
    primaryKeyword, targetUrl, targetLocation, competitorUrls = [],
    provider, model, apiKey,
  } = input

  // Fetch competitor page text (fail gracefully per page)
  const competitorTexts: Array<{ url: string; text: string }> = []
  for (const url of competitorUrls.slice(0, 5)) {
    const text = await fetchPageText(url)
    if (text) competitorTexts.push({ url, text: text.slice(0, 8000) })
  }

  const competitorSection = competitorTexts.length > 0
    ? `\nCompetitor page excerpts for analysis:\n${competitorTexts.map(c => `URL: ${c.url}\n---\n${c.text.slice(0, 3000)}`).join('\n\n')}`
    : '\nNo competitor URLs provided — base recommendations on keyword analysis and best practices.'

  const locationNote = targetLocation ? ` (location: ${targetLocation})` : ''

  const systemPrompt = `You are a content optimization strategist. Analyze the keyword and any competitor page data provided, then produce a structured optimization brief.

Return ONLY valid JSON — no markdown, no explanation.`

  const userPrompt = `Build an optimization brief for: "${primaryKeyword}"${locationNote}
${targetUrl ? `Target page URL: ${targetUrl}` : ''}
${competitorSection}

Return this exact JSON structure:
{
  "recommended_word_count_min": 1800,
  "recommended_word_count_target": 2500,
  "recommended_word_count_max": 4000,
  "recommended_headings": [
    { "level": "h2", "text": "Suggested section heading", "required": true }
  ],
  "required_terms": [
    { "term": "exact keyword", "importance": "critical|high|medium|low", "target_min": 1, "target_max": 3 }
  ],
  "keyword_variations": ["variation 1", "variation 2"],
  "lsi_terms": [
    { "term": "lsi term", "importance_pct": 100, "target_min": 2, "target_max": 8 }
  ],
  "google_entities": [
    { "name": "Entity Name", "type": "PERSON|ORGANIZATION|LOCATION|CONSUMER_GOOD|OTHER", "salience": 0.8 }
  ],
  "related_questions": ["Question 1?", "Question 2?"],
  "schema_recommendations": [
    { "schema_type": "Article", "priority": "high", "reason": "why this schema helps" }
  ],
  "eeat_recommendations": [
    { "signal": "Author Bio", "status": "absent", "priority": "high" }
  ],
  "page_structure_recommendations": [
    { "element": "Bold tags", "current": 0, "target": 10, "status": "missing" }
  ]
}

Requirements:
- Required terms: include exact keyword (critical), primary variations, and semantically related terms competitors use
- Recommended headings: provide 4–8 H2s and 2–4 H3s that cover the topic comprehensively
- LSI terms: important semantic terms that signal topical authority
- Related questions: 5–10 questions users commonly ask about this topic (good for FAQ schema)
- Schema recommendations: relevant schema types for this page type
- EEAT recommendations: trust signals appropriate for this topic
- Page structure: typical counts for bold/italic/image/list/table elements`

  const raw = await callAI(provider, model, apiKey, systemPrompt, userPrompt, 5000)
  const parsed = parseJson<RawBrief>(raw)

  const db = createAdminClient()
  const { data: brief, error } = await db.from('content_optimization_briefs').insert({
    client_id:    clientId,
    silo_id:      siloId     ?? null,
    silo_page_id: siloPageId ?? null,
    content_topic_id: contentTopicId ?? null,
    content_post_id:  contentPostId  ?? null,
    target_url:       targetUrl       ?? null,
    primary_keyword:  primaryKeyword,
    secondary_keywords: [],
    target_location:  targetLocation ?? null,
    competitor_urls:  competitorUrls,
    recommended_word_count_min:    parsed?.recommended_word_count_min    ?? null,
    recommended_word_count_target: parsed?.recommended_word_count_target ?? null,
    recommended_word_count_max:    parsed?.recommended_word_count_max    ?? null,
    recommended_headings:          parsed?.recommended_headings          ?? [],
    required_terms:                parsed?.required_terms                ?? [],
    keyword_variations:            parsed?.keyword_variations            ?? [],
    lsi_terms:                     parsed?.lsi_terms                     ?? [],
    google_entities:               parsed?.google_entities               ?? [],
    related_questions:             parsed?.related_questions             ?? [],
    schema_recommendations:        parsed?.schema_recommendations        ?? [],
    eeat_recommendations:          parsed?.eeat_recommendations          ?? [],
    page_structure_recommendations: parsed?.page_structure_recommendations ?? [],
    internal_link_recommendations: [],
    raw_analysis: parsed ? { parsed_ok: true } : { parsed_ok: false, raw: raw.slice(0, 500) },
  }).select('id').single()

  if (error || !brief) throw new Error(`Failed to save optimization brief: ${error?.message}`)
  return brief.id
}

// ─── Content scorer / auditor ─────────────────────────────────────────────────

export interface AuditInput {
  clientId:       string
  siloId?:        string | null
  siloPageId?:    string | null
  contentPostId?: string | null
  brief:          OptimizationBrief
  pageText:       string
  targetUrl?:     string | null
}

/**
 * Scores content against an optimization brief and saves an audit snapshot.
 * All scoring is deterministic — no AI call needed for scoring.
 */
export async function auditContent(input: AuditInput): Promise<string> {
  const { clientId, siloId, siloPageId, contentPostId, brief, pageText, targetUrl } = input

  const text  = pageText.toLowerCase()
  const words = pageText.split(/\s+/).filter(Boolean).length
  const findings: AuditFinding[] = []
  const termUsage: TermUsage[] = []

  // ── Word count score ─────────────────────────────────────────────────────
  const wcMin    = brief.recommended_word_count_min    ?? 1000
  const wcTarget = brief.recommended_word_count_target ?? 2000
  const wcMax    = brief.recommended_word_count_max    ?? 5000
  let wordCountScore = 0
  if (words >= wcMin && words <= wcMax) {
    wordCountScore = words >= wcTarget ? 100 : Math.round((words / wcTarget) * 100)
  } else if (words < wcMin) {
    wordCountScore = Math.round((words / wcMin) * 50)
    findings.push({ category: 'word_count', severity: 'high', message: `Content is ${words} words — target ${wcTarget}`, recommendation: `Add approximately ${wcTarget - words} more words.` })
  } else {
    wordCountScore = 80 // over max but still scored
  }

  // ── Exact keyword score ──────────────────────────────────────────────────
  const exactKw = brief.primary_keyword.toLowerCase()
  const exactCount = countOccurrences(text, exactKw)
  const exactMin = 1, exactMax = 5
  let exactScore = 0
  if (exactCount === 0) {
    exactScore = 0
    findings.push({ category: 'exact_keyword', severity: 'critical', message: `Primary keyword "${brief.primary_keyword}" not found in content.`, recommendation: 'Add primary keyword to the page naturally — at least once in the main content, ideally in an H2.' })
  } else if (exactCount <= exactMax) {
    exactScore = 100
  } else {
    exactScore = 60
    findings.push({ category: 'exact_keyword', severity: 'medium', message: `Keyword "${brief.primary_keyword}" appears ${exactCount} times — may read as over-optimized.`, recommendation: `Use keyword variations to maintain density below ${exactMax} exact-match instances.` })
  }

  // ── Variation score ──────────────────────────────────────────────────────
  const variations = brief.keyword_variations ?? []
  let variationHits = 0
  for (const v of variations) {
    if (text.includes(v.toLowerCase())) variationHits++
  }
  const variationScore = variations.length > 0 ? Math.round((variationHits / variations.length) * 100) : 100

  // ── LSI score ────────────────────────────────────────────────────────────
  const lsiTerms = (brief.lsi_terms ?? []) as LsiTerm[]
  let lsiHits = 0
  for (const lt of lsiTerms) {
    const count = countOccurrences(text, lt.term.toLowerCase())
    if (count >= lt.target_min) lsiHits++
    termUsage.push({
      term: lt.term,
      current_count: count,
      target_min: lt.target_min,
      target_max: lt.target_max,
      importance: 'medium',
      status: count === 0 ? 'missing' : count < lt.target_min ? 'low' : count > lt.target_max ? 'overused' : 'good',
    })
  }
  const lsiScore = lsiTerms.length > 0 ? Math.round((lsiHits / lsiTerms.length) * 100) : 100

  // ── Required terms ───────────────────────────────────────────────────────
  const requiredTerms = (brief.required_terms ?? []) as TermRequirement[]
  for (const rt of requiredTerms) {
    const count = countOccurrences(text, rt.term.toLowerCase())
    const status: TermUsage['status'] =
      count === 0 ? 'missing' :
      count < rt.target_min ? 'low' :
      count > rt.target_max ? 'overused' : 'good'
    termUsage.push({
      term: rt.term,
      current_count: count,
      target_min: rt.target_min,
      target_max: rt.target_max,
      importance: rt.importance as TermUsage['importance'],
      status,
    })
    if (status === 'missing' && (rt.importance === 'critical' || rt.importance === 'high')) {
      findings.push({ category: 'required_term', severity: rt.importance === 'critical' ? 'critical' : 'high', message: `Required term "${rt.term}" is missing from content.`, recommendation: `Include "${rt.term}" at least ${rt.target_min} time(s).` })
    }
  }

  // ── Entity score ─────────────────────────────────────────────────────────
  const entities = (brief.google_entities ?? []) as GoogleEntity[]
  let entityHits = 0
  for (const e of entities) {
    if (text.includes(e.name.toLowerCase())) entityHits++
  }
  const entityScore = entities.length > 0 ? Math.round((entityHits / entities.length) * 100) : 100

  // ── Page structure detection ─────────────────────────────────────────────
  const h2Count     = countHtmlElements(pageText, 'h2')
  const h3Count     = countHtmlElements(pageText, 'h3')
  const boldCount   = countHtmlElements(pageText, 'strong') + countHtmlElements(pageText, 'b')
  const italicCount = countHtmlElements(pageText, 'em') + countHtmlElements(pageText, 'i')
  const imageCount  = countHtmlElements(pageText, 'img')
  const listCount   = countHtmlElements(pageText, 'ul') + countHtmlElements(pageText, 'ol')
  const tableCount  = countHtmlElements(pageText, 'table')

  const pageStructureFindings: PageStructureItem[] = [
    buildStructureItem('H2 headings', h2Count, 3, 8),
    buildStructureItem('H3 headings', h3Count, 2, 10),
    buildStructureItem('Bold elements', boldCount, 5, 25),
    buildStructureItem('Images', imageCount, 1, 8),
    buildStructureItem('Lists', listCount, 1, 5),
    buildStructureItem('Tables', tableCount, 0, 2),
  ]
  const pageStructureScore = Math.round(
    pageStructureFindings.filter(p => p.status === 'ok').length / pageStructureFindings.length * 100
  )

  // ── Schema score ─────────────────────────────────────────────────────────
  const schemaRecs = (brief.schema_recommendations ?? []) as SchemaRecommendation[]
  const schemaFindings: SchemaFinding[] = schemaRecs.map(s => ({
    schema_type: s.schema_type,
    present: pageText.toLowerCase().includes(`"@type":"${s.schema_type}"`) || pageText.toLowerCase().includes(`"@type": "${s.schema_type}"`),
    recommended: true,
    reason: s.reason,
  }))
  const schemaScore = schemaFindings.length > 0
    ? Math.round(schemaFindings.filter(s => s.present).length / schemaFindings.filter(s => s.recommended).length * 100)
    : 100

  // ── EEAT score ───────────────────────────────────────────────────────────
  const eeatRecs = (brief.eeat_recommendations ?? []) as EeatSignal[]
  const eeatScore = eeatRecs.length > 0
    ? Math.round(eeatRecs.filter(e => e.status === 'present').length / eeatRecs.length * 100)
    : 100

  // ── Internal link score ──────────────────────────────────────────────────
  const linkRecs = (brief.internal_link_recommendations ?? []) as InternalLinkRecommendation[]
  let internalLinkScore = 100
  if (linkRecs.length > 0) {
    const hubLink = linkRecs.find(l => l.link_type === 'supporting_to_hub')
    if (hubLink && !text.includes(hubLink.target_url)) {
      internalLinkScore -= 40
      findings.push({ category: 'internal_links', severity: 'high', message: 'Hub page link is missing from content.', recommendation: `Link to hub page: ${hubLink.target_url}` })
    }
  }

  // ── Composite score ──────────────────────────────────────────────────────
  const score_total = Math.round(
    exactScore     * 0.25 +
    variationScore * 0.10 +
    lsiScore       * 0.15 +
    entityScore    * 0.10 +
    wordCountScore * 0.15 +
    pageStructureScore * 0.10 +
    schemaScore    * 0.05 +
    eeatScore      * 0.05 +
    internalLinkScore  * 0.05
  )

  const db = createAdminClient()
  const { data: audit, error } = await db.from('content_optimization_audits').insert({
    client_id:    clientId,
    silo_id:      siloId      ?? null,
    silo_page_id: siloPageId  ?? null,
    content_post_id: contentPostId ?? null,
    brief_id:     brief.id,
    target_url:   targetUrl   ?? null,
    score_total,
    exact_keyword_score:    exactScore,
    variation_score:        variationScore,
    lsi_score:              lsiScore,
    entity_score:           entityScore,
    word_count_score:       wordCountScore,
    page_structure_score:   pageStructureScore,
    schema_score:           schemaScore,
    eeat_score:             eeatScore,
    internal_link_score:    internalLinkScore,
    findings,
    term_usage:             termUsage,
    schema_findings:        schemaFindings,
    eeat_findings:          eeatRecs,
    page_structure_findings: pageStructureFindings,
  }).select('id').single()

  if (error || !audit) throw new Error(`Failed to save audit: ${error?.message}`)
  return audit.id
}

// ─── Internal link recommender ────────────────────────────────────────────────

export interface RecommendLinksInput {
  siloId:   string
  clientId: string
}

/**
 * Scans published silo pages and creates recommended link records.
 * Hub-to-supporting, supporting-to-hub, and supporting-to-supporting links.
 * Skips any pair that already has a non-ignored link record.
 */
export async function recommendInternalLinks(input: RecommendLinksInput): Promise<number> {
  const { siloId, clientId } = input
  const db = createAdminClient()

  // Fetch silo pages with published status and published posts
  const { data: pages } = await db
    .from('content_silo_pages')
    .select('id, title, target_url, page_type, content_post_id')
    .eq('silo_id', siloId)
    .in('status', ['published', 'for_review', 'generated'])

  if (!pages || pages.length === 0) return 0

  // Fetch existing links to avoid duplicates
  const { data: existing } = await db
    .from('content_silo_internal_links')
    .select('source_silo_page_id, target_silo_page_id')
    .eq('silo_id', siloId)
    .neq('status', 'ignored')

  const existingPairs = new Set(
    (existing ?? []).map(l => `${l.source_silo_page_id}:${l.target_silo_page_id}`)
  )

  const hubPage       = pages.find(p => p.page_type === 'hub')
  const supportPages  = pages.filter(p => p.page_type !== 'hub')
  const toInsert: Array<Record<string, unknown>> = []

  for (const sp of supportPages) {
    const spTitle = (sp.title as string) ?? ''

    // supporting → hub
    if (hubPage) {
      const pair = `${sp.id}:${hubPage.id}`
      if (!existingPairs.has(pair)) {
        toInsert.push({
          client_id: clientId, silo_id: siloId,
          source_silo_page_id: sp.id, target_silo_page_id: hubPage.id,
          source_post_id: sp.content_post_id ?? null,
          target_post_id: hubPage.content_post_id ?? null,
          source_url: sp.target_url ?? null, target_url: hubPage.target_url ?? null,
          anchor_text: (hubPage.title as string) ?? 'hub page',
          link_type: 'supporting_to_hub' as InternalLinkType,
          status: 'recommended',
          reason: 'All cluster pages should link back to the hub page.',
        })
      }

      // hub → supporting
      const hubPair = `${hubPage.id}:${sp.id}`
      if (!existingPairs.has(hubPair)) {
        toInsert.push({
          client_id: clientId, silo_id: siloId,
          source_silo_page_id: hubPage.id, target_silo_page_id: sp.id,
          source_post_id: hubPage.content_post_id ?? null,
          target_post_id: sp.content_post_id ?? null,
          source_url: hubPage.target_url ?? null, target_url: sp.target_url ?? null,
          anchor_text: spTitle,
          link_type: 'hub_to_supporting' as InternalLinkType,
          status: 'recommended',
          reason: 'Hub page should link out to all cluster supporting pages.',
        })
      }
    }
  }

  // supporting → supporting (only for clearly related pages, avoid over-linking)
  for (let i = 0; i < supportPages.length; i++) {
    for (let j = i + 1; j < supportPages.length; j++) {
      const a = supportPages[i]
      const b = supportPages[j]
      // Skip if already linked in either direction
      if (existingPairs.has(`${a.id}:${b.id}`) || existingPairs.has(`${b.id}:${a.id}`)) continue
      // Only recommend a→b; the user can choose to add b→a if relevant
      toInsert.push({
        client_id: clientId, silo_id: siloId,
        source_silo_page_id: a.id, target_silo_page_id: b.id,
        source_post_id: a.content_post_id ?? null,
        target_post_id: b.content_post_id ?? null,
        source_url: a.target_url ?? null, target_url: b.target_url ?? null,
        anchor_text: (b.title as string) ?? 'related article',
        link_type: 'supporting_to_supporting' as InternalLinkType,
        status: 'recommended',
        reason: 'Topically related cluster pages — link if contextually natural.',
      })
    }
  }

  if (toInsert.length === 0) return 0
  await db.from('content_silo_internal_links').insert(toInsert)
  return toInsert.length
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countOccurrences(text: string, term: string): number {
  if (!term) return 0
  let count = 0
  let pos = text.indexOf(term)
  while (pos !== -1) {
    count++
    pos = text.indexOf(term, pos + 1)
  }
  return count
}

function countHtmlElements(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) ?? []).length
}

function buildStructureItem(element: string, current: number, targetMin: number, targetMax: number): PageStructureItem {
  return {
    element,
    current,
    target: `${targetMin}–${targetMax}`,
    status: current === 0 && targetMin > 0 ? 'missing' : current < targetMin ? 'low' : current > targetMax ? 'high' : 'ok',
  }
}

// ─── Brief injection for generation prompts ───────────────────────────────────

/**
 * Returns a formatted string that can be injected into a generation prompt
 * when an optimization brief is available for the topic/post.
 */
export function formatBriefForPrompt(brief: OptimizationBrief): string {
  const lines: string[] = []

  lines.push(`OPTIMIZATION BRIEF — follow these guidelines for "${brief.primary_keyword}":`)

  if (brief.recommended_word_count_target) {
    lines.push(`Target word count: ~${brief.recommended_word_count_target} words (min ${brief.recommended_word_count_min ?? 'n/a'}, max ${brief.recommended_word_count_max ?? 'n/a'})`)
  }

  if (brief.keyword_variations?.length) {
    lines.push(`Keyword variations to use naturally: ${brief.keyword_variations.join(', ')}`)
  }

  if (brief.required_terms?.length) {
    const critical = (brief.required_terms as TermRequirement[]).filter(t => t.importance === 'critical' || t.importance === 'high')
    if (critical.length) {
      lines.push(`Required terms (must appear in content): ${critical.map(t => t.term).join(', ')}`)
    }
  }

  if (brief.recommended_headings?.length) {
    const required = (brief.recommended_headings as RecommendedHeading[]).filter(h => h.required)
    if (required.length) {
      lines.push(`Suggested section headings:\n${required.map(h => `  ${h.level.toUpperCase()}: ${h.text}`).join('\n')}`)
    }
  }

  if (brief.related_questions?.length) {
    const qs = brief.related_questions.slice(0, 5)
    lines.push(`Related questions to address (work into content or FAQ):\n${qs.map(q => `  - ${q}`).join('\n')}`)
  }

  if (brief.schema_recommendations?.length) {
    const high = (brief.schema_recommendations as SchemaRecommendation[]).filter(s => s.priority === 'high')
    if (high.length) {
      lines.push(`Schema to include: ${high.map(s => s.schema_type).join(', ')}`)
    }
  }

  lines.push(`IMPORTANT: Use keyword variations and LSI terms naturally — avoid repeating the exact keyword phrase more than 3–4 times. Do not keyword-stuff.`)

  return lines.join('\n')
}
