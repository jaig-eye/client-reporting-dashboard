// Shared topic generation logic.
// Extracted from /api/admin/content/topics/generate/route.ts so both the
// per-client API route and the bulk calendar/generate route use identical logic.

import { fetchQueueKeywords, claimKeywordsForTopics, buildKeywordQueueBlock, type SiloQueueKeyword } from '@/lib/content/siloQueue'
import { completeText } from '@/lib/ai/client'
import { describeTenure } from '@/lib/content/eeat'
import { createAdminClient }              from '@/lib/supabase/server'
import { PLATFORM_BOT_UA, BROWSER_BOT_UA } from '@/lib/platformBot'
import { sendEmail }                      from '@/lib/email'
import { buildTopicsEmail }               from '@/lib/content/emailTemplates'
import { researchCompetitors }            from '@/lib/content/competitorResearch'
import type { CompetitorResearch }        from '@/lib/content/competitorResearch'
import {
  BLOG_INTENT_ENUM,
  NON_BLOG_INTENT_ENUM,
  BLOG_INTENT_GUARDRAIL,
  BLOG_LANDSCAPE_INSTRUCTION,
  isAllowedBlogIntent,
  isForbiddenBlogKeyword,
} from '@/lib/content/blogStrategy'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'
import { getClientDfsContext } from '@/lib/content/competitiveIntel'
import { dfsKeywordOverview, type DfsKeywordData } from '@/lib/connectors/dataforseo'
import { recordDfsUsage } from '@/lib/content/dataforseoUsage'

interface TopicIdea {
  topic:               string
  target_keyword:      string
  search_intent:       string
  secondary_keywords:  string
  keyword_opportunity: string
  ranking_strategy:    string
  audience_intent:     string
  why_now:             string
  competition_level:   string
  cluster_group?:      string
}

/**
 * Compare keywords the way a search engine would treat them as the same request: case, spacing
 * and punctuation carry no meaning here.
 */
function normalizeKeyword(kw: string | null | undefined): string {
  return String(kw ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Escape a keyword for use inside a RegExp — keywords are data and can contain anything. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractSitemapLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi)).map(m => m[1].trim())
}

async function fetchSitemapData(sitemapUrl: string): Promise<{ pages: string[]; blogPosts: string[] }> {
  const empty = { pages: [], blogPosts: [] }
  try {
    // BROWSER_BOT_UA, not PLATFORM_BOT_UA: this fetches a CLIENT's site, which is
    // exactly the case platformBot.ts says the browser-signature variant is for.
    // It keeps the "GoLaunchLocal" token so a Cloudflare skip rule still matches.
    //
    // The old 4s ceiling was too tight for a Cloudflare-fronted sitemap — the
    // index alone routinely takes ~1s — and a timeout here is indistinguishable
    // from "site has no pages", which silently empties the cannibalization
    // avoid-list. Hence the wider budget and the loud log.
    const res = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(12_000),
      headers: { 'User-Agent': BROWSER_BOT_UA },
    })
    if (!res.ok) {
      console.warn(`[generateTopics] sitemap ${sitemapUrl} → HTTP ${res.status}. Cannibalization avoid-list will not include this site's existing pages.`)
      return empty
    }
    const xml = await res.text()
    const locs = extractSitemapLocs(xml)

    if (xml.includes('<sitemapindex')) {
      const subUrls = locs.filter(u => u.endsWith('.xml')).slice(0, 10)
      const pages: string[]     = []
      const blogPosts: string[] = []
      await Promise.all(subUrls.map(async subUrl => {
        try {
          const sub = await fetch(subUrl, {
            signal: AbortSignal.timeout(12_000),
            headers: { 'User-Agent': BROWSER_BOT_UA },
          })
          if (!sub.ok) return
          const subLocs = extractSitemapLocs(await sub.text()).filter(u => !u.endsWith('.xml'))
          if (/post|blog|article|news/i.test(subUrl)) {
            blogPosts.push(...subLocs)
          } else {
            pages.push(...subLocs)
          }
        } catch (e) {
          console.warn(`[generateTopics] sub-sitemap ${subUrl} failed: ${e instanceof Error ? e.message : e}`)
        }
      }))
      return { pages: pages.slice(0, 40), blogPosts: blogPosts.slice(0, 150) }
    }

    return { pages: locs.filter(u => !u.endsWith('.xml')).slice(0, 40), blogPosts: [] }
  } catch (e) {
    // Never silent. An empty return here is indistinguishable from "this site has
    // no pages", which quietly disables cannibalization protection for the whole run.
    console.warn(`[generateTopics] sitemap ${sitemapUrl} fetch failed: ${e instanceof Error ? e.message : e}. Cannibalization avoid-list will not include this site's existing pages.`)
    return empty
  }
}

async function fetchSitemapPages(sitemapUrl: string): Promise<string[]> {
  const { pages, blogPosts } = await fetchSitemapData(sitemapUrl)
  return [...pages, ...blogPosts]
}

function scoreUrlRelevance(url: string, keywords: string[]): number {
  const path = url.toLowerCase().replace(/[-_/]/g, ' ')
  return keywords.reduce((score, kw) => {
    const words = kw.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    return score + words.filter(w => path.includes(w)).length
  }, 0)
}

function stripDomain(url: string): string {
  try { return new URL(url).pathname } catch { return url }
}

export interface TopicSummary {
  id:                  string
  topic:               string
  target_keyword:      string | null
  target_publish_date: string | null
  keyword_opportunity: string | null
}

export interface GenerateTopicsResult {
  topics:     TopicSummary[]
  clientName: string
  count:      number
  error?:     string
}

export async function generateTopicsForClient(
  db:       ReturnType<typeof createAdminClient>,
  clientId: string,
  count:    number,
  targetPublishDate?: string,
  opts?: {
    suppressEmail?: boolean
    siloId?: string
    contentType?: string
    /**
     * A keyword or angle the reviewer typed when asking for a regeneration.
     *
     * It steers WHICH topic gets picked, which is the only place it can work: for a full
     * regenerate the topic is chosen here, before any content is written, so a direction
     * supplied to the content prompt alone would arrive too late to change the subject.
     * Advisory, not a hard filter — the avoid-list and silo constraints still apply, so a
     * keyword already covered will not be resurrected.
     */
    steerKeyword?: string
  },
): Promise<GenerateTopicsResult> {
  const windowStart = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)

  // Build avoid-list queries scoped to the same content_type when one is provided.
  // Blog generation avoids blog posts/topics only; SA generation avoids SA only —
  // so neither wastes avoid-list slots on the other content type.
  // DELETED vs REJECTED — deliberately different, because they mean different things.
  //
  //   DELETED  → the row is hard-deleted, so it is absent from these queries and the
  //              topic is free to be suggested again. "Deleted" means "forget this
  //              ever happened", e.g. a mistake or a duplicate, and nothing about the
  //              subject was wrong.
  //   REJECTED → the row is kept with status='rejected'. That is an editorial signal:
  //              a human looked at this specific angle and did not want it. Offering
  //              it again wastes a slot and a review cycle.
  //
  // This query previously carried `.not('status','eq','rejected')`, which had it
  // exactly backwards — rejected topics were excluded from the avoid-list and so were
  // free to be regenerated, and the only way to stop a topic coming back was to
  // delete it. Rejected rows are now included in the avoid-list; deletion remains the
  // way to make something eligible again.
  let existingTopicsQ = db.from('content_topics')
    .select('topic, target_keyword')
    .eq('client_id', clientId)
  if (opts?.contentType) existingTopicsQ = existingTopicsQ.eq('content_type', opts.contentType)

  // No date cap — include all posts ever generated for this client so nothing is
  // recycled. Rejected posts are included for the same reason as rejected topics;
  // deleted posts are gone from the table and therefore already excluded.
  let existingPostsQ = db.from('content_posts')
    .select('title, focus_topic, target_keyword')
    .eq('client_id', clientId)
    .order('generated_at', { ascending: false })
    .limit(500)
  if (opts?.contentType) existingPostsQ = existingPostsQ.eq('content_type', opts.contentType)

  const [
    settingsRes,
    clientRes,
    clientSettingsRes,
    existingTopicsRes,
    existingPostsRes,
    gscRawRes,
    paidTermsRes,
    ahrefsKwRes,
  ] = await Promise.all([
    db.from('agency_settings')
      .select('ai_provider, ai_model, ai_api_key, agency_name, notification_email, notify_topics_created, notify_topic_ready, serp_api_key, notification_config')
      .single(),
    db.from('clients').select('id, name').eq('id', clientId).single(),
    db.from('content_settings')
      .select('business_background, services, target_audience, geographic_focus, brand_voice, phone_number, sitemap_url, sitemap_urls, eeat_data, topic_guidelines')
      .eq('client_id', clientId)
      .maybeSingle(),
    existingTopicsQ,
    existingPostsQ,
    db.from('gsc_metrics')
      .select('page, query, clicks, impressions, position, ctr')
      .eq('client_id', clientId)
      .gte('date', windowStart)
      .not('page', 'ilike', '%?%')
      .not('query', 'eq', '')
      .limit(2000),
    // Paid search terms that produced a conversion. The strongest commercial signal available:
    // the client paid for the click and it turned into a lead.
    db.from('google_ads_search_terms')
      .select('search_term, clicks, conversions, spend')
      .eq('client_id', clientId)
      .gte('date', windowStart)
      .gt('conversions', 0)
      .limit(2000),
    // Third-party organic positions. Covers queries GSC drops from a 28-day window, and carries
    // volume and difficulty of its own.
    db.from('ahrefs_keywords')
      .select('keyword, position, volume, difficulty')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(500),
  ])

  if (!settingsRes.data?.ai_api_key) {
    return { topics: [], clientName: '', count: 0, error: 'AI not configured. Add an API key in Agency Settings.' }
  }

  const settings       = settingsRes.data
  const client         = clientRes.data
  const clientSettings = clientSettingsRes.data as Record<string, unknown> | null
  const clientName     = client?.name ?? 'this client'

  // ── Aggregate GSC 28-day data ──────────────────────────────────────────────
  type GscAgg = { totalClicks: number; totalImpr: number; weightedPos: number; weightedCtr: number; count: number }
  const gscMap = new Map<string, GscAgg>()

  for (const r of (gscRawRes.data ?? []) as { page: string; query: string; clicks: number; impressions: number; position: number; ctr: number }[]) {
    const key  = `${r.page}||${r.query}`
    const impr = r.impressions ?? 0
    const ex   = gscMap.get(key)
    if (ex) {
      const newImpr  = ex.totalImpr + impr
      ex.weightedPos = newImpr > 0 ? (ex.weightedPos * ex.totalImpr + (r.position ?? 0) * impr) / newImpr : ex.weightedPos
      ex.weightedCtr = newImpr > 0 ? (ex.weightedCtr * ex.totalImpr + (r.ctr ?? 0) * impr) / newImpr : ex.weightedCtr
      ex.totalClicks += r.clicks ?? 0
      ex.totalImpr    = newImpr
      ex.count++
    } else {
      gscMap.set(key, { totalClicks: r.clicks ?? 0, totalImpr: impr, weightedPos: r.position ?? 0, weightedCtr: r.ctr ?? 0, count: 1 })
    }
  }

  // ── Paid search terms that converted ───────────────────────────────────────
  // Summed across the window per term, because the same term converts on many days.
  type PaidTerm = { term: string; conversions: number; clicks: number; spend: number }
  const paidMap = new Map<string, PaidTerm>()
  for (const r of (paidTermsRes.data ?? []) as { search_term: string; clicks: number | null; conversions: number | null; spend: number | null }[]) {
    const term = String(r.search_term ?? '').trim().toLowerCase()
    if (!term) continue
    const ex = paidMap.get(term) ?? { term, conversions: 0, clicks: 0, spend: 0 }
    ex.conversions += Number(r.conversions) || 0
    ex.clicks      += Number(r.clicks)      || 0
    ex.spend       += Number(r.spend)       || 0
    paidMap.set(term, ex)
  }
  const paidConverters = Array.from(paidMap.values())
    .filter(t => t.conversions >= 1)
    .sort((a, b) => b.conversions - a.conversions || b.spend - a.spend)
    .slice(0, 10)

  // ── Ahrefs organic positions ───────────────────────────────────────────────
  // One row per keyword — the newest date wins, since the query is ordered by date desc.
  type AhrefsKw = { keyword: string; position: number | null; volume: number | null; difficulty: number | null }
  const ahrefsMap = new Map<string, AhrefsKw>()
  for (const r of (ahrefsKwRes.data ?? []) as AhrefsKw[]) {
    const kw = String(r.keyword ?? '').trim().toLowerCase()
    if (!kw || ahrefsMap.has(kw)) continue
    ahrefsMap.set(kw, { keyword: kw, position: r.position, volume: r.volume, difficulty: r.difficulty })
  }
  // Positions 11–30 are the actionable band: close enough that an article moves them, far enough
  // that we are not competing with a page of our own already on page one.
  const ahrefsNearMiss = Array.from(ahrefsMap.values())
    .filter(k => k.position != null && k.position > 10 && k.position <= 30)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 12)
  // Anything the client already holds on page one, from a source GSC may not surface this window.
  const ahrefsHolding = Array.from(ahrefsMap.values())
    .filter(k => k.position != null && k.position <= 10)
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    .slice(0, 12)

  // ── Tracked rankings ───────────────────────────────────────────────────────
  // Read separately rather than in the Promise.all above: the tables only exist from migration
  // 190, and a missing relation must cost this section alone, not every other source with it.
  type TrackedRank = { keyword: string; position: number | null; url: string | null }
  const trackedRanks: TrackedRank[] = await (async () => {
    try {
      const { data, error } = await db
        .from('seo_keyword_current')
        .select('keyword, current_position, current_url')
        .eq('client_id', clientId)
        .not('current_position', 'is', null)
        .order('current_position', { ascending: true })
        .limit(300)
      if (error) return []
      return ((data ?? []) as Record<string, unknown>[]).map(r => ({
        keyword:  String(r.keyword ?? '').trim().toLowerCase(),
        position: r.current_position == null ? null : Number(r.current_position),
        url:      r.current_url == null ? null : String(r.current_url),
      })).filter(r => r.keyword)
    } catch {
      return []
    }
  })()

  // ── The discovered candidate pool ──────────────────────────────────────────
  // Unclaimed, untracked candidates from keyword discovery. The only source here that can
  // propose a subject the client has never ranked for. Same dormant-safe read as the tracked
  // rankings: no table, no pool, and selection behaves exactly as it does today.
  type PoolKeyword = { keyword: string; volume: number | null; difficulty: number | null; intent: string | null }
  const candidatePool: PoolKeyword[] = await (async () => {
    try {
      const { data, error } = await db
        .from('seo_keywords')
        .select('keyword, search_volume, keyword_difficulty, intent')
        .eq('client_id', clientId)
        .eq('is_tracked', false)
        .is('content_post_id', null)
        .order('search_volume', { ascending: false, nullsFirst: false })
        .limit(40)
      if (error) return []
      return ((data ?? []) as Record<string, unknown>[]).map(r => ({
        keyword:    String(r.keyword ?? '').trim(),
        volume:     r.search_volume == null ? null : Number(r.search_volume),
        difficulty: r.keyword_difficulty == null ? null : Number(r.keyword_difficulty),
        intent:     r.intent == null ? null : String(r.intent),
      })).filter(k => k.keyword)
    } catch {
      return []
    }
  })()

  const rankOwned  = trackedRanks.filter(r => r.position != null && r.position <= 10).slice(0, 15)
  const rankNear   = trackedRanks.filter(r => r.position != null && r.position > 10 && r.position <= 30).slice(0, 15)
  const rankWeak   = trackedRanks.filter(r => r.position != null && r.position > 30).slice(0, 10)

  const topPages = Array.from(gscMap.entries())
    .map(([k, v]) => { const [page, query] = k.split('||'); return { page, query, ...v } })
    .sort((a, b) => b.totalClicks - a.totalClicks)
    .slice(0, 10)

  const growthTargets = Array.from(gscMap.entries())
    .map(([k, v]) => { const [page, query] = k.split('||'); return { page, query, ...v } })
    .filter(r => r.weightedPos > 9 && r.weightedPos <= 20 && r.totalImpr > 10)
    .sort((a, b) => b.totalImpr - a.totalImpr)
    .slice(0, 15)

  const quickWins = Array.from(gscMap.entries())
    .map(([k, v]) => { const [page, query] = k.split('||'); return { page, query, ...v } })
    .filter(r => r.weightedPos >= 5 && r.weightedPos < 10 && r.totalImpr > 5)
    .sort((a, b) => b.totalImpr - a.totalImpr)
    .slice(0, 10)

  const ctrIssues = Array.from(gscMap.entries())
    .map(([k, v]) => { const [page, query] = k.split('||'); return { page, query, ...v } })
    .filter(r => {
      if (r.weightedPos > 5) return false
      const floor = r.weightedPos <= 1 ? 0.20 : r.weightedPos <= 2 ? 0.10 : r.weightedPos <= 3 ? 0.07 : 0.04
      return r.weightedCtr < floor * 0.6 && r.totalImpr > 50
    })
    .sort((a, b) => b.totalImpr - a.totalImpr)
    .slice(0, 8)

  // ── Competitor research (optional — requires serp_api_key) ───────────────
  const competitorMap = new Map<string, CompetitorResearch>()
  const serpApiKey = (settings as Record<string, unknown>).serp_api_key as string | null
  if (serpApiKey && growthTargets.length > 0) {
    const toResearch = growthTargets.slice(0, 3)

    // Same-day keyword cache: reuse SerpAPI results within the same UTC day only
    const cacheWindowStart = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'
    const { data: cachedRows } = await db
      .from('content_topics')
      .select('target_keyword, competitors_researched')
      .eq('client_id', clientId)
      .not('competitors_researched', 'is', null)
      .gte('created_at', cacheWindowStart)
    const serpCache = new Map<string, CompetitorResearch>()
    for (const row of (cachedRows ?? []) as { target_keyword: string; competitors_researched: unknown }[]) {
      if (row.competitors_researched && !serpCache.has(row.target_keyword)) {
        serpCache.set(row.target_keyword, row.competitors_researched as CompetitorResearch)
      }
    }

    // Only call SerpAPI for keywords not already in cache
    const toFetch = toResearch.filter(t => !serpCache.has(t.query))
    if (toFetch.length > 0) {
      const results = await Promise.allSettled(
        toFetch.map(t => researchCompetitors(t.query, serpApiKey))
      )
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.urls.length > 0) {
          serpCache.set(toFetch[i].query, r.value)
        }
      })
    }

    // Merge cache hits + fresh results into competitorMap
    for (const t of toResearch) {
      const hit = serpCache.get(t.query)
      if (hit) competitorMap.set(t.query, hit)
    }
  }

  // ── Keyword demand/difficulty/intent enrichment (DataForSEO — dormant if unconnected) ──
  // Real figures replace the model's guesswork when selecting/prioritising keywords.
  const kwDataMap = new Map<string, DfsKeywordData>()
  try {
    const dfsCtx = await getClientDfsContext(db, clientId)
    if (dfsCtx) {
      // Paid converters lead: a term with a known cost per lead is the one whose volume and
      // difficulty are most worth paying to learn.
      const seeds = Array.from(new Set([
        ...paidConverters.map(t => t.term),
        ...growthTargets.map(t => t.query),
        ...quickWins.map(t => t.query),
        ...ahrefsNearMiss.map(k => k.keyword),
      ])).slice(0, 200)
      if (seeds.length) {
        const enriched = await dfsKeywordOverview(seeds, dfsCtx.creds, {
          locationCode: dfsCtx.config.location_code,
          languageCode: dfsCtx.config.language_code,
          onCost: c => { void recordDfsUsage({ operation: 'keyword_overview', cost: c, clientId }) },
        })
        for (const r of enriched) kwDataMap.set(r.keyword.toLowerCase(), r)
      }
    }
  } catch { /* soft-fail: enrichment absent, prompt renders without it */ }

  // ── Sitemap pages ──────────────────────────────────────────────────────────
  const sitemapUrls: string[] = (() => {
    const urls = clientSettings?.sitemap_urls
    if (Array.isArray(urls) && urls.length > 0) return urls as string[]
    if (clientSettings?.sitemap_url) return [String(clientSettings.sitemap_url)]
    return []
  })()

  const halfMonthAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
  // source_sitemap requires migration 183; without it PostgREST rejects the whole
  // select and the cached sitemap silently reads as empty. See the matching
  // fallback in api/admin/content/generate.
  type CachedSitemapRow = {
    url: string; is_priority: boolean; is_excluded: boolean
    created_at: string; source_sitemap?: string | null
  }

  const firstTry = await db
    .from('content_sitemap_pages')
    .select('url, is_priority, is_excluded, created_at, source_sitemap')
    .eq('client_id', clientId)

  let storedPages = firstTry.data as CachedSitemapRow[] | null
  let storedErr   = firstTry.error

  if (storedErr && /source_sitemap/i.test(storedErr.message)) {
    console.warn('[generateTopics] source_sitemap column missing (migration 183 not applied) — falling back to URL heuristics for blog-post detection.')
    const retry = await db
      .from('content_sitemap_pages')
      .select('url, is_priority, is_excluded, created_at')
      .eq('client_id', clientId)
    storedPages = retry.data as CachedSitemapRow[] | null
    storedErr   = retry.error
  }
  if (storedErr) console.error('[generateTopics] sitemap cache read failed:', storedErr.message)

  const cacheIsFresh = storedPages && storedPages.length > 0 &&
    (storedPages as { created_at: string }[]).some(r => r.created_at >= halfMonthAgo)

  let sitemapPages: string[] = []
  const sitemapBlogPostUrls: string[] = []
  const sitemapKeywords = growthTargets.map(t => t.query)

  if (cacheIsFresh) {
    const storedTyped = storedPages as { url: string; is_priority: boolean; is_excluded: boolean; source_sitemap: string | null }[]
    const priority   = storedTyped.filter(r => r.is_priority).map(r => r.url)
    const candidates = storedTyped
      .filter(r => !r.is_priority && !r.is_excluded)
      .map(r => ({ url: r.url, score: scoreUrlRelevance(r.url, sitemapKeywords) }))
      .sort((a, b) => b.score - a.score)
      .map(r => r.url)
    sitemapPages = [...priority, ...candidates].slice(0, 60)

    // Blog posts from cached sitemap — identified by source_sitemap pattern or URL path
    const cachedBlogPostUrls = storedTyped
      .filter(r => !r.is_excluded && (
        /post|blog|article|news/i.test(r.source_sitemap ?? '') ||
        /\/(blog|news|articles?|posts?)\//.test(r.url)
      ))
      .map(r => r.url)
    // Collected here; added to avoidEntries below after addAvoid is defined
    sitemapBlogPostUrls.push(...cachedBlogPostUrls)
  } else if (sitemapUrls.length > 0) {
    const sitemapDataArr = await Promise.all(sitemapUrls.map(fetchSitemapData))
    const allPages = Array.from(new Set(sitemapDataArr.flatMap(d => d.pages)))
    sitemapPages = allPages
      .map(url => ({ url, score: scoreUrlRelevance(url, sitemapKeywords) }))
      .sort((a, b) => b.score - a.score)
      .map(r => r.url)
      .slice(0, 60)

    // Blog posts from post-specific sub-sitemaps (live fetch)
    sitemapBlogPostUrls.push(...sitemapDataArr.flatMap(d => d.blogPosts))
  }

  // ── Avoid list ─────────────────────────────────────────────────────────────
  // Prioritise target_keyword over topic title — keywords are the canonical
  // dedup signal. Include both so the model understands what angle is covered.
  const existingTopics = (existingTopicsRes.data ?? []) as { topic: string; target_keyword?: string }[]
  const existingPosts  = (existingPostsRes.data ?? []) as { title?: string; focus_topic?: string; target_keyword?: string }[]
  const avoidEntries: string[] = []
  const avoidSeen = new Set<string>()
  function addAvoid(label: string | null | undefined, kw: string | null | undefined) {
    const key = (kw || label || '').toLowerCase().trim()
    if (!key || avoidSeen.has(key)) return
    avoidSeen.add(key)
    avoidEntries.push(kw && label ? `${label} [kw: ${kw}]` : (kw || label)!)
  }
  existingTopics.forEach(t => addAvoid(t.topic, t.target_keyword))
  existingPosts.forEach(p => addAvoid(p.focus_topic ?? p.title, p.target_keyword))
  // Existing blog posts on the client's site (pre-system) — prevent topic overlap
  sitemapBlogPostUrls.slice(0, 80).forEach(url => {
    try {
      const slug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
      if (slug.length >= 4) addAvoid(slug.replace(/-/g, ' '), null)
    } catch { /* ignore */ }
  })
  const avoidText = avoidEntries.join('\n')

  // ── E-E-A-T context ────────────────────────────────────────────────────────
  const eeat = clientSettings?.eeat_data as Record<string, unknown> | null
  let eeatText = ''
  if (eeat) {
    const parts: string[] = []
    { const tenure = describeTenure(eeat); if (tenure) parts.push(tenure) }
    if (eeat.licenses)             parts.push(`Licenses: ${eeat.licenses}`)
    if (eeat.review_count)         parts.push(`${eeat.review_count} reviews`)
    if (eeat.guarantees)           parts.push(`Guarantees: ${eeat.guarantees}`)
    if (eeat.emergency_availability) parts.push('Emergency service available')
    if (parts.length) eeatText = `\nBusiness credibility: ${parts.join('; ')}`
  }

  // ── Prompt ─────────────────────────────────────────────────────────────────
  // Requested content type (silo may refine this later; used here for GSC copy only).
  const requestedIsBlog = (opts?.contentType ?? 'blog') === 'blog'
  const contextLines: string[] = []
  if (clientSettings?.business_background) contextLines.push(`Business: ${clientSettings.business_background}`)
  if (clientSettings?.services)            contextLines.push(`Services: ${clientSettings.services}`)
  if (clientSettings?.target_audience)     contextLines.push(`Target audience: ${clientSettings.target_audience}`)
  if (clientSettings?.geographic_focus)    contextLines.push(`Geographic focus: ${clientSettings.geographic_focus}`)
  if (clientSettings?.brand_voice)         contextLines.push(`Brand voice: ${clientSettings.brand_voice}`)

  const gscTopText = topPages.length > 0
    ? `\nTop-performing pages:\n${topPages.slice(0, 8).map(p => `  - "${p.query}" → ${stripDomain(p.page)} (${p.totalClicks} clicks, pos ${p.weightedPos.toFixed(1)})`).join('\n')}`
    : ''

  // Append real DataForSEO demand/difficulty/intent to a keyword line when available.
  const kwSuffix = (q: string): string => {
    const d = kwDataMap.get(q.toLowerCase())
    if (!d) return ''
    const parts: string[] = []
    if (d.search_volume != null)      parts.push(`vol ${d.search_volume}`)
    if (d.keyword_difficulty != null) parts.push(`KD ${Math.round(d.keyword_difficulty)}`)
    if (d.intent)                     parts.push(`intent ${d.intent}`)
    return parts.length ? ` | ${parts.join(', ')}` : ''
  }

  const gscGrowthText = growthTargets.length > 0
    ? `\nPage-2 opportunities (pos 10–20) — PRIORITISE these. Each "Existing page" ALREADY EXISTS on the site; write a new SUPPORT article and internally link it to that page.${requestedIsBlog ? ' Do NOT reuse the query verbatim as the blog keyword — extract the educational question behind it and target that instead.' : ''}\n${growthTargets.slice(0, 12).map(p => `  - Keyword: "${p.query}" | Existing page: ${stripDomain(p.page)} (${p.totalImpr} impr, pos ${p.weightedPos.toFixed(1)})${kwSuffix(p.query)}`).join('\n')}`
    : ''

  const gscQuickWinsText = quickWins.length > 0
    ? `\nNear-page-1 clusters (pos 5–9) — each "Existing page" ALREADY EXISTS; write adjacent long-tail SUPPORT articles that internally link back to strengthen these.${requestedIsBlog ? ' Do NOT reuse the query verbatim as the blog keyword — extract the educational question behind it and target that instead.' : ''}\n${quickWins.map(p => `  - Keyword: "${p.query}" | Existing page: ${stripDomain(p.page)} (${p.totalImpr} impr, pos ${p.weightedPos.toFixed(1)})${kwSuffix(p.query)}`).join('\n')}`
    : ''

  // Paid converters. Framed as opportunities rather than support articles: a term that converts
  // in paid is worth its own page unless we already rank for it, which the guardrails below catch.
  const paidText = paidConverters.length > 0
    ? `\nCONVERTS IN PAID SEARCH — these terms produced real leads through Google Ads, so the subject behind them has proven commercial value. They are buying queries, not article subjects: do NOT target one directly, because the page that should rank for it is the client's service page, and a blog post competing with that page costs more than it earns. Target the informational question a searcher asks on the way to it — "cheap ac repair" becomes what actually drives AC repair cost. Worth choosing when nothing above fits better, and never when a guardrail below says we already rank.${requestedIsBlog ? ' These are usually transactional ("near me", "cost", "installation") and belong to a service page, NOT a blog post. Do NOT target one verbatim as the blog keyword: extract the question a buyer asks before they are ready to call — a comparison, a how-it-works, a cost breakdown — and target that instead, linking to the service page that should own the transactional term.' : ''}\n${paidConverters.map(t => `  - "${t.term}" (${t.conversions % 1 === 0 ? t.conversions : t.conversions.toFixed(1)} conversions from ${t.clicks} paid clicks)${kwSuffix(t.term)}`).join('\n')}`
    : ''

  const ahrefsNearText = ahrefsNearMiss.length > 0
    ? `\nRANKING 11–30 (Ahrefs) — close enough that one good article moves them onto page one. Write a SUPPORT article targeting the question behind the keyword and link it to the page that should own the term:\n${ahrefsNearMiss.map(k => `  - "${k.keyword}" (pos ${k.position}${k.volume ? `, ${k.volume} vol` : ''}${k.difficulty != null ? `, KD ${k.difficulty}` : ''})${kwSuffix(k.keyword)}`).join('\n')}`
    : ''

  // The actionable band leads, because this is where a single article changes a position.
  const poolLine = (k: PoolKeyword) => {
    const bits: string[] = []
    if (k.volume != null)     bits.push(`${k.volume} searches/mo`)
    if (k.difficulty != null) bits.push(`KD ${k.difficulty}`)
    if (k.intent)             bits.push(k.intent)
    return `  - "${k.keyword}"${bits.length ? ` (${bits.join(', ')})` : ''}`
  }
  const poolText = candidatePool.length > 0
    ? `\nDISCOVERED OPPORTUNITIES — researched for this client and not yet written about. Unlike every section above, these are NOT things the site already ranks for, so they are the only route to a subject the client sells but has no presence in. Treat them as candidates rather than instructions; every guardrail below still applies.\n${candidatePool.slice(0, 20).map(poolLine).join('\n')}`
    : ''

  const rankNearText = rankNear.length > 0
    ? `\nTRACKED AT 11–30 — the band where one article moves a keyword onto page one. Write a SUPPORT article for the question behind the keyword and link it to the page listed, which is the URL Google currently ranks:\n${rankNear.map(r => `  - "${r.keyword}" is #${r.position}${r.url ? ` at ${stripDomain(r.url)}` : ''}${kwSuffix(r.keyword)}`).join('\n')}`
    : ''

  const rankWeakText = rankWeak.length > 0
    ? `\nTRACKED BELOW 30 — a page exists but is not competitive. A sharper, more specific angle is worth trying; do not repeat the existing page's angle:\n${rankWeak.map(r => `  - "${r.keyword}" is #${r.position}${r.url ? ` at ${stripDomain(r.url)}` : ''}`).join('\n')}`
    : ''

  const gscCtrText = ctrIssues.length > 0
    ? `\nCTR gap opportunities (pos 1–5, CTR below expected for position) — each "Existing page" ranks well but needs topical depth articles:\n${ctrIssues.map(p => `  - Keyword: "${p.query}" | Existing page: ${stripDomain(p.page)} (${p.totalImpr} impr, pos ${p.weightedPos.toFixed(1)}, CTR ${(p.weightedCtr * 100).toFixed(1)}%)`).join('\n')}`
    : ''

  // ── Cannibalization guardrails from real GSC data (first-party — no fencing needed) ──
  // Split on the FIRST '||' (page is a URL with no '||'), so a query containing '||' stays intact.
  const gscRows = Array.from(gscMap.entries()).map(([k, v]) => {
    const i = k.indexOf('||')
    return { page: k.slice(0, i), query: k.slice(i + 2), ...v }
  })
  const bucketedQueries = new Set([...growthTargets, ...quickWins, ...ctrIssues].map(t => t.query))

  // Already winning (pos 1–4, has clicks) and not already surfaced above → do not create competing content.
  // weightedPos >= 1 excludes rows with an unset/zero position that would render a misleading "#0".
  const alreadyWinning = gscRows
    .filter(r => r.weightedPos >= 1 && r.weightedPos <= 4 && r.totalClicks > 0 && !bucketedQueries.has(r.query))
    .sort((a, b) => a.weightedPos - b.weightedPos)
    .slice(0, 12)
  const alreadyWinningText = alreadyWinning.length > 0
    ? `\nALREADY RANKING TOP-5 — DO NOT CANNIBALIZE (live Google positions). Do NOT propose a new primary page for any of these; at most a support/cluster article that internally links to the exact ranking URL:\n${alreadyWinning.map(r => `  - "${r.query}" is already #${Math.round(r.weightedPos)} at ${stripDomain(r.page)}`).join('\n')}`
    : ''

  const ahrefsHoldingText = ahrefsHolding.length > 0
    ? `\nALREADY ON PAGE ONE (Ahrefs) — DO NOT CANNIBALIZE. Do not propose a new primary page for any of these; at most a support article that internally links to the page already ranking:\n${ahrefsHolding.map(k => `  - "${k.keyword}" is already #${k.position}`).join('\n')}`
    : ''

  const rankOwnedText = rankOwned.length > 0
    ? `\nTRACKED IN THE TOP 10 — DO NOT CANNIBALIZE. Google already ranks one of this client's pages for each of these. Never propose a new primary page for one, and never target it as a blog keyword. A SUPPORTING article is allowed only if it covers a genuinely narrower question and internally links to the exact URL below:\n${rankOwned.map(r => `  - "${r.keyword}" is #${r.position}${r.url ? ` at ${r.url}` : ''}`).join('\n')}`
    : ''

  // Self-cannibalization: the same query ranks 2+ of the client's own URLs.
  const byQuery = new Map<string, Set<string>>()
  for (const r of gscRows) {
    if (r.totalImpr <= 0) continue
    const set = byQuery.get(r.query) ?? new Set<string>()
    set.add(r.page)
    byQuery.set(r.query, set)
  }
  const cannibalized = Array.from(byQuery.entries()).filter(([, pages]) => pages.size >= 2).slice(0, 10)
  const cannibalizationText = cannibalized.length > 0
    ? `\n⚠ SELF-CANNIBALIZATION — the same query already ranks multiple of this client's own URLs. Do NOT add another competing page; only propose content that reinforces the single strongest URL:\n${cannibalized.map(([q, pages]) => `  - "${q}" is split across ${pages.size} URLs: ${Array.from(pages).map(stripDomain).slice(0, 4).join(', ')}`).join('\n')}`
    : ''

  const sitemapText = sitemapPages.length > 0
    ? `\nExisting site pages (for internal link planning):\n${sitemapPages.slice(0, 60).map(stripDomain).join('\n')}`
    : ''

  const competitorText = competitorMap.size > 0
    ? `\nCompetitor analysis — write to FILL THE GAPS these competitors missed and improve on their coverage:\n` +
      Array.from(competitorMap.values()).map(cr => {
        // Deduplicate headings across all competitor URLs for this keyword
        const seen = new Set<string>()
        const deduped = Object.entries(cr.headings).flatMap(([, hs]) =>
          hs.filter(h => { const norm = h.toLowerCase().trim(); if (seen.has(norm)) return false; seen.add(norm); return true })
        ).slice(0, 8)
        return `  Keyword: "${cr.keyword}" — competitor headings: ${deduped.map(h => `• ${h}`).join('; ')}`
      }).join('\n')
    : ''

  const guidelinesText = (clientSettings?.topic_guidelines as string | null | undefined)?.trim()
    ? `\nContent Guidelines & Restrictions (strictly follow — never generate topics that violate these):\n${clientSettings!.topic_guidelines}`
    : ''

  // ── Silo context (topical authority hub + cluster strategy) ───────────────
  let siloPromptBlock = ''
  let siloName: string | null = null
  let siloContentType: string | null = null
  let queueKeywords: SiloQueueKeyword[] = []
  if (opts?.siloId) {
    const { data: silo, error: siloErr } = await db
      .from('content_silos')
      .select('id, name, hub_page_url, hub_page_title, central_entity, description, target_keyword, cluster_keywords, target_exists, content_type, inject_internal_links')
      .eq('id', opts.siloId)
      .eq('client_id', clientId)
      .maybeSingle()
    if (siloErr) console.error('[generateTopics] silo fetch error:', siloErr.message)
    if (!silo) {
      console.warn('[generateTopics] silo not found or does not belong to client:', opts.siloId)
      return { topics: [], clientName, count: 0, error: 'Silo not found or access denied' }
    }

    if (silo) {
      siloName        = silo.name as string
      siloContentType = (silo.content_type as string | null) ?? null

      // Fetch existing cluster posts in this silo to prevent duplicate intents
      const { data: existingClusters } = await db
        .from('content_posts')
        .select('title, target_keyword')
        .eq('silo_id', opts.siloId)
        .in('status', ['for_review', 'draft_saved', 'published', 'approved'])
        .limit(30)

      const existingClusterText = (existingClusters ?? [])
        .filter((c: { title: string | null; target_keyword: string | null }) => c.title)
        .map((c: { title: string | null; target_keyword: string | null }) => `  - "${c.title}" — keyword: ${c.target_keyword ?? 'n/a'}`)
        .join('\n')

      // Hub-first block: when hub page doesn't exist yet, inject as FIRST topic instruction
      const hubFirstBlock = (silo.target_exists === false && silo.target_keyword)
        ? `
CRITICAL — HUB PAGE PRIORITY:
The hub/pillar page does not exist yet. The FIRST topic in your response MUST target:
  keyword: "${silo.target_keyword}"
  This topic will be used to create the hub page before any cluster articles.
  Make it a comprehensive, high-authority page — the definitive resource for this entity.
`
        : ''

      // Cluster keyword seeding: inject planned keywords the AI should prioritize
      type ClusterKw = { id?: string; keyword: string; title?: string | null; status: string; priority?: number }
      const plannedKws = ((silo.cluster_keywords ?? []) as ClusterKw[])
        .filter(k => k.status === 'planned')
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
        .slice(0, 12)

      const clusterSeedText = plannedKws.length > 0
        ? `\nDefined cluster keywords not yet covered (PRIORITIZE topics from this list — generate topics targeting these keywords):\n${plannedKws.map(k => `  - "${k.keyword}"${k.title ? ` (suggested title: "${k.title}")` : ''}`).join('\n')}`
        : ''

      // Hub-less silos are the common case: a flat set of keywords with no pillar
      // page. Every silo in production today has hub_page_url NULL, and the
      // hub-and-spoke prompt below would instruct the model to link to a hub that
      // does not exist. Walk the keyword queue instead.
      queueKeywords = await fetchQueueKeywords(db, opts.siloId, count)
      const isKeywordQueue = !silo.hub_page_url && queueKeywords.length > 0

      // An EXHAUSTED hub-less queue is not the hub-and-spoke case. Falling through
      // to the else branch below emitted `Hub page: "..." at (URL not yet set)`
      // plus a rule making a link to it mandatory — telling the model to link to a
      // page that does not exist, while the writer prompt forbids inventing internal
      // URLs. SiloManager still enables Generate on such a silo because
      // content_silos.cluster_keywords stays populated after migration 201's
      // backfill, and the cron path never checks at all, so this is reachable the
      // moment a four-keyword silo is worked through. Nothing to generate is the
      // honest answer.
      if (!silo.hub_page_url && queueKeywords.length === 0) {
        console.warn(`[generateTopics] silo ${opts.siloId} has no hub page and an empty keyword queue — nothing to generate`)
        return {
          topics:     [],
          clientName: '',
          count:      0,
          error:      'This silo has no hub page and every keyword in its queue has been used. Add more keywords to generate from it.',
        }
      }

      if (isKeywordQueue) {
        siloPromptBlock = buildKeywordQueueBlock(
          silo.name as string,
          (silo.description as string | null) ?? null,
          queueKeywords,
          existingClusterText,
          (silo as { inject_internal_links?: boolean }).inject_internal_links !== false,
        )
      } else {
      // Hub-and-spoke: the original strategy, unchanged.
      queueKeywords = []
      siloPromptBlock = `
${hubFirstBlock}TOPICAL SILO — HUB + CLUSTER STRATEGY:
Hub page: "${silo.hub_page_title ?? silo.name}" at ${silo.hub_page_url ?? '(URL not yet set)'}
Central entity: ${silo.central_entity ?? silo.name}${silo.description ? `\nContext: ${silo.description}` : ''}
${existingClusterText ? `\nAlready-published cluster articles in this silo (DO NOT duplicate these intents):\n${existingClusterText}` : ''}
${clusterSeedText}

SILO RULES (override any conflicting instructions above):
1. Every topic must be a distinct subtopic or attribute of the central entity.
2. Every article generated from these topics MUST link back to the hub page as a mandatory internal link.
3. No two topics may target the same search intent — zero cannibalization within the silo.
4. Prioritize subtopics closest to revenue (transactional/commercial intent first within the silo).
5. Think: what questions does a searcher ask BEFORE contacting the business? Those cluster topics funnel authority to the hub.`
      }
    }
  }

  const effectiveContentType = siloContentType ?? opts?.contentType ?? 'blog'
  const isBlog = effectiveContentType === 'blog'

  // Blogs are constrained to informational/educational intent (see blogStrategy.ts).
  // Service/regular pages keep the broader intent enum (local_service, commercial, etc.).
  const intentEnumText      = isBlog ? BLOG_INTENT_ENUM : NON_BLOG_INTENT_ENUM
  const blogIntentGuardrail = isBlog ? `\n${BLOG_INTENT_GUARDRAIL}\n` : ''
  const blogLandscapeInstr  = isBlog ? `\n${BLOG_LANDSCAPE_INSTRUCTION}\n` : ''

  const contentTypeLabel = effectiveContentType === 'service_page'
    ? 'service landing page'
    : effectiveContentType === 'regular_page'
      ? 'evergreen page'
      : 'blog post'

  const contentTypeInstructions = effectiveContentType === 'service_page'
    ? `Each topic must become a dedicated SERVICE LANDING PAGE — not a blog article. Focus on commercial/transactional intent: pages that a visitor lands on when they are actively looking to hire or buy. Structure topics around individual services, service variants, or service+location combinations. Every page must have a clear CTA and conversion goal.`
    : effectiveContentType === 'regular_page'
      ? `Each topic must become an EVERGREEN INFORMATIONAL PAGE — not a blog article. Focus on foundational content that stays relevant year-round: About Us, FAQ, Resources, How We Work, Process, Testimonials concept pages, comparison guides, or educational reference pages. These pages should support navigation and build topical authority without time-sensitive angles.`
      : `Each topic must become a BLOG POST — an article-format piece targeting informational, educational, or comparison search intent. Blog posts are dated and can be time-sensitive. Focus on questions, how-tos, comparisons, and long-tail informational queries.`

  const systemPrompt = `You are an SEO content strategist for ${settings.agency_name ?? 'a digital agency'}.
Suggest ${contentTypeLabel} topic ideas for a client based on their business context and Google Search Console data.

${contentTypeInstructions}
${blogLandscapeInstr}
CLUSTERING RULE: Before finalising your list, check if any two topics target the same search intent. If two proposed topics would compete for the same searcher (e.g. "how to finance a car" and "best auto financing options"), COMBINE them into one stronger comprehensive article and return only one. Each topic must target a clearly distinct audience need. This prevents keyword cannibalization where Google gets confused about which page to rank.

ANGLE DIVERSIFICATION RULE: Every topic in your list must use a different content ANGLE. Never suggest variations of the same angle (e.g. "best roofers in Dallas" and "top-rated roofing companies in Dallas" are the same angle). Vary the angle across your full list — draw from these angle types: how-to guide, cost/pricing breakdown, comparison (A vs B), local case study, FAQ, seasonal tip, problem/solution, buyer's guide, checklist, myth-busting, behind-the-scenes. Aim to cover at least 3 distinct angle types in any list of 5 or more topics.

UNIQUENESS CHECK (HARD RULE): Every topic you return MUST have a target_keyword and search intent that does NOT appear in the "Already covered" list. This applies to topics already published AND to topics scheduled but not yet published — they are all listed. A different city name, plural/singular form, or minor reword is NOT sufficient — the underlying search intent must be genuinely different. If you cannot find ${count} unique topics without overlapping covered intent, reduce the list rather than add near-duplicates.

NICHE DISCOVERY RULE: At least 1 of your ${count} topics MUST be a genuinely new angle the client has never covered — a long-tail, question-based, hyper-local, or underserved subtopic where the client has a realistic path to rank #1 because competition is thin. Do not pick topics where established domains dominate positions 1–5 and the client would realistically land 6–10. Justify in the "ranking_strategy" field exactly why this specific niche topic is winnable from scratch.

Strictly follow any Content Guidelines & Restrictions provided. Never generate topics, target keywords, or angles the client has explicitly asked to avoid.

IMPORTANT: When GSC data lists an "Existing page to support", the suggested topic MUST be a cluster or support article — NOT a new primary page competing with that URL. Target a long-tail or adjacent angle designed to internally link to the existing core page.
${blogIntentGuardrail}${siloPromptBlock ? `\n${siloPromptBlock.trim()}\n` : ''}
Return ONLY a JSON array of exactly ${count} objects:
[
  {
    "topic": "Full blog post title",
    "target_keyword": "primary keyword phrase",
    "search_intent": "${intentEnumText}",
    "secondary_keywords": "comma-separated list of 3–5 LSI/semantic keyword variations",
    "keyword_opportunity": "3–5 sentences: Which specific GSC signal drove this pick (name the page, position, and monthly impressions). Why this exact keyword is the right primary target. When real search volume / keyword difficulty (KD 0–100) / intent figures are shown for the source keyword above, cite them and prefer lower-difficulty, higher-volume, intent-matching keywords. Any seasonal or trending component.",
    "ranking_strategy": "3–5 sentences: Which competitor gaps this article fills. What unique angle or depth will outperform existing page-1 results. Specific linking strategy (which existing site page this supports and why). Why this approach wins for this client over generic competitors.",
    "audience_intent": "2–3 sentences: Who specifically is searching this (describe the person, their situation, and what they are trying to decide or do). What stage of the buyer/research journey they are in. What outcome they need from the content.",
    "why_now": "2–3 sentences: Specific seasonal or trending timing reason with data context if available. Competitor activity or content gap timing. Why generating this topic now versus later maximises the ranking window.",
    "competition_level": "Low/Medium/High — 1-sentence reasoning citing what makes it that level",
    "cluster_group": "kebab-case cluster label (e.g. auto-financing, lease-vs-buy)"
  }
]
No text outside the JSON array.`

  const userPrompt = `Client: ${clientName}
${contextLines.join('\n')}${eeatText}
${siloName ? `\nTarget silo: "${siloName}" — all topics must fit within this topical cluster.` : ''}
${gscGrowthText}
${gscQuickWinsText}
${gscCtrText}
${paidText}
${rankNearText}
${ahrefsNearText}
${poolText}
${competitorText}
${gscTopText}
${alreadyWinningText}
${ahrefsHoldingText}
${rankOwnedText}
${rankWeakText}
${cannibalizationText}
${sitemapText}
${avoidText ? `\nALREADY COVERED — HARD BLOCK (includes both published and scheduled/pending topics for this client — every item on this list is off-limits, even with a slightly different angle):\n${avoidText}` : ''}
${guidelinesText}

${opts?.steerKeyword?.trim() ? `\nEDITOR DIRECTION — the reviewer asked for this regeneration and specified: "${opts.steerKeyword.trim().slice(0, 200)}". Steer the topic toward it where that is compatible with the constraints above. The ALREADY COVERED block still applies and overrides this: if the direction names something already covered, choose the closest angle that is not.\n` : ''}
Suggest ${count} high-impact ${contentTypeLabel} topics${siloName ? ` for the "${siloName}" silo` : ''} that will improve this client's organic search performance.`

  const provider = settings.ai_provider || 'anthropic'
  const model    = settings.ai_model    || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
  const apiKey   = settings.ai_api_key

  // Routed through lib/ai/client so the call is metered. The inline provider branch this
  // replaces discarded the usage block, which is why AI spend was unmeasurable.
  let rawText = ''
  try {
    const completion = await completeText({
      provider: provider as 'anthropic' | 'openai',
      model, apiKey,
      system: systemPrompt,
      user:   userPrompt,
      maxTokens: 8192,
      operation: 'topics',
      clientId,
    })
    rawText = completion.text
  } catch (err) {
    return { topics: [], clientName, count: 0, error: String(err) }
  }

  // ── Parse ──────────────────────────────────────────────────────────────────
  let topics: TopicIdea[] = []
  try {
    const stripped  = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const jsonMatch = stripped.match(/\[[\s\S]*\]/)
    if (jsonMatch) topics = JSON.parse(jsonMatch[0]) as TopicIdea[]
    else console.error('[generateTopics] no JSON array found in AI response, rawText length:', rawText.length)
  } catch (parseErr) {
    console.error('[generateTopics] JSON parse error:', parseErr, 'rawText snippet:', rawText.slice(0, 200))
    return { topics: [], clientName, count: 0, error: 'Failed to parse AI response' }
  }

  if (!topics.length) {
    console.error('[generateTopics] AI returned empty topics array, rawText length:', rawText.length)
    return { topics: [], clientName, count: 0, error: 'No topics returned from AI' }
  }

  // ── Blog-intent safety net ──────────────────────────────────────────────────
  // The guardrail prompt is primary enforcement; this drops transactional/near-me
  // leaks and relabels any non-informational intent the model slipped through. A
  // short valid list beats a padded transactional one (mirrors the uniqueness rule).
  if (isBlog) {
    const before = topics.length
    topics = topics.filter(t => !isForbiddenBlogKeyword(t.target_keyword))
    topics.forEach(t => { if (!isAllowedBlogIntent(t.search_intent)) t.search_intent = 'informational' })
    if (topics.length < before) {
      console.warn(`[generateTopics] dropped ${before - topics.length} transactional/near-me blog topic(s) for client ${clientId}`)
    }
    if (!topics.length) {
      return { topics: [], clientName, count: 0, error: 'All generated topics were transactional/near-me intent — none suitable for a blog. Try again.' }
    }
  }

  // ── Cannibalization guard (enforced, not requested) ───────────────────────
  //
  // Everything above this point is instruction. This is the check: whatever the model returned
  // is compared against what the client already ranks for, and a topic that would compete with
  // a winning page is either dropped or demoted to a supporting article.
  //
  // Built from all three ranking sources so it works whichever ones a client has: GSC positions
  // (always available), Ahrefs (when synced), and tracked DataForSEO ranks (when connected).
  const protectedKeywords = new Map<string, { position: number; url: string | null }>()
  const protect = (kw: string, position: number, url: string | null) => {
    const key = normalizeKeyword(kw)
    if (!key) return
    const existing = protectedKeywords.get(key)
    // Keep the best position we know about, and any URL we have — the strongest claim wins.
    if (!existing || position < existing.position) {
      protectedKeywords.set(key, { position, url: url ?? existing?.url ?? null })
    } else if (!existing.url && url) {
      existing.url = url
    }
  }
  for (const r of alreadyWinning) protect(r.query,   Math.round(r.weightedPos), r.page)
  for (const k of ahrefsHolding)  protect(k.keyword, k.position ?? 10,          null)
  for (const r of rankOwned)      protect(r.keyword, r.position ?? 10,          r.url ?? null)

  if (protectedKeywords.size > 0) {
    const dropped: string[] = []
    const demoted: string[] = []
    topics = topics.filter(t => {
      const kw = normalizeKeyword(t.target_keyword)
      if (!kw) return true

      // Exact collision: a new primary page for a keyword already on page one.
      const direct = protectedKeywords.get(kw)
      if (direct) {
        dropped.push(`"${t.target_keyword}" (already #${direct.position}${direct.url ? ` at ${direct.url}` : ''})`)
        return false
      }

      // A longer variant of a protected keyword — "lawn care" protected, "lawn care in winter"
      // proposed. That is a legitimate article, but only as a supporting one. Whole-phrase match
      // so "careers" never matches "care".
      for (const [prot, info] of Array.from(protectedKeywords.entries())) {
        if (kw === prot) continue
        if (!new RegExp(`(^|\\s)${escapeRegex(prot)}(\\s|$)`).test(kw)) continue
        const directive =
          `SUPPORTING ARTICLE — the client already ranks #${info.position} for "${prot}"` +
          `${info.url ? ` at ${info.url}` : ''}. This must not compete with that page: cover a` +
          ` genuinely narrower question and link to it${info.url ? ` (${info.url})` : ''} as the primary internal link.`
        t.ranking_strategy = t.ranking_strategy ? `${directive} ${t.ranking_strategy}` : directive
        demoted.push(`"${t.target_keyword}" → supports "${prot}"`)
        break
      }
      return true
    })

    if (dropped.length > 0) {
      console.warn(`[generateTopics] cannibalization: dropped ${dropped.length} topic(s) for client ${clientId}: ${dropped.join('; ')}`)
    }
    if (demoted.length > 0) {
      console.log(`[generateTopics] cannibalization: demoted ${demoted.length} topic(s) to supporting for client ${clientId}: ${demoted.join('; ')}`)
    }
    if (!topics.length) {
      // Every proposal collided. Saying so beats saving nothing silently or, worse, saving the
      // collisions.
      return {
        topics: [], clientName, count: 0,
        error: 'Every generated topic targeted a keyword this client already ranks on page one for. Nothing was saved — try again, or widen the silo.',
      }
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const rows = topics.map(t => ({
    client_id:            clientId,
    topic:                t.topic,
    target_keyword:       t.target_keyword,
    search_intent:        t.search_intent       ?? null,
    secondary_keywords:   t.secondary_keywords  ?? null,
    rationale:            [t.keyword_opportunity, t.ranking_strategy, t.audience_intent, t.why_now, t.competition_level].filter(Boolean).join(' | '),
    keyword_opportunity:  t.keyword_opportunity ?? null,
    ranking_strategy:     t.ranking_strategy    ?? null,
    audience_intent:      t.audience_intent     ?? null,
    why_now:              t.why_now             ?? null,
    competition_level:    t.competition_level   ?? null,
    cluster_group:        t.cluster_group       ?? (siloName ? siloName.toLowerCase().replace(/\s+/g, '-') : null),
    competitors_researched: t.target_keyword ? (competitorMap.get(t.target_keyword) ?? null) : null,
    // Only include silo_id when set — column requires migration 149 (content_silos)
    ...(opts?.siloId ? { silo_id: opts.siloId } : {}),
    content_type:         effectiveContentType,
    status:               'pending',
    target_publish_date:  targetPublishDate ?? null,
  }))

  const { data: saved, error: insertError } = await db
    .from('content_topics')
    .insert(rows)
    .select()

  if (insertError) {
    console.error('[generateTopics] insert error:', insertError.message, insertError.details, insertError.hint)
    return { topics: [], clientName, count: 0, error: insertError.message }
  }
  console.log(`[generateTopics] inserted ${(saved ?? []).length} topics for client ${clientId}`)

  const savedTopics = ((saved ?? []) as Array<{ id: string; topic: string; target_keyword: string | null; keyword_opportunity: string | null }>)
    .map(r => ({
      id:                  r.id,
      topic:               r.topic,
      target_keyword:      r.target_keyword ?? null,
      target_publish_date: targetPublishDate ?? null,
      keyword_opportunity: r.keyword_opportunity ?? null,
    }))

  // ── Consume the silo keyword queue ─────────────────────────────────────────
  // Deliberately AFTER the insert: claiming up front would burn keywords on any
  // run that failed at the AI or insert step, and the silo would look exhausted
  // with nothing to show for it.
  if (queueKeywords.length > 0) {
    const claimed = await claimKeywordsForTopics(db, queueKeywords, savedTopics)
    console.log(`[generateTopics] claimed ${claimed.length}/${queueKeywords.length} silo keywords`)
  }

  // ── Email notification (skipped when called from the cron batch flow) ───────
  if (!opts?.suppressEmail) {
    const notifEmail = settings.notification_email as string | null
    const notifConfig = ((settings as Record<string, unknown>).notification_config as NotifConfig | null) ?? {}
    if (notifEmail && getNotif(notifConfig, 'content_topics_generated').email) {
      const agencyName = settings.agency_name ?? 'Agency Dashboard'
      try {
        const appUrl     = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
        const clientLink = `${appUrl}/admin/clients/${clientId}?tab=content&subtab=schedule`
        await sendEmail({
          to:      notifEmail,
          subject: `${agencyName} | ${clientName} — Topics Ready for Review`,
          html:    buildTopicsEmail({ agencyName, clientName, topics: savedTopics, clientLink }),
        })
      } catch (emailErr) {
        console.error('[generateTopics] email error:', emailErr)
      }
    }
  }

  return { topics: savedTopics, clientName, count: savedTopics.length }
}
