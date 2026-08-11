// Competitor research module — fetches top SERP results for a keyword via SerpAPI,
// then scrapes H1/H2/H3 headings from each competitor page.
// Called during topic generation when agency_settings.serp_api_key is configured.

import { PLATFORM_BOT_UA } from '@/lib/platformBot'

const HEADING_RE = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

async function fetchCompetitorHeadings(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': PLATFORM_BOT_UA },
    })
    if (!res.ok) return []
    const html = await res.text()
    const matches = Array.from(html.matchAll(HEADING_RE))
    return matches
      .map(m => stripTags(m[1]))
      .filter(h => h.length > 3 && h.length < 200)
      .slice(0, 12)
  } catch {
    return []
  }
}

export interface CompetitorResearch {
  keyword: string
  urls:     string[]
  headings: Record<string, string[]>
}

/**
 * Render a CompetitorResearch result into the "fill the gaps" prompt block used by
 * the writer route. Returns '' when there is nothing useful to inject. Shared by
 * topic-time research (stored on content_topics.competitors_researched) and the
 * live write-time fallback so both read identically to the model.
 */
export function formatCompetitorGap(cr: CompetitorResearch | null | undefined): string {
  if (!cr || !cr.headings || Object.keys(cr.headings).length === 0) return ''
  const sections = Object.entries(cr.headings)
    .map(([url, hs]) => `  ${url}:\n    ${(hs as string[]).slice(0, 6).map(h => `• ${h}`).join('\n    ')}`)
    .join('\n')
  return `\nCompetitor Analysis for "${cr.keyword}" — these pages rank #1–5. FILL THE GAPS: go deeper, cover what they missed, add unique angles they skipped:\n${sections}`
}

/**
 * Live competitor-gap fallback for the writer route: when a topic has no stored
 * research (manually-added topics, older topics, or manual/Path-B generation),
 * fetch SERP competitor headings on demand. Soft-fails to '' with no key/keyword or
 * on any error. This is the SERP path today; once OpenSEO is connected its richer
 * keyword/SERP data can feed the same CompetitorResearch shape with no caller change.
 */
export async function liveCompetitorGap(
  keyword: string | null | undefined,
  serpApiKey: string | null | undefined,
): Promise<string> {
  const kw = keyword?.trim()
  if (!kw || !serpApiKey) return ''
  try {
    const cr = await researchCompetitors(kw, serpApiKey)
    return formatCompetitorGap(cr)
  } catch {
    return ''
  }
}

export async function researchCompetitors(
  keyword: string,
  serpApiKey: string,
): Promise<CompetitorResearch> {
  try {
    const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${serpApiKey}&num=5&engine=google&gl=us`
    const serpRes = await fetch(serpUrl, { signal: AbortSignal.timeout(8000) })
    if (!serpRes.ok) return { keyword, urls: [], headings: {} }

    const data = await serpRes.json() as { organic_results?: { link: string }[] }
    const urls = (data.organic_results ?? [])
      .map(r => r.link)
      .filter(u => u && !u.includes('youtube.com') && !u.includes('wikipedia.org'))
      .slice(0, 5)

    if (!urls.length) return { keyword, urls: [], headings: {} }

    const results = await Promise.allSettled(urls.map(u => fetchCompetitorHeadings(u)))
    const headings: Record<string, string[]> = {}
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.length > 0) headings[urls[i]] = r.value
    })

    return { keyword, urls, headings }
  } catch {
    return { keyword, urls: [], headings: {} }
  }
}
