// GET /api/cron/keyword-research — keeps each client's keyword research no older than a month.
//
// Research used to run inline from topic generation whenever what was stored had aged past 30
// days: inside the content cron's five-minute budget, once per slot, and bought again whenever a
// run failed to store. It is its own job now. Topic selection only reads the keywords a person
// ticked; this is the one place research is bought on a schedule.
//
// Daily at 04:30 UTC, a few clients per pass, stalest first. A client is due once its last
// research is 30 days old, so each client is researched about once a month, and a failed run is
// retried the next day rather than on every topic generation. Every paid call still goes through
// the monthly DataForSEO ceiling, and every one reaches the ledger as it is made.
//
// Only clients whose content is switched on (content_settings.auto_generate). Research exists to
// feed the writer; a client whose content is paused would be paying monthly for a list nobody uses.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronAuth } from '@/lib/auth'
import { discoverKeywords, isResearchDue } from '@/lib/content/clientResearch'
import { canSpendOnDfs, resetDfsBudgetCache } from '@/lib/content/dfsBudget'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Clients researched per pass. One run is ~25 DataForSEO calls and can take a minute or more. */
const MAX_PER_RUN = 3
/**
 * No paid call starts after this, measured from the start of the pass. What is left of maxDuration
 * holds the slowest call (60s) and the storage after it, so a run always records and stores.
 */
const PAID_WINDOW_MS = 210_000
/** A client is only started with at least this much of the paid window left, so it is not cut short. */
const MIN_CLIENT_WINDOW_MS = 120_000

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const startedAt = Date.now()
  const paidUntil = startedAt + PAID_WINDOW_MS
  const db = createAdminClient()

  const { data: conns, error: connErr } = await db
    .from('client_connections')
    .select('client_id, external_id, connector:connectors!inner(type)')
    .eq('connector.type', 'dataforseo')
    .eq('status', 'active')
  if (connErr) {
    console.error('[cron/keyword-research] connections unreadable:', connErr.message)
    return NextResponse.json({ ok: false, error: 'connections unreadable' }, { status: 500 })
  }
  const clientIds = Array.from(new Set(
    ((conns ?? []) as { client_id: string; external_id: string | null }[])
      .filter(c => (c.external_id ?? '').trim())
      .map(c => c.client_id),
  ))
  if (clientIds.length === 0) return NextResponse.json({ ok: true, dormant: true, researched: [] })

  // Content on, and when research last ran. A client with no settings row is skipped: research is
  // for the content pipeline, and the freshness stamp is an update to that row, so without one it
  // would read as due — and be bought again — every day. Unreadable settings research nobody:
  // without auto_generate there is no telling whose content is on, and a skipped day costs nothing.
  const { data: cs, error: csErr } = await db
    .from('content_settings')
    .select('client_id, last_keyword_research_at, auto_generate')
    .in('client_id', clientIds)
  if (csErr) {
    console.error('[cron/keyword-research] content settings unreadable, researching nobody:', csErr.message)
    return NextResponse.json({ ok: false, error: 'content settings unreadable' }, { status: 500 })
  }
  const lastRun = new Map<string, string | null>()
  for (const r of (cs ?? []) as { client_id: string; last_keyword_research_at: string | null; auto_generate: boolean | null }[]) {
    if (r.auto_generate === true) lastRun.set(r.client_id, r.last_keyword_research_at)
  }
  // Stalest first, so a backlog clears in order rather than the same clients winning every night.
  const ordered = clientIds
    .filter(id => lastRun.has(id))
    .sort((a, b) => String(lastRun.get(a) ?? '').localeCompare(String(lastRun.get(b) ?? '')))

  const researched: Array<{ clientId: string; ok: boolean; stored: number; cost: number; partial?: boolean; reason?: string }> = []
  let stoppedBy: string | null = null
  for (const clientId of ordered) {
    if (researched.length >= MAX_PER_RUN) { stoppedBy = 'per-run cap'; break }
    if (paidUntil - Date.now() < MIN_CLIENT_WINDOW_MS) { stoppedBy = 'time'; break }
    if (!(await isResearchDue(clientId))) continue
    if (!(await canSpendOnDfs('monthly keyword research'))) { stoppedBy = 'budget'; break }

    try {
      const r = await discoverKeywords(clientId, { deadline: paidUntil })
      researched.push({
        clientId, ok: r.ok, stored: r.stored, cost: r.cost,
        ...(r.partial ? { partial: true } : {}), ...(r.reason ? { reason: r.reason } : {}),
      })
      if (!r.ok) console.warn(`[cron/keyword-research] client ${clientId}: ${r.reason ?? 'failed'} — retried tomorrow`)
    } catch (e) {
      researched.push({ clientId, ok: false, stored: 0, cost: 0, reason: 'research threw' })
      console.error(`[cron/keyword-research] client ${clientId} threw:`, e)
    }
    // The next client's budget check must see what this one just spent, not a minute-old answer.
    resetDfsBudgetCache()
  }

  console.log(`[cron/keyword-research] ${researched.length} client(s) researched` + (stoppedBy ? `, stopped by ${stoppedBy}` : ''))
  return NextResponse.json({ ok: true, researched, stoppedBy })
}
