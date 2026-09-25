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
// It is the same call either way — the pool this writes is what topic selection reads, so
// researching here costs nothing extra downstream. getResearchCandidates() finds the fresh
// timestamp and reuses this run rather than buying its own.
//
// WHY POST
//
// A GET that spends money is a GET that gets prefetched, retried and crawled. The read path is
// separate and free.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { discoverKeywords, resetResearchPool } from '@/lib/content/clientResearch'

// Six sequential Labs calls, each with its own 30s timeout. 120s could not hold them, and a
// kill loses the whole run AND the last_keyword_research_at stamp — so the next topic
// generation buys it all again.
export const maxDuration = 300

/** Matches RESEARCH_MAX_AGE_DAYS in clientResearch.ts — the window getResearchCandidates reuses. */
const RESEARCH_REUSE_DAYS = 30

/** What the wizard renders. Shaped for reading, not for the pipeline. */
interface ResearchPayload {
  keywords:     Array<{ keyword: string; volume: number | null; difficulty: number | null; intent: string | null; source: string | null }>
  competitors:  string[]
  /** Present and false when DataForSEO is not connected for this client. */
  connected:    boolean
  /** Why nothing came back, when nothing came back. */
  reason?:      string
  discovered?:  number
  cost?:        number
  researchedAt?: string | null
}

/** The stored pool, best first. Free — this is a database read. */
async function readStored(clientId: string): Promise<ResearchPayload['keywords']> {
  const db = createAdminClient()
  try {
    const base = () => db
      .from('seo_keywords')
      .select('keyword, search_volume, keyword_difficulty, intent, source')
      .eq('client_id', clientId)
    // Dismissed rows are not shown. With-filter first, then without, for a database that has
    // not run migration 223 yet.
    let { data, error } = await base().is('dismissed_at', null).limit(200)
    if (error && /dismissed_at/i.test(error.message)) ({ data } = await base().limit(200))
    // Sorted in JS — see the note in clientResearch.ts read(): the server-side order clause on
    // this select has been observed returning nothing at all, silently.
    return ((data ?? []) as Record<string, unknown>[]).map(r => ({
      keyword:    String(r.keyword ?? '').trim(),
      volume:     r.search_volume      == null ? null : Number(r.search_volume),
      difficulty: r.keyword_difficulty == null ? null : Number(r.keyword_difficulty),
      intent:     r.intent             == null ? null : String(r.intent),
      source:     r.source             == null ? null : String(r.source),
    }))
      .filter(k => k.keyword)
      .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))
      .slice(0, 60)
  } catch {
    // seo_keywords arrives with migration 189; until then there is simply nothing to show.
    return []
  }
}

async function researchedAt(clientId: string): Promise<string | null> {
  try {
    const { data } = await createAdminClient()
      .from('content_settings')
      .select('last_keyword_research_at')
      .eq('client_id', clientId)
      .maybeSingle()
    const v = (data as Record<string, unknown> | null)?.last_keyword_research_at
    return v == null ? null : String(v)
  } catch {
    return null
  }
}

/** Read-only: whatever research has already stored. Never spends. */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = request.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

  const [keywords, at] = await Promise.all([readStored(clientId), researchedAt(clientId)])
  const payload: ResearchPayload = {
    keywords,
    competitors:  [],
    // Keywords present, not "research ran": stampResearchRun fires for database-only runs too,
    // so a client with no DataForSEO connection was reported as connected here while the POST
    // path called the same client disconnected.
    connected:    keywords.length > 0,
    researchedAt: at,
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
   * 30-day window lives in getResearchCandidates(). Since the wizard fires this on reaching the
   * research step rather than on a button press, every visit re-bought the full six Labs calls
   * for a client that had been researched an hour earlier. Opening the wizard twice to check a
   * setting cost twice.
   *
   * `force: true` is the deliberate re-run, for when the operator has changed the seeds and
   * wants the market looked at again.
   */
  if (!force) {
    const at = await researchedAt(clientId)
    const cutoff = new Date(Date.now() - RESEARCH_REUSE_DAYS * 86_400_000).toISOString()
    if (at && at >= cutoff) {
      const keywords = await readStored(clientId)
      return NextResponse.json({
        keywords,
        competitors:  [],
        connected:    keywords.length > 0,
        reason:       'Reusing research from the last 30 days',
        researchedAt: at,
      } satisfies ResearchPayload)
    }
  }

  // A forced run is "look again with what I have told you now". Discovery only ever adds
  // unknown keywords, so without clearing the pool first the operator would change the seeds,
  // pay again, and see the same list. Tracked, claimed and dismissed rows survive the reset.
  if (force) {
    const removed = await resetResearchPool(clientId)
    console.log(`[keyword-research] forced re-run for ${clientId}: cleared ${removed} candidate(s)`)
  }

  const result = await discoverKeywords(clientId)

  const payload: ResearchPayload = {
    keywords:     await readStored(clientId),
    competitors:  result.competitors,
    // `ok` with no cost and no competitors means the database-only sources answered, which is
    // what a client without a DataForSEO connection gets. Say so rather than showing a thin
    // list as though it were the whole market.
    connected:    result.cost > 0 || result.competitors.length > 0,
    reason:       result.reason,
    discovered:   result.discovered,
    cost:         result.cost,
    researchedAt: await researchedAt(clientId),
  }
  return NextResponse.json(payload)
}


/** Mark a researched keyword irrelevant (or take that back). { client_id, keyword, dismissed }. */
export async function PATCH(request: NextRequest) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { client_id?: string; keyword?: string; dismissed?: boolean } = {}
  try { body = await request.json() } catch { /* handled below */ }
  const clientId = String(body.client_id ?? '').trim()
  const keyword  = String(body.keyword ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
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
