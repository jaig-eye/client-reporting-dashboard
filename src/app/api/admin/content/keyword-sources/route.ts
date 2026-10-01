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
import { researchScoreOf, localVolumeOf, serviceTagger } from '@/lib/content/clientResearch'
import { readResearchLocation, resolveDfsCreds, type DfsCreds } from '@/lib/connectors/dataforseo'
import { deriveResearchLocation } from '@/lib/content/deriveLocation'

export const dynamic = 'force-dynamic'
/**
 * Do not serve this route's database reads from Next's Data Cache.
 *
 * Next patches the global fetch in route handlers, and supabase-js has no fetch of its own, so
 * every query here is an ordinary cacheable GET. `dynamic = 'force-dynamic'` is not enough on its
 * own: it governs whether the route is re-run, not whether the fetches inside it come from cache,
 * so the route re-ran faithfully and got a stale answer. That is what made a removed keyword come
 * back ticked and survive a page reload while the database had it right all along.
 *
 * Declared per route rather than inside createAdminClient, so only the handlers that must read
 * their own writes pay for it and the rest of the app keeps whatever caching it had.
 */
export const fetchCache = 'force-no-store'

/**
 * How far back to read converting paid terms for this panel.
 *
 * NOT the window topic selection uses — generateTopics reads 28 days. This is a wider view on
 * purpose, so the panel shows a quarter of paid evidence rather than a month, but the two
 * numbers will not agree and the comment used to claim they did.
 */
const PAID_WINDOW_DAYS = 90
/**
 * Where a keyword came from, in one word the list can group on.
 *
 * research stores this as metadata.found_via — 'site' for the client's own footprint,
 * 'competitor' for a rival's, 'idea' for an expansion of the services. Hand-typed rows carry
 * source 'manual'. Grouping the list on this is what tells the operator what they are looking at,
 * which a paragraph above the table never managed to.
 */
function foundViaOf(metadata: unknown, source: unknown): string | null {
  if (String(source ?? '') === 'manual') return 'manual'
  const v = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).found_via : null
  return typeof v === 'string' && v ? v : null
}

/**
 * Rows read from the pool.
 *
 * There used to be a second, tighter cap that showed sixty of these and dropped the rest. It was
 * never a judgement about fitness — the pool is already filtered to content-worthy rows, the list
 * groups variants under one line and has a filter box — so all it did was hide two thirds of what
 * research was paid for behind a number nobody could see past. The read cap stays as a ceiling on
 * the payload; nothing below it is thrown away.
 */
const POOL_READ = 400

/** metadata.service, as research recorded it. */
function serviceFromMetadata(metadata: unknown): string | null {
  const v = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).service : null
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export interface PaidTermRow  { term: string; conversions: number; spend: number; costPerLead: number | null }
export interface AhrefsRow    { keyword: string; position: number | null; volume: number | null; difficulty: number | null }
export interface ResearchRow  {
  keyword:      string
  volume:       number | null
  difficulty:   number | null
  intent:       string | null
  score:        number | null
  local_volume: number | null
  source:       string | null
  foundVia:     string | null
  chosen:       boolean
  /** Leads this term produced in paid search, when it is one we bought clicks on. */
  leads?:       number
  /**
   * The client service this keyword is about — one of the `services` the response lists, or null
   * when it matches none (a typed-in keyword, the site's own rankings). Research records it; rows
   * stored before it did are matched here the same way.
   */
  service:      string | null
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req.cookies.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const db = createAdminClient()

  /**
   * Leads per term across the whole window, before the table's top-50 cut.
   *
   * The keyword list joins against this to fill its Leads column, and it has to be the full set:
   * joining against the displayed fifty would blank the column for every keyword ranked 51st or
   * lower by conversions, which reads as "no leads" rather than "not in the top fifty".
   */
  const leadsByTerm = new Map<string, number>()

  // Each block below is an async thunk rather than an awaited expression, so they can be run
  // together at the bottom instead of one after another. This route feeds the whole Keywords page
  // now that it is one page rather than three tabs — seven round trips in series was seven times
  // the slowest query, for queries that do not depend on each other.

  // ── Google Ads: terms that actually produced leads ────────────────────────
  // Aggregated here rather than in SQL because PostgREST has no GROUP BY; the row count is
  // bounded by the same limit topic selection uses.
  const readPaidTerms = async (): Promise<PaidTermRow[]> => {
    try {
      const since = new Date(Date.now() - PAID_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
      // Read in pages. Rows are per term per day per ad group, so a busy account passes PostgREST's
      // 1,000-row cap in weeks, and the conversions, spend and cost per lead shown were sums over
      // whichever thousand came back.
      type PaidRow = { search_term: string; conversions: number | null; spend: number | null }
      const data: PaidRow[] = []
      for (let from = 0; from < 20_000; from += 1000) {
        const { data: page, error } = await db
          .from('google_ads_search_terms')
          .select('search_term, conversions, spend')
          .eq('client_id', clientId)
          .gte('date', since)
          .gt('conversions', 0)
          .order('id', { ascending: true })
          .range(from, from + 999)
        if (error) { console.warn('[keyword-sources] paid terms query failed:', error.message); return [] }
        data.push(...((page ?? []) as PaidRow[]))
        if ((page ?? []).length < 1000) break
      }
      const byTerm = new Map<string, { conversions: number; spend: number }>()
      for (const r of data) {
        const term = String(r.search_term ?? '').trim()
        if (!term) continue
        const agg = byTerm.get(term) ?? { conversions: 0, spend: 0 }
        agg.conversions += Number(r.conversions) || 0
        agg.spend       += Number(r.spend)       || 0
        byTerm.set(term, agg)
      }
      for (const [term, a] of Array.from(byTerm.entries())) {
        if (a.conversions > 0) leadsByTerm.set(term.toLowerCase(), Math.round(a.conversions * 10) / 10)
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
  }

  // ── Ahrefs: organic positions GSC under-reports ───────────────────────────
  const readAhrefs = async (): Promise<AhrefsRow[]> => {
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
  }

  /**
   * How many candidates exist, which is not the same as how many are returned.
   *
   * A separate count rather than the length of the array below, because that array is capped at
   * POOL_READ — reporting its length as the total would tell a client with a thousand candidates
   * that they have four hundred.
   */
  const readPoolTotal = async (): Promise<number | null> => {
    try {
      const { count, error } = await db
        .from('seo_keywords')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('is_tracked', false)
        .is('content_post_id', null)
        .is('dismissed_at', null)
        .or('intent.is.null,intent.neq.navigational')
      if (error) { console.warn('[keyword-sources] pool count failed:', error.message); return null }
      return count ?? null
    } catch { return null }
  }

  // ── DataForSEO research: candidates nothing has been written for yet ──────
  const readResearched = async (): Promise<{ rows: ResearchRow[] }> => {
    try {
      const base = (cols: string) => db
        .from('seo_keywords')
        .select(cols)
        .eq('client_id', clientId)
        .eq('is_tracked', false)
        .is('content_post_id', null)
        // A brand search is never a content target; rows from before the pool excluded them.
        .or('intent.is.null,intent.neq.navigational')
      // chosen_at is migration 225. Without it nothing here can say what was picked — which is
      // what happened before: this select never asked for the column, so every row came back
      // unchosen and the tab showed a saved selection as empty every time it was reopened.
      const WITH    = 'keyword, search_volume, keyword_difficulty, intent, metadata, chosen_at, source'
      const WITHOUT = 'keyword, search_volume, keyword_difficulty, intent, metadata, source'
      // A ceiling on the payload, not a shortlist — everything under it is shown.
      let { data, error } = await base(WITH).is('dismissed_at', null).limit(POOL_READ)
      let hasChosen = true
      if (error && /chosen_at/i.test(error.message)) {
        hasChosen = false
        ;({ data, error } = await base(WITHOUT).is('dismissed_at', null).limit(POOL_READ))
      }
      if (error && /dismissed_at/i.test(error.message)) ({ data, error } = await base(hasChosen ? WITH : WITHOUT).limit(POOL_READ))
      // PostgREST reports a bad query by RETURNING an error, not by throwing, so a bare catch
      // sees nothing and the panel silently renders empty. Say so instead.
      if (error) { console.warn('[keyword-sources] researched query failed:', error.message); return { rows: [] } }

      // Chosen rows, read separately and uncapped.
      //
      // The read above has no ORDER BY — deliberately, see the note below — so its limit takes
      // whatever rows Postgres hands back first, which is roughly insertion order. A pool larger
      // than that drops its NEWEST rows, and the newest row is exactly what a hand-typed keyword
      // is: it was added, chosen, saved correctly, and then never appeared, because it sat at
      // position 241 of 241. Choices are few and must never fall off the list that shows choices,
      // so they are fetched on their own and merged in.
      let picked: Record<string, unknown>[] = []
      if (hasChosen) {
        const { data: ch, error: chErr } = await base(WITH).is('dismissed_at', null).not('chosen_at', 'is', null).limit(POOL_READ)
        if (chErr) console.warn('[keyword-sources] chosen query failed:', chErr.message)
        else picked = (ch ?? []) as unknown as Record<string, unknown>[]
      }
      const seen = new Set<string>()
      const merged: Record<string, unknown>[] = []
      for (const r of [...picked, ...((data ?? []) as unknown as Record<string, unknown>[])]) {
        const key = String(r.keyword ?? '').trim().toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        merged.push(r)
      }
      data = merged as never
      // Sorted here, not in the query. A server-side
      // `.order('search_volume', { nullsFirst: false })` on this exact select returned an empty
      // array against local PostgREST — no error, just nothing — while the identical query
      // without it returned every row. A few hundred rows sort for nothing, so this sidesteps the
      // question rather than depending on an answer I could not pin down.
      // Through unknown: the column list is chosen at runtime, so PostgREST's generic cannot
      // narrow it and infers the error shape instead.
      const all: ResearchRow[] = ((data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
        keyword:    String(r.keyword ?? '').trim(),
        volume:     r.search_volume      == null ? null : Number(r.search_volume),
        difficulty: r.keyword_difficulty == null ? null : Number(r.keyword_difficulty),
        intent:     r.intent             == null ? null : String(r.intent),
        score:      researchScoreOf(r.metadata),
        local_volume: localVolumeOf(r.metadata),
        source:     r.source == null ? null : String(r.source),
        // How it was found — site footprint, a competitor, an expansion of the services, or typed
        // in. The list groups on this, which is what tells the operator what they are looking at.
        foundVia:   foundViaOf(r.metadata, r.source),
        chosen:     hasChosen ? r.chosen_at != null : false,
        service:    serviceFromMetadata(r.metadata),
      }))
        .filter(k => k.keyword)
        .sort((a, b) => (b.score ?? -1e9) - (a.score ?? -1e9) || (b.volume ?? -1) - (a.volume ?? -1))

      // Leads, for the rows that came from paid search.
      //
      // A client without DataForSEO has no volume and no difficulty, so every column on the right
      // of the list reads "—" and the table says nothing at all. Those rows are converting ad
      // terms, and the number of leads each produced is a better reason to write about it than
      // search volume ever was — already aggregated above, so this is a join rather than a query.
      for (const k of all) {
        const n = leadsByTerm.get(k.keyword.toLowerCase())
        if (n != null) k.leads = n
      }

      // Chosen first, then everything else by score. A chosen keyword is a decision and belongs
      // at the top of the list that shows decisions; a hand-typed one has no research score at
      // all, so without this it would sort below every discovered row.
      return { rows: [...all.filter(k => k.chosen), ...all.filter(k => !k.chosen)] }
    } catch { return { rows: [] } }   // seo_keywords only exists from migration 189
  }

  // Whether this client can be researched at all.
  //
  // Discovery, search volumes and difficulty all come from DataForSEO, and every paid path is
  // gated on the client having its own connection row — so without one, "Find keywords" is a
  // button that can only ever report finding nothing. Better to say why up front. Adding
  // keywords by hand still works; they simply arrive without volume or difficulty.
  // Whether DataForSEO is connected, and its credentials — the Market card reads the location
  // research would use, and deriving one needs the (free) locations list.
  const readDataForSeo = async (): Promise<{ has: boolean; creds: DfsCreds | null }> => {
    try {
      // Active only, matching research itself: a paused connection buys nothing, so showing it as
      // connected would offer a "Find keywords" that can only come back empty.
      const { data, error } = await db
        .from('client_connections')
        .select('connector:connectors(type, auth)')
        .eq('client_id', clientId)
        .eq('status', 'active')
      if (error) { console.warn('[keyword-sources] connection check failed:', error.message); return { has: true, creds: null } }
      type Conn = { type?: string; auth?: Record<string, unknown> }
      type Row = { connector: Conn | Conn[] | null }
      for (const r of (data ?? []) as Row[]) {
        const c = Array.isArray(r.connector) ? r.connector[0] : r.connector
        if (c?.type === 'dataforseo') return { has: true, creds: resolveDfsCreds(c.auth ?? {}) }
      }
      return { has: false, creds: null }
    } catch { return { has: true, creds: null } }   // unreadable: say nothing rather than claim it is missing
  }

  // Where the researched numbers were measured (migration 224) and when research last ran
  // (migration 222), so the list can say what it is and how old it is instead of leaving the
  // operator to guess whether these were found, invented, or typed in.
  const readSettings = async (): Promise<{ location: string | null; lastRun: string | null; geographicFocus: string }> => {
    try {
      const read = (cols: string) => db.from('content_settings').select(cols).eq('client_id', clientId).maybeSingle()
      let { data: cs, error: locErr } = await read('research_location, last_keyword_research_at, geographic_focus')
      if (locErr && /last_keyword_research_at/i.test(locErr.message)) ({ data: cs, error: locErr } = await read('research_location, geographic_focus'))
      // Migration 224 has landed, so a failure here is a real one, not the column being absent.
      if (locErr) console.warn('[research-location] read failed, staying country-wide:', locErr.message)
      const row = cs as { research_location?: unknown; last_keyword_research_at?: unknown; geographic_focus?: unknown } | null
      return {
        location: readResearchLocation(row?.research_location)?.name ?? null,
        lastRun:  row?.last_keyword_research_at ? String(row.last_keyword_research_at) : null,
        geographicFocus: String(row?.geographic_focus ?? ''),
      }
    } catch { return { location: null, lastRun: null, geographicFocus: '' } }   // column absent
  }

  // Everything that does not depend on anything else, at once. `researched` is the exception: it
  // joins against the leads map that readPaidTerms fills, so it waits for that one alone.
  const [paidTerms, ahrefs, poolTotal, dfs, settings, tagger] = await Promise.all([
    readPaidTerms(), readAhrefs(), readPoolTotal(), readDataForSeo(), readSettings(), serviceTagger(clientId),
  ])
  const hasDataForSeo = dfs.has

  // The market research actually measures in. Nobody picks one any more, so research reads it out
  // of the service areas each run (deriveResearchLocation); showing only a picked location said
  // "Whole country" for every client, including the ones research had placed in a city. Same
  // derivation, same free cached lookup.
  let researchLocation = settings.location
  if (!researchLocation && dfs.creds && settings.geographicFocus) {
    researchLocation = (await deriveResearchLocation(settings.geographicFocus, dfs.creds).catch(() => null))?.location.name ?? null
  }
  const { rows: researched } = await readResearched()

  // Rows stored before research recorded a service are matched now, with the same rule research
  // uses, so the list can be read service by service for every client — not only after its next run.
  for (const k of researched) k.service ??= tagger.serviceOf(k.keyword)

  return NextResponse.json({
    paidTerms, ahrefs, researched,
    // The client's services in its own order: what the list groups by.
    services:         tagger.services,
    researchLocation,
    lastResearchAt:   settings.lastRun,
    poolTotal, hasDataForSeo,
  })
}
