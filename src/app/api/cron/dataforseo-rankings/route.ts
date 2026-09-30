// /api/cron/dataforseo-rankings
//
// Live rank checks for RECENT posts only. Everything older is covered by the site-wide snapshot
// that client research records for free — see lib/content/clientResearch.ts.
//
// WHY ONLY RECENT POSTS
//
// The snapshot comes from DataForSEO Labs, whose SERP database refreshes on a 30-90 day cycle for
// low-popularity queries. That is most of what a local business ranks for, so a post published
// last week can look completely dead in Labs data for a quarter. That is exactly the window where
// someone asks whether the content is working.
//
// So: recent posts get a live reading, and everything else rides the snapshot. The window is
// deliberately short, because the question "is this new post moving" stops being interesting once
// the answer settles.
//
// WHY LIVE, WHEN THE STANDARD QUEUE IS CHEAPER PER RESULT
//
// It isn't, at the depth this needs. Standard is $0.0006 per 10 results and live is $0.002, so
// Standard at depth 100 and live at depth 30 both cost $0.006. Reading 30 results answers "is it
// on page one, two or three", which is the whole question here — and live returns in the same
// request, so there is no task ledger, no collect pass, and no way to pay for a result nobody
// ever reads.
//
// The exception is a keyword's FIRST reading, which goes to depth 100 so a post that enters at 67
// is recorded as 67 rather than "not found". Every later comparison is measured against it.
//
// Auth: Authorization: Bearer CRON_SECRET. Dormant until a client has a DataForSEO connection.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronAuth } from '@/lib/auth'
import { resolveDfsCreds, resolveSeoConfig, dfsSerpRank, readResearchLocation, estimateSerpCost, type SeoDevice, type DfsCreds } from '@/lib/connectors/dataforseo'
import { canSpendOnDfs, getDfsBudget, remainingDfsBudget } from '@/lib/content/dfsBudget'
import { getTrackedKeywords, upsertRanking } from '@/lib/content/seoRankings'
import { recordDfsUsage } from '@/lib/content/dataforseoUsage'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * How long a post stays in the CLOSE-watched window — weekly mobile, monthly desktop.
 *
 * Past this a position has largely stopped moving, and the free site-wide snapshot covers it.
 */
const FRESH_WINDOW_DAYS = 60

/** How long to leave a new post alone. Below this Google is still indexing it and there is nothing to read. */
const INDEXING_DAYS = 14

/**
 * Cadence per device inside that window.
 *
 * Fortnightly, not weekly. This is an internal view of whether a post is moving, not a number
 * anybody reports on — and a position that moved between Tuesday and Tuesday is still moving a
 * fortnight later. Halving the reads in the window halves the largest line of the bill.
 */
const INTERVAL_DAYS: Record<SeoDevice, number> = { mobile: 14, desktop: 30 }

/**
 * How often a keyword is re-checked once the close window closes.
 *
 * The window used to be a cliff: at day 61 a keyword stopped being read and its row kept showing
 * the last position it had, forever, with nothing marking it stale. A number from day 59 looked
 * exactly like one from this morning. And the free snapshot does not fill the gap the way the
 * comment claimed — it only contains terms the domain ALREADY ranks for, so the posts that never
 * broke through, the ones worth knowing about, are precisely the ones it omits.
 *
 * So the cliff becomes a taper. Mobile only, because a second device buys a duplicate answer to a
 * question now being asked twice a year:
 *
 *   60d - 1yr   every 60 days   — day 120, 180, 240, 300, 360
 *   1yr +       every 182 days  — twice a year, enough to catch a drop
 *
 * At depth 30 that is $0.006 a reading: about three cents per keyword in its first year and one
 * cent a year after, against the alternative of a number nobody can trust.
 */
const TAPER_INTERVAL_DAYS = 60
const SETTLED_AFTER_DAYS  = 365
const SETTLED_INTERVAL_DAYS = 182

/**
 * When a keyword stops being bought altogether.
 *
 * Without this the bill grows every year even at a steady client count and a steady posting rate,
 * because nothing is ever retired: year six pays to check six years of archive. A hundred clients
 * at two posts a week goes $55 a month in year one to $119 by year six, and the daily volume
 * passes MAX_CHECKS_PER_RUN in year four — at which point the run truncates and the cadence
 * quietly stops being what this file says it is.
 *
 * With it, both flatten. The paid set becomes a rolling two years of posts rather than everything
 * ever written, so the same input produces the same bill forever — $82 a month, 296 checks a day,
 * whether it is year three or year thirty.
 *
 * What that costs in information is very little, because it is not the same as going blind.
 * recordOwnRankings resolves positions against every one of a client's keyword rows, so a retired
 * keyword that STILL RANKS keeps getting a free snapshot on each monthly discovery run — desktop,
 * Labs, lagging a month or two, which is plenty for a post this old. The only thing genuinely lost
 * is negative confirmation: "still not ranking", two years and eleven paid readings later.
 *
 * The keyword itself is not retired — it keeps its row, its history and its place in the Rankings
 * view. It just stops buying new live readings.
 */
const RETIRE_AFTER_DAYS = 730

/**
 * The gap between readings for this keyword on this device, or null when it is not worth reading.
 *
 * age_days === null means no post behind the keyword — a money keyword, or one added by hand. Those
 * are left alone, exactly as before: there is no publication to start a clock, and research
 * deliberately leaves them to the free snapshot rather than buying live checks for a page nobody
 * wrote. Changing that is a cost decision, not a staleness fix, so it is not made here.
 */
function checkIntervalDays(ageDays: number | null, device: SeoDevice): number | null {
  if (ageDays === null)            return null
  // Nothing to find yet. Google has not finished indexing a page this new, so a check returns
  // "not found" — and that answer costs the same as a real one.
  //
  // Worse than the money: the FIRST reading is the baseline every later comparison is measured
  // against, and it is the one that goes to depth 100. Spending triple to record "not ranking"
  // on day one, then calling everything after it movement against that, is the expensive way to
  // learn nothing. This was in the original curve and went missing when the flat window replaced
  // it.
  if (ageDays < INDEXING_DAYS)     return null
  // Old enough that the free snapshot can carry it — see RETIRE_AFTER_DAYS.
  if (ageDays >= RETIRE_AFTER_DAYS) return null
  if (ageDays < FRESH_WINDOW_DAYS) return INTERVAL_DAYS[device]
  // Past the close window one device is enough; desktop stops.
  if (device !== 'mobile')         return null
  return ageDays < SETTLED_AFTER_DAYS ? TAPER_INTERVAL_DAYS : SETTLED_INTERVAL_DAYS
}

/** Deep enough to catch a post entering the results; only ever used for a keyword's first read. */
const FIRST_READ_DEPTH = 100
/** Page one to three. Enough to answer the only question being asked here. */
const ROUTINE_DEPTH = 30

/** Bound a run. Well above the expected volume; a backstop, not a throttle. */
const MAX_CHECKS_PER_RUN = 400

/** Live checks in flight at once. */
const CHECK_CONCURRENCY = 4

/** Small stable hash, so a keyword's slot within its interval never moves between runs. */
function stableOffset(seed: string, modulo: number): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return Math.abs(h) % Math.max(1, modulo)
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const epochDay = Math.floor(Date.parse(today + 'T00:00:00Z') / 86_400_000)

  // All client↔DataForSEO connections (domain lives on external_id).
  let connections: Array<{
    client_id: string; external_id: string | null
    config?: Record<string, unknown> | null
    connector?: { type?: string; auth?: Record<string, unknown>; config?: Record<string, unknown> }
  }> = []
  try {
    // Filtered in the query, not in JS: an unfiltered select of every connection is cut at 1,000
    // rows, and DataForSEO clients past that silently dropped out. Paused connections are not billed.
    const { data, error } = await db
      .from('client_connections')
      .select('client_id, external_id, config, connector:connectors!inner(type, auth, config)')
      .eq('connector.type', 'dataforseo')
      .eq('status', 'active')
    if (error) {
      console.error('[cron/dataforseo-rankings] connections unreadable:', error.message)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    connections = (data ?? []) as typeof connections
  } catch (e) {
    console.warn('[cron/dataforseo-rankings] no connections queryable:', e)
    return NextResponse.json({ ok: true, dormant: true, checked: 0 })
  }
  if (connections.length === 0) return NextResponse.json({ ok: true, dormant: true, checked: 0 })

  const usable = connections
    .map(conn => {
      const creds  = resolveDfsCreds(conn.connector?.auth ?? {})
      const domain = (conn.external_id ?? '').trim()
      if (!creds || !domain) return null
      return { clientId: conn.client_id, creds, domain, cfg: resolveSeoConfig(conn.connector?.config, conn.config) }
    })
    .filter(Boolean) as Array<{ clientId: string; creds: DfsCreds; domain: string; cfg: ReturnType<typeof resolveSeoConfig> }>

  // Where each client's searcher is. A research location (migration 224) makes the live check
  // local: the position that matters for a county-wide business is the one its own market sees,
  // not the national one Labs reports.
  const localCode = new Map<string, { code: number; name: string }>()
  try {
    const { data: locs, error: locsErr } = await db
      .from('content_settings')
      .select('client_id, research_location')
      .in('client_id', usable.map(u => u.clientId))
    // Migration 224 has landed, so this failing means something other than the column missing —
    // and every rank check silently reverts to the national SERP.
    if (locsErr) console.warn('[cron/dataforseo-rankings] research locations unreadable, checking nationally:', locsErr.message)
    for (const r of (locs ?? []) as { client_id: string; research_location: unknown }[]) {
      const loc = readResearchLocation(r.research_location)
      if (loc) localCode.set(r.client_id, { code: loc.code, name: loc.name })
    }
  } catch { /* column absent — country-level checks, as before */ }

  // The largest paid path there is: every tracked keyword, every day it is due. If the month's
  // ceiling is reached the run stops here — the last reading stands, and the cadence resumes when
  // the month turns over. A skipped day is a gap in a history; an unbounded bill is not recoverable.
  if (!(await canSpendOnDfs('rank checks'))) {
    const state = await getDfsBudget()
    return NextResponse.json({
      ok: true, skipped: 'budget',
      reason: state.reason ?? 'monthly budget reached',
      spent: Number.isFinite(state.spent) ? Number(state.spent.toFixed(2)) : null,
      limit: state.limit,
    })
  }

  const keywordLists = await Promise.all(usable.map(u => getTrackedKeywords(u.clientId)))

  type Job = {
    clientId: string; domain: string; keywordId: string; keyword: string
    locationCode: number; languageCode: string; device: SeoDevice; depth: number
    creds: DfsCreds; lastChecked: string | null
  }
  const jobs: Job[] = []
  let skippedNotWorth = 0, skippedNotDue = 0, skippedUnpublished = 0

  usable.forEach((u, i) => {
    for (const kw of keywordLists[i]) {
      // Nothing to find yet — a keyword is claimed when its article is generated, which is often
      // weeks before that article goes out.
      if (kw.awaiting_publish) { skippedUnpublished++; continue }
      // No post behind it — a money keyword, or one added by hand. Left to the free snapshot.
      if (kw.age_days === null) { skippedNotWorth++; continue }

      for (const device of u.cfg.devices) {
        // The cadence tapers with age rather than stopping dead at the window's edge, so a post
        // keeps getting read — less often — instead of freezing on its day-59 position.
        const interval = checkIntervalDays(kw.age_days, device)
        if (interval === null) { skippedNotWorth++; continue }
        // A keyword never read before is read now: that first reading is the baseline every later
        // comparison is measured against, and waiting for its slot would lose the entry position.
        const firstRead = !kw.last_checked_at
        // Read today already: a second run the same day (a retry, a manual trigger) would buy the
        // same answer again.
        if (kw.last_checked_at && kw.last_checked_at.slice(0, 10) === today) { skippedNotDue++; continue }
        // The hashed slot spreads keywords across the interval. It is not the only way in: a check
        // missed on its slot (time budget, no answer, budget hold) used to wait a whole interval —
        // up to half a year — because due-ness never looked at when the keyword was last read.
        const overdue = !!kw.last_checked_at && (Date.parse(today) - Date.parse(kw.last_checked_at.slice(0, 10))) / 86_400_000 > interval
        if (!firstRead && !overdue && (epochDay + stableOffset(kw.id + device, interval)) % interval !== 0) {
          skippedNotDue++
          continue
        }
        jobs.push({
          clientId: u.clientId, domain: u.domain, keywordId: kw.id, keyword: kw.keyword,
          // The connection's tracking config is the client's authoritative market; the keyword's
          // stored location is only a registration default.
          locationCode: localCode.get(u.clientId)?.code ?? u.cfg.location_code,
          languageCode: u.cfg.language_code,
          device,
          depth: firstRead ? FIRST_READ_DEPTH : Math.min(ROUTINE_DEPTH, u.cfg.rank_depth),
          creds: u.creds,
          lastChecked: kw.last_checked_at,
        })
      }
    }
  })

  // Oldest first, so a cap that binds rotates through the universe instead of starving the tail —
  // and, with the overdue rule above, what a cap leaves behind is first in line tomorrow.
  jobs.sort((a, b) => (a.lastChecked ?? '').localeCompare(b.lastChecked ?? ''))

  // Sized to the money left. One "allowed" at the start used to buy the whole run, so the ceiling
  // could be overshot by up to 400 checks' worth; now the run stops where the budget does.
  const remaining = await remainingDfsBudget()
  let affordable = 0, planned = 0
  for (const j of jobs) {
    const next = planned + estimateSerpCost(j.depth)
    if (next > remaining) break
    planned = next
    affordable++
  }
  const limit   = Math.min(MAX_CHECKS_PER_RUN, affordable)
  const capped  = jobs.length > limit
  const runJobs = jobs.slice(0, limit)
  if (affordable < Math.min(jobs.length, MAX_CHECKS_PER_RUN)) {
    console.warn(`[cron/dataforseo-rankings] budget covers ${affordable} of ${jobs.length} due check(s) this run`)
  }

  console.log(
    `[cron/dataforseo-rankings] ${runJobs.length} live check(s); ` +
    `skipped ${skippedNotWorth} not worth reading (no post, still indexing, or desktop past ${FRESH_WINDOW_DAYS}d), ` +
    `${skippedNotDue} not due, ${skippedUnpublished} awaiting publication`,
  )

  let checked = 0, written = 0, unanswered = 0, refused = 0
  const usage = new Map<string, { cost: number; units: number }>()
  const checkedKeywordIds = new Set<string>()

  /**
   * Stop before the platform does.
   *
   * The checks run one at a time against a live SERP endpoint, so 400 of them cannot finish
   * inside maxDuration — and everything after the loop (the last_checked_at stamp, the usage
   * ledger) was lost when the function was killed. The spend still happened: DataForSEO had
   * been paid for every check made. Worse, an unstamped keyword still reads as never-checked,
   * so the next run re-bought the same depth-100 first reads, every day, forever.
   *
   * Leaving headroom for the bookkeeping below is what makes a partial run progress rather
   * than repeat.
   */
  const startedAt = Date.now()
  const TIME_BUDGET_MS = 240_000
  let stoppedEarly = false

  // A few at a time. One after another, a slow live SERP each, the time budget bound long before
  // the cap did; four in flight is well inside DataForSEO's rate limits.
  let next = 0
  const worker = async () => {
    while (next < runJobs.length) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { stoppedEarly = true; return }
      await runOne(runJobs[next++])
    }
  }
  const runOne = async (job: Job) => {
    try {
      const rank = await dfsSerpRank(job.domain, job.keyword, job.creds, {
        locationCode: job.locationCode,
        languageCode: job.languageCode,
        device:       job.device,
        depth:        job.depth,
        onCost: c => {
          const u = usage.get(job.clientId) ?? { cost: 0, units: 0 }
          u.cost += c; u.units += 1
          usage.set(job.clientId, u)
        },
      })
      // null means DataForSEO did not answer. That is not a reading: recording it would write a
      // false "dropped out" into the history, and stamping the keyword would spend its one
      // depth-100 baseline read on nothing. Leave both untouched so the next run asks again.
      if (!rank) { unanswered++; return }
      // Refused (bad location code, invalid keyword): no reading to record, but stamped as checked,
      // so it waits its interval instead of heading the queue — and being re-bought — every day.
      if (rank.refused) { refused++; checkedKeywordIds.add(job.keywordId); return }
      checked++
      checkedKeywordIds.add(job.keywordId)

      // A keyword that is genuinely not in the top N is recorded as null, not skipped: "not
      // ranking" is a reading, and a gap in the history would read as "we stopped looking".
      // Where the reading was taken. A series that switches from national to local when a
      // research location is set is two series; the row says which.
      const at = localCode.get(job.clientId)
      const ok = await upsertRanking({
        keywordId: job.keywordId, clientId: job.clientId, date: today, device: job.device,
        position: rank.position, rankAbsolute: rank.rank_absolute, url: rank.url,
        serpFeatures: rank.serp_features,
        metadata: at ? { location_code: at.code, location_name: at.name } : {},
      })
      if (ok) written++
    } catch (e) {
      console.warn(`[cron/dataforseo-rankings] check failed for "${job.keyword}" (${job.device}):`, e)
    }
  }
  await Promise.all(Array.from({ length: CHECK_CONCURRENCY }, worker))

  // The checkpoint. A silent failure here is the expensive one: every keyword still reads as
  // never-checked, so tomorrow's run re-buys the same depth-100 first reads — and a throw would
  // skip the usage ledger below, hiding the spend that already happened.
  if (checkedKeywordIds.size > 0) {
    try {
      const { error: stampErr } = await db.from('seo_keywords')
        .update({ last_checked_at: new Date().toISOString() })
        .in('id', Array.from(checkedKeywordIds))
      if (stampErr) {
        console.error(`[cron/dataforseo-rankings] could not stamp ${checkedKeywordIds.size} keyword(s) — they will be re-checked and re-billed:`, stampErr.message)
      }
    } catch (e) {
      console.error('[cron/dataforseo-rankings] stamp threw — keywords will be re-checked and re-billed:', e)
    }
  }

  let totalCost = 0
  for (const [clientId, u] of Array.from(usage.entries())) {
    totalCost += u.cost
    await recordDfsUsage({ operation: 'rank_check', clientId, cost: u.cost, units: u.units, date: today })
  }

  if (stoppedEarly) {
    console.warn(`[cron/dataforseo-rankings] stopped at the time budget after ${checked} check(s); the rest roll to the next run`)
  }

  if (unanswered > 0) {
    console.warn(`[cron/dataforseo-rankings] ${unanswered} check(s) got no answer from DataForSEO and were left for the next run`)
  }

  return NextResponse.json({
    ok: true, checked, written, unanswered, refused, capped, stoppedEarly,
    skipped: { notWorthReading: skippedNotWorth, notDue: skippedNotDue, awaitingPublish: skippedUnpublished },
    cost: Number(totalCost.toFixed(4)),
  })
}
