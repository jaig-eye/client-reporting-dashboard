// GET /api/cron/keyword-discovery
//
// Refills each client's candidate pool when it runs thin.
//
// Demand-driven rather than calendar-driven: a client publishing twice a week consumes candidates
// faster than one publishing monthly, and a quarterly rule would either starve the first or waste
// calls on the second. The pool size is the signal, so no cadence needs tuning.
//
// Discovery is cheap and infrequent by nature — a handful of Labs tasks per client, at roughly a
// penny each — so the guard here is about not repeating work rather than about cost.
//
// Nothing this runs starts tracking a keyword or commissions a post. Candidates land unclaimed and
// untracked; choosing from them stays a human decision.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronAuth } from '@/lib/auth'
import { discoverKeywords, unclaimedPoolSize } from '@/lib/content/keywordDiscovery'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Below this many unclaimed candidates, a client is due a refill. */
const POOL_LOW_WATER = 40
/** Never re-run for the same client inside this window, however thin the pool looks. */
const MIN_DAYS_BETWEEN_RUNS = 30
/** Bound a run: each client costs several Labs calls and the function has 300 seconds. */
const MAX_CLIENTS_PER_RUN = 5

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Only clients that generate content — discovery for a client with no content programme would
  // build a pool nobody draws from.
  let clientIds: string[] = []
  try {
    const { data } = await db
      .from('content_settings')
      .select('client_id')
      .not('client_id', 'is', null)
      .limit(500)
    clientIds = ((data ?? []) as { client_id: string }[]).map(r => r.client_id)
  } catch (e) {
    console.warn('[cron/keyword-discovery] no clients queryable:', e)
    return NextResponse.json({ ok: true, dormant: true, ran: 0 })
  }
  if (clientIds.length === 0) return NextResponse.json({ ok: true, ran: 0 })

  // When was each client last discovered? Recorded as usage, so no extra bookkeeping table.
  const since = new Date(Date.now() - MIN_DAYS_BETWEEN_RUNS * 86_400_000).toISOString().slice(0, 10)
  const recentlyRun = new Set<string>()
  try {
    const { data } = await db
      .from('dataforseo_usage')
      .select('client_id')
      .eq('operation', 'keyword_discovery')
      .gte('date', since)
    for (const r of (data ?? []) as { client_id: string | null }[]) {
      if (r.client_id) recentlyRun.add(r.client_id)
    }
  } catch {
    // Usage table missing — treat every client as never run rather than skipping them all.
  }

  const due: string[] = []
  for (const clientId of clientIds) {
    if (recentlyRun.has(clientId)) continue
    // A client who has never been discovered has an empty pool, which reads as thin and is exactly
    // right: the first run is the one that matters most.
    if (await unclaimedPoolSize(clientId) >= POOL_LOW_WATER) continue
    due.push(clientId)
    if (due.length >= MAX_CLIENTS_PER_RUN) break
  }

  if (due.length === 0) return NextResponse.json({ ok: true, ran: 0, reason: 'every pool is stocked' })

  const results: Array<{ clientId: string; discovered: number; stored: number; cost: number; reason?: string }> = []
  let cost = 0
  for (const clientId of due) {
    try {
      const r = await discoverKeywords(clientId)
      cost += r.cost
      results.push({ clientId, discovered: r.discovered, stored: r.stored, cost: r.cost, reason: r.reason })
    } catch (e) {
      console.error(`[cron/keyword-discovery] failed for ${clientId}:`, e)
      results.push({ clientId, discovered: 0, stored: 0, cost: 0, reason: 'failed' })
    }
  }

  const stored = results.reduce((s, r) => s + r.stored, 0)
  console.log(`[cron/keyword-discovery] ${due.length} client(s), ${stored} new candidate(s), $${cost.toFixed(4)}`)
  return NextResponse.json({ ok: true, ran: due.length, stored, cost: Number(cost.toFixed(4)), results })
}
