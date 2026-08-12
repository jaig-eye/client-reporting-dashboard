// Local SEO QA scorer — no AI call, pure string/regex analysis of generated HTML.
// Called after post generation; result stored in content_posts.seo_score.

import type { SeoBrief, SeoScore } from './types'

export function scoreSeoPost(params: {
  html:         string
  title:        string
  metaDesc:     string | null
  slug:         string | null
  wordCount:    number
  targetLength: number
  brief:        SeoBrief | null
}): SeoScore {
  const { html, title, metaDesc, wordCount, targetLength, brief } = params
  const keyword    = brief?.primary_keyword?.toLowerCase() ?? ''
  const localAngle = brief?.local_seo_angle?.toLowerCase() ?? ''
  const textLower  = html.replace(/<[^>]+>/g, ' ').toLowerCase()
  const issues:   string[] = []
  const warnings: string[] = []

  // ── Keyword checks ─────────────────────────────────────────────────────────
  const keywordInTitle    = keyword ? title.toLowerCase().includes(keyword) : false
  const first500          = textLower.slice(0, 500)
  const keywordInIntro    = keyword ? first500.includes(keyword) : false
  const headingMatches    = html.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi) ?? []
  const headingText       = headingMatches.map(h => h.replace(/<[^>]+>/g, '').toLowerCase()).join(' ')
  const keywordInHeadings = keyword ? headingText.includes(keyword) : false

  if (keyword && !keywordInTitle)    issues.push(`Primary keyword "${keyword}" not in title`)
  if (keyword && !keywordInIntro)    issues.push(`Primary keyword not in opening paragraph`)
  if (keyword && !keywordInHeadings) warnings.push(`Primary keyword absent from headings`)

  // Over-optimisation: keyword density > 3%
  const wordCountNum  = wordCount || textLower.split(/\s+/).length
  const keywordWords  = keyword.split(/\s+/).length
  const occurrences   = keyword ? (textLower.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length : 0
  const density       = keyword && wordCountNum > 0 ? (occurrences * keywordWords) / wordCountNum : 0
  const overOptimised = density > 0.03

  if (overOptimised) warnings.push(`Keyword density ${(density * 100).toFixed(1)}% may appear over-optimised`)

  // ── Punctuation (writer quality bar bans em/en dashes) ───────────────────────
  const emDashCount = (html.match(/[—–]/g) ?? []).length
  if (emDashCount > 0) warnings.push(`${emDashCount} em/en dash(es) present — the writer style bans them`)

  // ── Heading structure ──────────────────────────────────────────────────────
  const h1Count = (html.match(/<h1[^>]*>/gi) ?? []).length
  const h2Count = (html.match(/<h2[^>]*>/gi) ?? []).length
  const headingStructure = h1Count <= 1 && h2Count >= 2

  if (h1Count === 0)  issues.push('Missing H1')
  if (h1Count > 1)    warnings.push(`${h1Count} H1 tags found — only one expected`)
  if (h2Count < 2)    issues.push('Fewer than 2 H2 subheadings')

  // ── Internal links ─────────────────────────────────────────────────────────
  const internalLinkMatches = html.match(/<a[^>]+href=["'][^"']*["'][^>]*>/gi) ?? []
  const internalLinksCount  = internalLinkMatches.filter(a => {
    const href = a.match(/href=["']([^"']+)["']/)
    if (!href) return false
    const url = href[1]
    return url.startsWith('/') || (!url.startsWith('http') && !url.startsWith('mailto'))
  }).length

  if (internalLinksCount < 2) issues.push(`Only ${internalLinksCount} internal link(s) — aim for 2–5`)
  if (internalLinksCount > 7) warnings.push(`${internalLinksCount} internal links may appear unnatural`)

  // ── Local relevance ────────────────────────────────────────────────────────
  const localRelevance = localAngle ? textLower.includes(localAngle.split(' ')[0] ?? '') : true

  if (localAngle && !localRelevance) warnings.push('Local SEO angle not reflected in content')

  // ── CTA present ───────────────────────────────────────────────────────────
  const last300   = textLower.slice(-300)
  const ctaTerms  = ['call', 'contact', 'schedule', 'book', 'request', 'get a', 'free quote', 'estimate', 'apply']
  const ctaPresent = ctaTerms.some(t => last300.includes(t))

  if (!ctaPresent) issues.push('No clear CTA in closing section')

  // ── FAQ present ────────────────────────────────────────────────────────────
  const hasFaqOpportunities = (brief?.faq_opportunities?.length ?? 0) > 0
  const faqPresent = hasFaqOpportunities
    ? textLower.includes('frequently asked') || (html.toLowerCase().includes('<h2') && textLower.includes('faq'))
    : true

  if (hasFaqOpportunities && !faqPresent) warnings.push('FAQ section expected but not found')

  // ── Meta description ───────────────────────────────────────────────────────
  const metaPresent = Boolean(metaDesc && metaDesc.length >= 50 && metaDesc.length <= 160)

  if (!metaPresent) {
    if (!metaDesc) issues.push('Meta description missing')
    else if (metaDesc.length < 50)  issues.push('Meta description too short (< 50 chars)')
    else if (metaDesc.length > 160) warnings.push('Meta description too long (> 160 chars)')
  }

  // ── E-E-A-T signals ────────────────────────────────────────────────────────
  const eatTerms   = ['year', 'certified', 'licensed', 'insured', 'expert', 'experience', 'guarantee', 'rated', 'award', 'review']
  const eatSignals = eatTerms.some(t => textLower.includes(t))

  if (!eatSignals) warnings.push('No E-E-A-T trust signals detected in content')

  // ── Word count ────────────────────────────────────────────────────────────
  const targetWc = brief?.word_count_target ?? targetLength
  const wordCountOnTarget = Math.abs(wordCount - targetWc) / targetWc < 0.15

  if (wordCount < targetWc * 0.7) issues.push(`Word count ${wordCount} is significantly below target ${targetWc}`)
  else if (!wordCountOnTarget)     warnings.push(`Word count ${wordCount} outside ±15% of target ${targetWc}`)

  // ── Intent match (heuristic) ───────────────────────────────────────────────
  const intent     = brief?.search_intent ?? ''
  let intentMatch  = true
  if (intent === 'cost_pricing' && !textLower.match(/\$|\bprice\b|\bcost\b|\brate\b|\bfee\b/)) {
    intentMatch = false
    warnings.push('Cost/pricing intent but no pricing language found')
  }
  if (intent === 'faq' && !textLower.includes('?')) {
    intentMatch = false
    warnings.push('FAQ intent but no question format found')
  }

  // ── Duplicate warning ─────────────────────────────────────────────────────
  const duplicateWarning = false // handled at topic generation stage via cannibalization check

  // ── Score calculation ─────────────────────────────────────────────────────
  // Weights: keyword=25, intent/structure=25, links=20, local=10, conversion=20
  let score = 0
  if (keywordInTitle)    score += 10
  if (keywordInIntro)    score += 8
  if (keywordInHeadings) score += 7
  if (intentMatch)       score += 10
  if (headingStructure)  score += 15
  if (internalLinksCount >= 2 && internalLinksCount <= 7) score += 20
  if (localRelevance)    score += 10
  if (ctaPresent)        score += 12
  if (faqPresent && hasFaqOpportunities) score += 4
  if (metaPresent)       score += 4
  if (eatSignals)        score += 4
  if (wordCountOnTarget) score += 5

  if (overOptimised) score = Math.max(0, score - 10)
  if (emDashCount > 0) score = Math.max(0, score - Math.min(6, emDashCount))

  return {
    overall:              Math.min(100, score),
    keyword_in_title:     keywordInTitle,
    keyword_in_intro:     keywordInIntro,
    keyword_in_headings:  keywordInHeadings,
    intent_match:         intentMatch,
    heading_structure:    headingStructure,
    internal_links_count: internalLinksCount,
    local_relevance:      localRelevance,
    cta_present:          ctaPresent,
    faq_present:          faqPresent,
    meta_present:         metaPresent,
    eat_signals:          eatSignals,
    word_count_on_target: wordCountOnTarget,
    over_optimised:       overOptimised,
    duplicate_warning:    duplicateWarning,
    issues,
    warnings,
  }
}
