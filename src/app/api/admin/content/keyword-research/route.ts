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
import { discoverKeywords } from '@/lib/content/clientResearch'

// Six sequential Labs calls, each with its own 30s timeout. 120s could not hold them, and a
// kill loses the whole run AND the last_keyword_research_at stamp — so the next topic
// generation buys it all again.
export const maxDuration = 300

/** What the wizard renders. Shaped for reading, not for the pipeline. */
interface ResearchPayload {
  keywords:     Array<{ keyword: string; volume: number | null; difficulty: number | null; intent: string | null }>
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
    const { data } = await db
      .from('seo_keywords')
      .select('keyword, search_volume, keyword_difficulty, intent')
      .eq('client_id', clientId)
      .order('search_volume', { ascending: false, nullsFirst: false })
      .limit(60)
    return ((data ?? []) as Record<string, unknown>[]).map(r => ({
      keyword:    String(r.keyword ?? '').trim(),
      volume:     r.search_volume      == null ? null : Number(r.search_volume),
      difficulty: r.keyword_difficulty == null ? null : Number(r.keyword_difficulty),
      intent:     r.intent             == null ? null : String(r.intent),
    })).filter(k => k.keyword)
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
    connected:    at != null || keywords.length > 0,
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
  if (!clientId) {
    try {
      const body = await request.json() as { client_id?: string }
      clientId = body.client_id ?? null
    } catch { /* no body */ }
  }
  if (!clientId) return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })

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
