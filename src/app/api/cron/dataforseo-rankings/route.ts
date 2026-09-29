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
import { resolveDfsCreds, resolveSeoConfig, dfsSerpRank, readResearchLocation, type SeoDevice, type DfsCreds } from '@/lib/connectors/dataforseo'
import { canSpendOnDfs, getDfsBudget } from '@/lib/content/dfsBudget'
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

/** Cadence per device inside that window. Mobile carries most traffic, so it is watched closer. */
const INTERVAL_DAYS: Record<SeoDevice, number> = { mobile: 7, desktop: 30 }

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
    const { data } = await db
      .from('client_connections')
      .select('client_id, external_id, config, connector:connectors(type, auth, config)')
    connections = ((data ?? []) as typeof connections).filter(c => c.connector?.type === 'dataforseo')
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
        if (!firstRead && (epochDay + stableOffset(kw.id + device, interval)) % interval !== 0) {
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

  // Oldest first, so a cap that binds rotates through the universe instead of starving the tail.
  jobs.sort((a, b) => (a.lastChecked ?? '').localeCompare(b.lastChecked ?? ''))
  const capped  = jobs.length > MAX_CHECKS_PER_RUN
  const runJobs = jobs.slice(0, MAX_CHECKS_PER_RUN)

  console.log(
    `[cron/dataforseo-rankings] ${runJobs.length} live check(s); ` +
    `skipped ${skippedNotWorth} not worth reading (no post, still indexing, or desktop past ${FRESH_WINDOW_DAYS}d), ` +
    `${skippedNotDue} not due, ${skippedUnpublished} awaiting publication`,
  )

  let checked = 0, written = 0, unanswered = 0
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

  for (const job of runJobs) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) { stoppedEarly = true; break }
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
      if (!rank) { unanswered++; continue }
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
    ok: true, checked, written, unanswered, capped, stoppedEarly,
    skipped: { notWorthReading: skippedNotWorth, notDue: skippedNotDue, awaitingPublish: skippedUnpublished },
    cost: Number(totalCost.toFixed(4)),
  })
}
