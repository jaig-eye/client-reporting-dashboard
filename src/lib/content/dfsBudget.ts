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
// checks skip and the last reading stands; writing skips its SERP lookup and the post is still
// written. The month rolls over and everything resumes. Nothing a client sees depends on it — the
// same degradation as DataForSEO being disconnected, which every one of these paths already handles.
//
// FAILING CLOSED
//
// The only way to spend without a ceiling is to say so: agency_settings.dataforseo_monthly_budget
// present and NULL. Everything else has a ceiling or holds spending:
//
//   column missing (migration 226 not applied)   DEFAULT_MONTHLY_BUDGET, the value 226 sets
//   no agency_settings row, or a garbage value   DEFAULT_MONTHLY_BUDGET
//   settings or ledger unreadable, or a throw    held — allowed: false, and not cached, so a
//                                                recovered database is believed on the next call
//
// "Unknown" is never a reason to keep buying. A held call degrades exactly like an over-budget one,
// which every caller already handles; an unbounded bill does not degrade at all.

import { createAdminClient } from '@/lib/supabase/server'

/** The ceiling migration 226 installs, used whenever the stored one cannot be read as a decision. */
export const DEFAULT_MONTHLY_BUDGET = 100

export interface BudgetState {
  /** The ceiling, or null when there is none. */
  limit:   number | null
  /** Spent so far this calendar month. NaN when the ledger could not be read. */
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
 * source of load, and is far shorter than the window it is guarding. Only answers that came from a
 * successful read are cached — a hold never is.
 */
const CACHE_MS = 60_000
let cache: { at: number; state: BudgetState } | null = null

export function firstOfMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

type Db = ReturnType<typeof createAdminClient>

/**
 * What the settings read means for the ceiling. Pure, so the rule can be tested on its own.
 *
 *   { limit: number }   a ceiling, stored or defaulted
 *   { limit: null }     no ceiling — only ever a column that exists and holds NULL
 *   { hold: string }    the settings could not be read; spend nothing until they can
 */
export function resolveBudgetSetting(
  row: { dataforseo_monthly_budget?: unknown } | null,
  error: { message?: string } | null,
): { limit: number | null } | { hold: string } {
  if (error) {
    // Migration 226 not applied: the ceiling it would have installed, not "no limit".
    if (/dataforseo_monthly_budget/i.test(error.message ?? '')) return { limit: DEFAULT_MONTHLY_BUDGET }
    return { hold: 'could not read the DataForSEO budget' }
  }
  // No agency_settings row at all: nobody decided anything, so the default applies.
  if (!row) return { limit: DEFAULT_MONTHLY_BUDGET }
  if (!('dataforseo_monthly_budget' in row)) return { limit: DEFAULT_MONTHLY_BUDGET }
  const raw = row.dataforseo_monthly_budget
  // Present and NULL is the one deliberate "spend without a ceiling".
  if (raw === null) return { limit: null }
  const n = Number(raw)
  // A value nobody could have meant (negative, text) is not a decision to spend without limit.
  // $0 is a ceiling like any other: it means spend nothing.
  return { limit: Number.isFinite(n) && n >= 0 ? n : DEFAULT_MONTHLY_BUDGET }
}

/**
 * Total recorded DataForSEO spend since `sinceDate`, read in pages.
 *
 * The ledger is one row per paid call or per client-day, so a month passes 1,000 rows with a
 * handful of clients. A single read is silently cut at PostgREST's 1,000-row cap — `.limit(20_000)`
 * does not lift it — and the sum then undercounts until the ceiling can never trip.
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

  // A hold reports a limit even when the stored one could not be read — the default — because a
  // null limit reads as "no ceiling" to the spend panel, which is the opposite of what is happening.
  const hold = (reason: string, limit: number = DEFAULT_MONTHLY_BUDGET): BudgetState => ({ limit, spent: NaN, allowed: false, reason })
  try {
    const db = createAdminClient()
    const { data: settings, error: setErr } = await db
      .from('agency_settings')
      .select('dataforseo_monthly_budget')
      .limit(1)
      .maybeSingle()
    const setting = resolveBudgetSetting(settings as { dataforseo_monthly_budget?: unknown } | null, setErr)
    if ('hold' in setting) {
      console.error('[dfs-budget] cannot read the budget, holding spend:', setErr?.message)
      return hold(setting.hold)
    }
    if (setting.limit == null) {
      const unlimited: BudgetState = { limit: null, spent: 0, allowed: true }
      cache = { at: Date.now(), state: unlimited }
      return unlimited
    }
    const limit = setting.limit

    // One retry before holding spend: most read failures are a blip, and holding costs a whole
    // day's rank checks when the cron is the caller.
    let usage = await sumDfsSpendSince(db, firstOfMonth())
    if (usage.error) usage = await sumDfsSpendSince(db, firstOfMonth())
    if (usage.error) {
      console.error('[dfs-budget] usage unreadable, holding spend:', usage.error)
      return hold('could not read this month’s usage', limit)
    }

    const spent = usage.spent
    const state: BudgetState = spent >= limit
      ? { limit, spent, allowed: false, reason: `monthly budget reached ($${spent.toFixed(2)} of $${limit.toFixed(2)})` }
      : { limit, spent, allowed: true }
    cache = { at: Date.now(), state }
    return state
  } catch (e) {
    // A throw is as unknown as an error return, and unknown does not buy.
    console.error('[dfs-budget] check threw, holding spend:', e instanceof Error ? e.message : e)
    return hold('the budget check failed')
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
