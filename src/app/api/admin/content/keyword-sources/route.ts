// /api/admin/content/keyword-sources?client_id=…
//
// The keyword sources topic selection reads, so the Analytics tab can show them.
//
// Search Console and tracked ranks already have a home in that tab. These three did not: they
// shaped every topic decision and were invisible, so there was no way to check what the system
// saw before it chose. That is the gap this closes — it surfaces data already being collected and
// makes no external calls.
//
// Every query soft-fails independently. A client without Ahrefs still sees their paid terms, and a
// client with none of it sees an empty panel rather than an error.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { researchScoreOf, localVolumeOf } from '@/lib/content/clientResearch'
import { readResearchLocation } from '@/lib/connectors/dataforseo'

export const dynamic = 'force-dynamic'

/**
 * How far back to read converting paid terms for this panel.
 *
 * NOT the window topic selection uses — generateTopics reads 28 days. This is a wider view on
 * purpose, so the panel shows a quarter of paid evidence rather than a month, but the two
 * numbers will not agree and the comment used to claim they did.
 */
const PAID_WINDOW_DAYS = 90

export interface PaidTermRow  { term: string; conversions: number; spend: number; costPerLead: number | null }
export interface AhrefsRow    { keyword: string; position: number | null; volume: number | null; difficulty: number | null }
export interface ResearchRow  { keyword: string; volume: number | null; difficulty: number | null; intent: string | null; score: number | null; local_volume: number | null }

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()

  // ── Google Ads: terms that actually produced leads ────────────────────────
  // Aggregated here rather than in SQL because PostgREST has no GROUP BY; the row count is
  // bounded by the same limit topic selection uses.
  const paidTerms: PaidTermRow[] = await (async () => {
    try {
      const since = new Date(Date.now() - PAID_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await db
        .from('google_ads_search_terms')
        .select('search_term, conversions, spend')
        .eq('client_id', clientId)
        .gte('date', since)
        .gt('conversions', 0)
        .limit(2000)
      if (error) { console.warn('[keyword-sources] paid terms query failed:', error.message); return [] }
      const byTerm = new Map<string, { conversions: number; spend: number }>()
      for (const r of (data ?? []) as { search_term: string; conversions: number | null; spend: number | null }[]) {
        const term = String(r.search_term ?? '').trim()
        if (!term) continue
        const agg = byTerm.get(term) ?? { conversions: 0, spend: 0 }
        agg.conversions += Number(r.conversions) || 0
        agg.spend       += Number(r.spend)       || 0
        byTerm.set(term, agg)
      }
      return Array.from(byTerm.entries())
        .map(([term, a]) => ({
          term,
          conversions: Number(a.conversions.toFixed(2)),
          spend:       Number(a.spend.toFixed(2)),
          // What a lead from this term actually cost — the number that says whether ranking for
          // it organically is worth an article.
          costPerLead: a.conversions > 0 ? Number((a.spend / a.conversions).toFixed(2)) : null,
        }))
        .sort((a, b) => b.conversions - a.conversions || b.spend - a.spend)
        .slice(0, 50)
    } catch { return [] }
  })()

  // ── Ahrefs: organic positions GSC under-reports ───────────────────────────
  const ahrefs: AhrefsRow[] = await (async () => {
    try {
      const { data, error } = await db
        .from('ahrefs_keywords')
        .select('keyword, position, volume, difficulty, date')
        .eq('client_id', clientId)
        .order('date', { ascending: false })
        .limit(500)
      if (error) { console.warn('[keyword-sources] ahrefs query failed:', error.message); return [] }
      // Newest row wins per keyword — the query is already newest-first.
      const seen = new Map<string, AhrefsRow>()
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        const keyword = String(r.keyword ?? '').trim()
        if (!keyword || seen.has(keyword.toLowerCase())) continue
        seen.set(keyword.toLowerCase(), {
          keyword,
          position:   r.position   == null ? null : Number(r.position),
          volume:     r.volume     == null ? null : Number(r.volume),
          difficulty: r.difficulty == null ? null : Number(r.difficulty),
        })
      }
      return Array.from(seen.values())
        .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
        .slice(0, 100)
    } catch { return [] }
  })()

  // ── DataForSEO research: candidates nothing has been written for yet ──────
  const researched: ResearchRow[] = await (async () => {
    try {
      const base = () => db
        .from('seo_keywords')
        .select('keyword, search_volume, keyword_difficulty, intent, metadata')
        .eq('client_id', clientId)
        .eq('is_tracked', false)
        .is('content_post_id', null)
        // A brand search is never a content target; rows from before the pool excluded them.
        .or('intent.is.null,intent.neq.navigational')
      // Dismissed candidates are not "researched opportunities" any more. Filter first, then
      // without, for a database that has not run migration 223.
      let { data, error } = await base().is('dismissed_at', null).limit(60)
      if (error && /dismissed_at/i.test(error.message)) ({ data, error } = await base().limit(60))
      // PostgREST reports a bad query by RETURNING an error, not by throwing, so a bare catch
      // sees nothing and the panel silently renders empty. Say so instead.
      if (error) { console.warn('[keyword-sources] researched query failed:', error.message); return [] }
      // Sorted here, not in the query. A server-side
      // `.order('search_volume', { nullsFirst: false })` on this exact select returned an empty
      // array against local PostgREST — no error, just nothing — while the identical query
      // without it returned every row. Sixty rows sort for nothing, so this sidesteps the
      // question rather than depending on an answer I could not pin down.
      return ((data ?? []) as Record<string, unknown>[]).map(r => ({
        keyword:    String(r.keyword ?? '').trim(),
        volume:     r.search_volume      == null ? null : Number(r.search_volume),
        difficulty: r.keyword_difficulty == null ? null : Number(r.keyword_difficulty),
        intent:     r.intent             == null ? null : String(r.intent),
        score:      researchScoreOf(r.metadata),
        local_volume: localVolumeOf(r.metadata),
      }))
        .filter(k => k.keyword)
        .sort((a, b) => (b.score ?? -1e9) - (a.score ?? -1e9) || (b.volume ?? -1) - (a.volume ?? -1))
    } catch { return [] }   // seo_keywords only exists from migration 189
  })()

  // Where the researched numbers were measured (migration 224), so the tab can say so.
  let researchLocation: string | null = null
  try {
    const { data: cs } = await db.from('content_settings').select('research_location').eq('client_id', clientId).maybeSingle()
    researchLocation = readResearchLocation((cs as { research_location?: unknown } | null)?.research_location)?.name ?? null
  } catch { /* column absent */ }

  return NextResponse.json({ paidTerms, ahrefs, researched, researchLocation })
}
