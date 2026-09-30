// POST /api/admin/content/keyword-research  { client_id }
//
// Runs the real keyword research for a client and returns what it found, for the setup wizard
// to show. GET still answers, but only reads back what is already stored — it never spends.
//
// WHY THE WIZARD RESEARCHES
//
// Research used to happen at topic generation, weeks after onboarding, and the wizard ran a
// separate SerpAPI lookup whose only output was a list of related searches nobody could act on.
// That split was backwards in both directions: the operator setting a client up saw nothing
// about the market they were about to write for, and the first real research ran unattended
// with no one to judge it.
//
// It is the same call either way — the pool this writes is what the Keywords tab shows and what a
// person ticks from. The monthly job (/api/cron/keyword-research) sees the fresh timestamp and
// leaves this client alone for 30 days.
//
// WHY POST
//
// A GET that spends money is a GET that gets prefetched, retried and crawled. The read path is
// separate and free.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed, requireWriteAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { discoverKeywords, resetResearchPool, researchScoreOf, localVolumeOf, hasDfsConnection } from '@/lib/content/clientResearch'
import { canSpendOnDfs } from '@/lib/content/dfsBudget'
import { readResearchLocation } from '@/lib/connectors/dataforseo'
import { addManualKeywords } from '@/lib/content/addManualKeywords'

// Six sequential Labs calls, each with its own 30s timeout. 120s could not hold them, and a
// kill loses the whole run AND the last_keyword_research_at stamp — so the next topic
// generation buys it all again.
export const maxDuration = 300

/**
 * How many phrases go into one `in` filter.
 *
 * That filter rides in the URL: five hundred phrases is roughly twelve kilobytes of query string,
 * past what proxies in front of PostgREST accept, and it fails the whole update rather than part
 * of it.
 */
const IN_CHUNK = 100
// Writes then reads the pool back — see keyword-sources/route.ts.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/** Matches RESEARCH_MAX_AGE_DAYS in clientResearch.ts — the monthly job's window. */
const RESEARCH_REUSE_DAYS = 30

/** A forced re-run is refused within this long of the last run: each one is ~15 paid calls. */
const FORCE_COOLDOWN_MS = 60 * 60_000

/** What the wizard renders. Shaped for reading, not for the pipeline. */
interface ResearchPayload {
  /** POST only. False when nothing new was bought or stored; `reason` then says why. */
  ok?:          boolean
  keywords:    Array<{ keyword: string; volume: number | null; difficulty: number | null; intent: string | null; source: string | null; score: number | null; local_volume: number | null; chosen: boolean }>
  competitors:  string[]
  /** Best-rated businesses in the local pack for the seed services; only on a fresh local run. */
  localPack?:   Array<{ title: string; domain: string | null; rating: number | null; votes: number | null }>
  /** Present and false when DataForSEO is not connected for this client. */
  connected:    boolean
  /** Why nothing came back, when nothing came back. */
  reason?:      string
  discovered?:  number
  cost?:        number
  researchedAt?: string | null
  /** Where the pool was measured, when a research location is set: "Los Angeles County,California,United States". */
  researchLocation?: string | null
}

/** The stored pool, best first. Free — this is a database read. */
async function readStored(clientId: string): Promise<ResearchPayload['keywords']> {
  const db = createAdminClient()
  try {
    const COLS = 'keyword, search_volume, keyword_difficulty, intent, source, metadata'
    const base = (cols: string) => db
      .from('seo_keywords')
      .select(cols)
      .eq('client_id', clientId)
      .or('intent.is.null,intent.neq.navigational')
    // chosen_at is migration 225. Without it every keyword reads as chosen, which is exactly the
    // pre-225 behaviour and keeps a database that has not been migrated working unchanged. The
    // retry must drop the column from the select too — retrying the same select failed the same way.
    let hasChosen = true
    let { data, error } = await base(`${COLS}, chosen_at`).is('dismissed_at', null).limit(200)
    if (error && /chosen_at/i.test(error.message)) {
      hasChosen = false
      ;({ data, error } = await base(COLS).is('dismissed_at', null).limit(200))
    }
    // Dismissed rows are not shown. Without migration 223 there is no dismissal to filter on.
    if (error && /dismissed_at/i.test(error.message)) ({ data, error } = await base(hasChosen ? `${COLS}, chosen_at` : COLS).limit(200))
    if (error) console.warn('[keyword-research] stored read failed:', error.message)
    // Sorted in JS — see the note in clientResearch.ts read(): the server-side order clause on
    // this select has been observed returning nothing at all, silently.
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
      keyword:    String(r.keyword ?? '').trim(),
      volume:     r.search_volume      == null ? null : Number(r.search_volume),
      difficulty: r.keyword_difficulty == null ? null : Number(r.keyword_difficulty),
      intent:     r.intent             == null ? null : String(r.intent),
      source:     r.source             == null ? null : String(r.source),
      score:      researchScoreOf(r.metadata),
      local_volume: localVolumeOf(r.metadata),
      chosen:     hasChosen ? r.chosen_at != null : true,
    }))
      .filter(k => k.keyword)
      // Research score first — the order the pool was built to prefer — volume as tie-break.
      .sort((a, b) => (b.score ?? -1e9) - (a.score ?? -1e9) || (b.volume ?? -1) - (a.volume ?? -1))
      .slice(0, 60)
  } catch {
    // seo_keywords arrives with migration 189; until then there is simply nothing to show.
    return []
  }
}

/** When research last ran and where it is measured. Both columns optional (222, 224). */
async function researchMeta(clientId: string): Promise<{ at: string | null; location: string | null }> {
  try {
    const db = createAdminClient()
    const read = (cols: string) => db.from('content_settings').select(cols).eq('client_id', clientId).maybeSingle()
    let { data, error } = await read('last_keyword_research_at, research_location')
    if (error && /research_location/i.test(error.message)) ({ data, error } = await read('last_keyword_research_at'))
    if (error) return { at: null, location: null }
    const row = data as Record<string, unknown> | null
    const at  = row?.last_keyword_research_at
    return { at: at == null ? null : String(at), location: readResearchLocation(row?.research_location)?.name ?? null }
  } catch {
    return { at: null, location: null }
  }
}

/** Read-only: whatever research has already stored. Never spends. */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const [keywords, meta] = await Promise.all([readStored(clientId), researchMeta(clientId)])
  const payload: ResearchPayload = {
    keywords,
    competitors:  [],
    // Keywords present, not "research ran": stampResearchRun fires for database-only runs too,
    // so a client with no DataForSEO connection was reported as connected here while the POST
    // path called the same client disconnected.
    connected:    keywords.length > 0,
    researchedAt: meta.at,
    // The location the STORED pool was measured in, not the current setting: a pool from before
    // the location was set carries no local numbers and must not be labelled with it.
    researchLocation: keywords.some(k => k.local_volume != null) ? meta.location : null,
  }
  return NextResponse.json(payload)
}

/** Spends. Runs discovery, stores the pool, returns it for display. */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let clientId = request.nextUrl.searchParams.get('client_id')
  let force = false
  try {
    const body = await request.json() as { client_id?: string; force?: boolean }
    clientId = clientId ?? body.client_id ?? null
    force = body.force === true
  } catch { /* no body */ }
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  /**
   * Reuse before spending.
   *
   * This route calls discoverKeywords() directly, which has no freshness gate of its own — the
   * 30-day window lives in isResearchDue(), for the monthly job. Without this check every press of
   * the wizard's research button re-bought the full run for a client researched an hour earlier.
   *
   * `force: true` is the deliberate re-run, for when the operator has changed the seeds and
   * wants the market looked at again.
   */
  if (!force) {
    const { at, location } = await researchMeta(clientId)
    const cutoff = new Date(Date.now() - RESEARCH_REUSE_DAYS * 86_400_000).toISOString()
    if (at && at >= cutoff) {
      const keywords = await readStored(clientId)
      return NextResponse.json({
        ok:           true,
        keywords,
        competitors:  [],
        connected:    keywords.length > 0,
        reason:       'Reusing research from the last 30 days',
        researchedAt: at,
        researchLocation: keywords.some(k => k.local_volume != null) ? location : null,
      } satisfies ResearchPayload)
    }
  }

  // A forced run is "look again with what I have told you now". Discovery only ever adds
  // unknown keywords, so without clearing the pool first the operator would change the seeds,
  // pay again, and see the same list. Tracked, claimed and dismissed rows survive the reset.
  if (force) {
    // Deliberate spending: an admin's call, not a viewer's, and not more than once an hour.
    const gate = await requireWriteAdmin()
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
    const { at } = await researchMeta(clientId)
    const sinceLast = at ? Date.now() - Date.parse(at) : Infinity
    if (sinceLast < FORCE_COOLDOWN_MS) {
      const minutes = Math.ceil((FORCE_COOLDOWN_MS - sinceLast) / 60_000)
      return NextResponse.json(
        { error: `This market was researched less than an hour ago. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
        { status: 429 },
      )
    }

    // The pool is only thrown away when a new one can be bought. Resetting first and then finding
    // the budget spent (or no connection) replaced a paid list with a thin database-only one that
    // stayed until the month rolled over.
    const keepReason =
      !(await hasDfsConnection(clientId))           ? 'This client has no DataForSEO connection, so nothing new can be researched. The current list is kept.'
      : !(await canSpendOnDfs('forced keyword research')) ? 'The monthly DataForSEO limit has been reached. The current list is kept until next month or until the limit is raised.'
      : null
    if (keepReason) {
      const [keywords, meta] = await Promise.all([readStored(clientId), researchMeta(clientId)])
      return NextResponse.json({
        ok:           false,
        keywords,
        competitors:  [],
        connected:    keywords.length > 0,
        reason:       keepReason,
        researchedAt: meta.at,
        researchLocation: keywords.some(k => k.local_volume != null) ? meta.location : null,
      } satisfies ResearchPayload)
    }

    const removed = await resetResearchPool(clientId)
    console.log(`[keyword-research] forced re-run for ${clientId}: cleared ${removed} candidate(s)`)
  }

  const result = await discoverKeywords(clientId)
  const meta   = await researchMeta(clientId)

  const payload: ResearchPayload = {
    // False when the run stored nothing it paid for (storage failed, table missing): the UI must
    // show `reason` as a problem, not as a result.
    ok:           result.ok,
    keywords:     await readStored(clientId),
    competitors:  result.competitors,
    localPack:    result.localPack ?? [],
    // `ok` with no cost and no competitors means the database-only sources answered, which is
    // what a client without a DataForSEO connection gets. Say so rather than showing a thin
    // list as though it were the whole market.
    connected:    result.cost > 0 || result.competitors.length > 0,
    reason:       result.reason,
    discovered:   result.discovered,
    cost:         result.cost,
    researchedAt: meta.at,
    researchLocation: result.location ?? null,
  }
  return NextResponse.json(payload)
}


/**
 * Change what we do with researched keywords.
 *
 *   { client_id, keyword, dismissed }        — mark one irrelevant, or take that back
 *   { client_id, keywords: [...], chosen }   — choose or unchoose several at once
 *
 * Bulk matters for choosing: a run returns a few hundred candidates and ticking twenty of them
 * should be one request, not twenty.
 */
export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { client_id?: string; keyword?: string; dismissed?: boolean; keywords?: unknown; chosen?: boolean; add?: unknown; dismiss?: unknown } = {}
  try { body = await request.json() } catch { /* handled below */ }
  const clientId = String(body.client_id ?? '').trim()

  // ── Keywords typed in by hand ─────────────────────────────────────────────
  // Added to the same pool the research writes, chosen on arrival, and given a SERP snapshot the
  // same way any other pick is — so a typed keyword is judged and written from exactly like a
  // discovered one.
  if (Array.isArray(body.add)) {
    if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })
    const db = createAdminClient()
    const result = await addManualKeywords(db, clientId, (body.add as unknown[]).map(k => String(k ?? '')))
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true, ...result })
  }

  // ── Bulk removal ──────────────────────────────────────────────────────────
  // What the single-keyword dismiss below does, for a list. The picking panel needs it because a
  // hand-typed keyword that is un-ticked should leave the list rather than sit in it unchosen
  // forever: it is only there because someone typed it, so un-ticking it is the whole of the
  // decision. Discovered candidates keep the older behaviour — un-ticking one means "not this
  // time", and it stays available.
  if (Array.isArray(body.dismiss)) {
    if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })
    const list = Array.from(new Set(
      (body.dismiss as unknown[]).map(k => String(k ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean),
    )).slice(0, 500)
    if (list.length === 0) return NextResponse.json({ ok: true, dismissed: 0 })
    const db = createAdminClient()
    // Chunked for the same reason the selection below is: an `in` filter rides in the URL.
    //
    // chosen_at is cleared alongside dismissed_at so a removed keyword is not left counting as a
    // choice. It is migration 225 though, and dismissed_at is 223 — so a database with one and not
    // the other has to keep working, the way every other read in this file does. Dropping
    // chosen_at from the patch is the right fallback: on such a database nothing is chosen in the
    // first place.
    const now = new Date().toISOString()
    for (let i = 0; i < list.length; i += IN_CHUNK) {
      const chunk = list.slice(i, i + IN_CHUNK)
      const write = (patch: Record<string, unknown>) => db
        .from('seo_keywords')
        .update(patch)
        .eq('client_id', clientId)
        .in('normalized_keyword', chunk)
      let { error } = await write({ dismissed_at: now, chosen_at: null })
      if (error && /chosen_at/i.test(error.message)) ({ error } = await write({ dismissed_at: now }))
      if (error) {
        const missing = /dismissed_at/i.test(error.message)
        return NextResponse.json(
          { error: missing ? 'Removing keywords needs migration 223 (seo_keywords.dismissed_at)' : error.message },
          { status: missing ? 501 : 500 },
        )
      }
    }
    return NextResponse.json({ ok: true, dismissed: list.length })
  }

  // ── Bulk selection ────────────────────────────────────────────────────────
  if (Array.isArray(body.keywords)) {
    const list = Array.from(new Set(
      (body.keywords as unknown[]).map(k => String(k ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean),
    )).slice(0, 500)
    if (!clientId || list.length === 0) {
      return NextResponse.json({ error: 'client_id and a non-empty keywords array are required' }, { status: 400 })
    }
    const db = createAdminClient()
    // Chunked: an `in` filter rides in the URL, and 500 phrases is roughly twelve kilobytes of
    // query string — past what proxies in front of PostgREST accept, which fails the whole
    // update rather than part of it.
    const chosenAt = body.chosen === false ? null : new Date().toISOString()
    for (let i = 0; i < list.length; i += IN_CHUNK) {
      const { error } = await db
        .from('seo_keywords')
        .update({ chosen_at: chosenAt })
        .eq('client_id', clientId)
        .in('normalized_keyword', list.slice(i, i + IN_CHUNK))
      if (error) {
        const missing = /chosen_at/i.test(error.message)
        return NextResponse.json(
          { error: missing ? 'Choosing keywords needs migration 225 (seo_keywords.chosen_at)' : error.message },
          { status: missing ? 501 : 500 },
        )
      }
    }
    // Picking a keyword no longer buys a SERP snapshot.
    //
    // It used to — one live search per keyword, up to thirty per selection — on the reasoning
    // that the talking points are worth reading before a post is committed. They are, but nothing
    // ever read them: writing an article fetches its own live SERP through competitiveIntel and
    // OVERWRITES the stored one. So the pick-time purchase paid for a row that the first post
    // against that keyword replaced, and its only reader was a display panel.
    //
    // The panel is unaffected. It reads seo_keywords.metadata->serp, which generation still
    // writes — so it now shows the snapshots the writer actually used, filling in as posts are
    // written rather than as keywords are ticked. Later, truer, and free.
    return NextResponse.json({ ok: true, updated: list.length })
  }

  const keyword = String(body.keyword ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!clientId || !keyword) return NextResponse.json({ error: 'client_id and keyword are required' }, { status: 400 })

  const db = createAdminClient()
  const { error } = await db
    .from('seo_keywords')
    .update({ dismissed_at: body.dismissed === false ? null : new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('normalized_keyword', keyword)
  if (error) {
    const missing = /dismissed_at/i.test(error.message)
    return NextResponse.json(
      { error: missing ? 'Dismissing keywords needs migration 223 (seo_keywords.dismissed_at)' : error.message },
      { status: missing ? 501 : 500 },
    )
  }
  return NextResponse.json({ ok: true })
}
