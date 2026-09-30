// The monthly ceiling on DataForSEO spend.
//
// WHY
//
// Everything that spends was tuned to be individually cheap — depth 30 instead of 100, a cadence
// that tapers, one snapshot per keyword for its life. That controls the slope. It does not control
// the total, and the total is what runs away: a batch of new clients, a posting schedule doubled,
// a cron retrying something it cannot complete. The ledger recorded all of it and nothing ever
// stopped.
//
// So there is a ceiling now, checked before the paid paths run.
//
// HOW IT BEHAVES
//
// Over budget is not an error. Research skips and the pool keeps whatever it already had; rank
// checks skip and the last reading stands; snapshots skip and the keyword is still chosen. The
// month rolls over and everything resumes. Nothing a client sees depends on it — the same
// degradation as DataForSEO being disconnected, which every one of these paths already handles.
//
// FAILING SAFE
//
// No budget set means no ceiling, which is the behaviour this replaced. But once a budget IS set,
// a ledger we cannot read has to stop the spending: an unreadable ledger means the spend is
// unknown, and "unknown" is not a reason to keep buying against a limit someone deliberately set.

import { createAdminClient } from '@/lib/supabase/server'

export interface BudgetState {
  /** The ceiling, or null when there is none. */
  limit:   number | null
  /** Spent so far this calendar month. */
  spent:   number
  /** Whether a paid call may proceed. */
  allowed: boolean
  /** Said plainly, for a log line or a panel. */
  reason?: string
}

/**
 * Cached briefly.
 *
 * A rankings run asks this once per client and a research run once per call, but a future caller
 * might ask per keyword. Sixty seconds keeps a tight loop from turning the guard into its own
 * source of load, and is far shorter than the window it is guarding.
 */
const CACHE_MS = 60_000
let cache: { at: number; state: BudgetState } | null = null

export function firstOfMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

type Db = ReturnType<typeof createAdminClient>

/**
 * Total recorded DataForSEO spend since `sinceDate`, read in pages.
 *
 * The ledger is one row per call or per client-day, so a month passes 1,000 rows with a handful of
 * clients. A single read is silently cut at PostgREST's 1,000-row cap — `.limit(20_000)` does not
 * lift it — and the sum then undercounts until the ceiling can never trip.
 */
export async function sumDfsSpendSince(db: Db, sinceDate: string): Promise<{ spent: number; error: string | null }> {
  let spent = 0
  for (let from = 0; from < 500_000; from += 1000) {
    const { data, error } = await db
      .from('dataforseo_usage')
      .select('cost')
      .gte('date', sinceDate)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) return { spent, error: error.message }
    for (const r of (data ?? []) as { cost: unknown }[]) spent += Number(r.cost) || 0
    if ((data ?? []).length < 1000) break
  }
  return { spent, error: null }
}

/** Month-to-date spend against the ceiling. */
export async function getDfsBudget(): Promise<BudgetState> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.state

  const unlimited: BudgetState = { limit: null, spent: 0, allowed: true }
  try {
    const db = createAdminClient()

    // The column arrives with migration 226. Without it there is no ceiling, which is what every
    // database did until now — so a missing column reads as "no limit", not as "stop".
    const { data: settings, error: setErr } = await db
      .from('agency_settings')
      .select('dataforseo_monthly_budget')
      .limit(1)
      .maybeSingle()
    if (setErr) {
      if (/dataforseo_monthly_budget/i.test(setErr.message)) {
        cache = { at: Date.now(), state: unlimited }
      } else {
        // Infrastructure, not a decision: allowed, and not cached, so the next caller asks again.
        console.warn('[dfs-budget] cannot read the budget, allowing this call:', setErr.message)
      }
      return unlimited
    }

    const raw = (settings as { dataforseo_monthly_budget?: unknown } | null)?.dataforseo_monthly_budget
    const limit = raw == null ? null : Number(raw)
    if (limit == null || !isFinite(limit) || limit < 0) {
      cache = { at: Date.now(), state: unlimited }
      return unlimited
    }
    // $0 is a ceiling like any other: it means spend nothing, not "no limit".

    // One retry before holding spend: most read failures are a blip, and holding costs a whole
    // day's rank checks when the cron is the caller.
    let usage = await sumDfsSpendSince(db, firstOfMonth())
    if (usage.error) usage = await sumDfsSpendSince(db, firstOfMonth())
    if (usage.error) {
      // A budget is set and the spend is unknowable. Stopping is the only honest reading — but it is
      // not cached, so a recovered database is believed on the very next call.
      console.error('[dfs-budget] budget set but usage unreadable, holding spend:', usage.error)
      return { limit, spent: NaN, allowed: false, reason: 'could not read this month’s usage' }
    }

    const spent = usage.spent
    const state: BudgetState = spent >= limit
      ? { limit, spent, allowed: false, reason: `monthly budget reached ($${spent.toFixed(2)} of $${limit.toFixed(2)})` }
      : { limit, spent, allowed: true }
    cache = { at: Date.now(), state }
    return state
  } catch (e) {
    // An exception here is infrastructure, not a budget decision. The paid paths each degrade
    // safely on their own, and blocking every one of them over a thrown error would be a worse
    // failure than the one being guarded against.
    console.warn('[dfs-budget] check failed, allowing:', e instanceof Error ? e.message : e)
    return unlimited
  }
}

/**
 * Dollars left under the ceiling this month: Infinity with no ceiling, 0 when spending is held.
 *
 * For a caller that spends in a batch — the rank cron — to size the batch, so the ceiling is not
 * overshot by a whole run's worth of checks bought after a single "allowed".
 */
export async function remainingDfsBudget(): Promise<number> {
  const state = await getDfsBudget()
  if (!state.allowed) return 0
  if (state.limit == null) return Infinity
  return Math.max(0, state.limit - state.spent)
}

/**
 * True when a paid DataForSEO call may go ahead.
 *
 * Logs once per refusal so a quiet month-end is visible in the logs rather than looking like the
 * feature broke.
 */
export async function canSpendOnDfs(context: string): Promise<boolean> {
  const state = await getDfsBudget()
  if (!state.allowed) console.warn(`[dfs-budget] ${context} skipped — ${state.reason}`)
  return state.allowed
}

/** Drops the cache. For a caller that has just spent enough to matter. */
export function resetDfsBudgetCache(): void {
  cache = null
}
