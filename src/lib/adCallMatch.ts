// ─────────────────────────────────────────────────────────────────────────────
// Matching Google Ads calls to CRM contacts by when they happened
//
// A call placed from a Google ad routes through Google's forwarding number, so the number the
// business sees says nothing about the ad. But both sides record the same event: Google logs the
// call's start and duration, and the CRM logs an inbound call on a contact. A call starting at
// 14:32:07 and running 143 seconds is the same call in both systems.
//
// This is a probabilistic join and is treated as one. A pair is only accepted when it is the best
// fit for both sides and both are otherwise unclaimed; anything ambiguous is counted and dropped
// rather than guessed at. Callers are never involved — only times and durations.
//
// Pure: no I/O, no dates beyond arithmetic, so it can be tested without either API.
// ─────────────────────────────────────────────────────────────────────────────

/** A call as Google Ads reports it. `startedAt` is epoch milliseconds in some unknown timezone. */
export interface AdCall {
  startedAt:   number
  durationSec: number
}

/** A call as the CRM reports it, in UTC. */
export interface CrmCall {
  contactId:   string
  startedAt:   number
  durationSec: number
}

export interface MatchOptions {
  /** How far apart two records of the same call may be. Clock skew, not timezone. */
  startToleranceMs?:     number
  /** Google may or may not count ringing time, so durations rarely agree to the second. */
  durationToleranceSec?: number
  /**
   * How many calls an offset must explain before it is believed.
   *
   * The offset is worked out from the data, and with only a call or two almost any gap under
   * fourteen hours is some candidate offset — so a single pair will always "match" at whatever
   * offset happens to line it up. Several calls agreeing on one offset is a timezone; one call is
   * a coincidence. Tests of the mechanics can lower this; real syncs should not.
   */
  minMatches?:           number
  /**
   * How much better the winning offset must be than the next. A second offset explaining nearly
   * as many calls means the timing is too loose to tell them apart, and nothing is credited.
   */
  maxRunnerUpShare?:     number
}

export interface MatchResult {
  /** Contact id → how many ad calls matched it. A person who rang twice counts twice. */
  byContact: Map<string, number>
  matched:   number
  /** Pairs inside tolerance that lost to a better fit for the same call. */
  ambiguous: number
  /** The timezone offset, in minutes, that explained the most calls. */
  offsetMinutes: number
  /** Matches the runner-up offset would have produced. Close to `matched` means low confidence. */
  runnerUpMatched: number
}

const DEFAULTS = {
  startToleranceMs: 120_000,
  durationToleranceSec: 10,
  minMatches: 3,
  maxRunnerUpShare: 0.5,
}

/**
 * Offsets to try, in minutes. Google Ads reports in the ad account's timezone and the CRM in UTC;
 * rather than trust a configured timezone that may be wrong, the offset that explains the most
 * calls is the one used. Covers every whole and half hour in use, plus the three-quarter ones.
 */
function candidateOffsets(): number[] {
  const offsets: number[] = []
  for (let m = -12 * 60; m <= 14 * 60; m += 15) offsets.push(m)
  return offsets
}

/** Matches at one fixed offset. Greedy on closeness, one call to one contact. */
function matchAtOffset(
  crmCalls: CrmCall[],
  adCalls: AdCall[],
  offsetMinutes: number,
  opts: Required<MatchOptions>,
): { byContact: Map<string, number>; matched: number; ambiguous: number } {
  const shift = offsetMinutes * 60_000

  // Every pair that could be the same call, best fit first. A second off is worth more than a
  // second of duration difference, because clocks agree more closely than duration definitions do.
  const pairs: { ai: number; ci: number; score: number }[] = []
  for (let ai = 0; ai < adCalls.length; ai++) {
    const ad = adCalls[ai]
    for (let ci = 0; ci < crmCalls.length; ci++) {
      const crm = crmCalls[ci]
      const dStart = Math.abs((ad.startedAt - shift) - crm.startedAt)
      if (dStart > opts.startToleranceMs) continue
      const dDur = Math.abs(ad.durationSec - crm.durationSec)
      if (dDur > opts.durationToleranceSec) continue
      pairs.push({ ai, ci, score: dStart + dDur * 1_000 })
    }
  }
  pairs.sort((a, b) => a.score - b.score)

  const usedAd  = new Set<number>()
  const usedCrm = new Set<number>()
  const byContact = new Map<string, number>()
  let matched = 0, ambiguous = 0

  for (const p of pairs) {
    if (usedAd.has(p.ai) || usedCrm.has(p.ci)) { ambiguous++; continue }
    usedAd.add(p.ai)
    usedCrm.add(p.ci)
    const id = crmCalls[p.ci].contactId
    byContact.set(id, (byContact.get(id) ?? 0) + 1)
    matched++
  }
  return { byContact, matched, ambiguous }
}

/**
 * Matches Google's calls to the CRM's, working out the timezone offset from the data rather than
 * being told it. Returns nothing when neither side has calls, or when no offset explains any.
 */
export function matchAdCalls(
  crmCalls: CrmCall[],
  adCalls: AdCall[],
  options: MatchOptions = {},
): MatchResult {
  const opts = { ...DEFAULTS, ...options }
  const empty: MatchResult = {
    byContact: new Map(), matched: 0, ambiguous: 0, offsetMinutes: 0, runnerUpMatched: 0,
  }
  if (crmCalls.length === 0 || adCalls.length === 0) return empty

  let best = empty
  let runnerUp = 0
  for (const offset of candidateOffsets()) {
    const r = matchAtOffset(crmCalls, adCalls, offset, opts)
    if (r.matched > best.matched) {
      runnerUp = best.matched
      best = { ...r, offsetMinutes: offset, runnerUpMatched: 0 }
    } else if (r.matched > runnerUp) {
      runnerUp = r.matched
    }
  }
  // Too few calls, or a rival offset explaining nearly as many, means the offset was found by
  // chance rather than read off the data. Credit nothing rather than credit the wrong contact.
  if (best.matched < opts.minMatches) return empty
  if (runnerUp > best.matched * opts.maxRunnerUpShare) return empty
  return { ...best, runnerUpMatched: runnerUp }
}
