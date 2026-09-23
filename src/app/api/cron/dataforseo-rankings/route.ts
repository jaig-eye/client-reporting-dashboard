// /api/cron/dataforseo-rankings
// Daily rank sync: for every client with a DataForSEO connection, rank-check each of
// its tracked keywords (per configured device + depth) and store a snapshot in
// seo_rankings. Completely dormant (no-op) until a DataForSEO connector + domain and
// tracked keywords exist. Auth: Authorization: Bearer CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyCronAuth } from '@/lib/auth'
import { resolveDfsCreds, resolveSeoConfig, dfsSerpRank, type SeoDevice, type DfsCreds } from '@/lib/connectors/dataforseo'
import { getTrackedKeywords, upsertRanking } from '@/lib/content/seoRankings'
import { recordDfsUsage } from '@/lib/content/dataforseoUsage'

export const maxDuration = 300

// Cap a single run so a large keyword universe can't overrun the function timeout. Jobs are
// sorted GLOBALLY by last_checked_at (oldest / never-checked first) BEFORE the cap, so each run
// rotates through the whole cross-client universe instead of starving later clients (per-client
// ordering alone let one big client monopolize the cap). Logged, never silent.
const MAX_CHECKS_PER_RUN = 600
const CONCURRENCY = 6

/**
 * How often a keyword is worth re-checking on a device, by the age of the post it belongs to.
 *
 * A post ranks on a curve: nothing while it indexes, months of real movement, then years of
 * near-stillness. A flat daily sweep pays the same for the period that tells you everything and
 * the period that tells you nothing, and the bill grows forever because the universe only ever
 * gets bigger.
 *
 * Returns null when the keyword should not be checked at all on that device.
 *
 * age_days === null means there is no post behind the keyword — a money keyword or one added by
 * hand. Those never mature, so they stay at the top of the ladder permanently.
 */
function checkIntervalDays(ageDays: number | null, device: SeoDevice): number | null {
  if (ageDays === null)  return device === 'mobile' ? 7  : 30   // money keywords: always the climb rate
  if (ageDays < 14)      return null                            // not indexed yet; checking buys noise
  if (ageDays < 183)     return device === 'mobile' ? 7  : 30   // 2wk–6mo — where the movement is
  if (ageDays < 365)     return device === 'mobile' ? 14 : 91   // 6–12mo — settling
  if (ageDays < 1095)    return device === 'mobile' ? 91 : 182  // 1–3yr — watching for a drop
  return device === 'mobile' ? 365 : null                       // 3yr+ — a yearly heartbeat
}

/** Small stable hash, so a keyword's slot in its interval never moves between runs. */
function stableOffset(seed: string, modulo: number): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return Math.abs(h) % Math.max(1, modulo)
}

/**
 * Whether this keyword/device is due today.
 *
 * Derived rather than stored: seo_keywords carries one last_checked_at for the whole keyword, not
 * one per device, so a stored "last desktop check" does not exist. Each keyword/device instead
 * gets a fixed offset within its interval, which spreads the universe evenly across the window
 * instead of bunching every keyword onto the same day — the reason the 600-per-run cap used to
 * bind at all.
 */
function isDue(keywordId: string, device: SeoDevice, ageDays: number | null, lastChecked: string | null, epochDay: number): boolean {
  const interval = checkIntervalDays(ageDays, device)
  if (interval === null) return false
  // Never checked, and old enough to have a position worth recording: take the baseline now
  // rather than waiting for its slot. This is the "entered at 34" reading every later
  // comparison is measured against.
  if (!lastChecked && (ageDays === null || ageDays >= 14)) return true
  return (epochDay + stableOffset(keywordId + device, interval)) % interval === 0
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

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
    // Table/relationship missing (migrations not applied) → dormant no-op.
    console.warn('[cron/dataforseo-rankings] no connections queryable:', e)
    return NextResponse.json({ ok: true, dormant: true, checked: 0 })
  }

  if (connections.length === 0) {
    return NextResponse.json({ ok: true, dormant: true, checked: 0 })
  }

  // Resolve per-connection creds/domain/config once; drop unusable connections.
  const usable = connections
    .map(conn => {
      const creds  = resolveDfsCreds(conn.connector?.auth ?? {})
      const domain = (conn.external_id ?? '').trim()
      if (!creds || !domain) return null
      return { clientId: conn.client_id, creds, domain, cfg: resolveSeoConfig(conn.connector?.config, conn.config) }
    })
    .filter(Boolean) as Array<{ clientId: string; creds: DfsCreds; domain: string; cfg: ReturnType<typeof resolveSeoConfig> }>

  // Fetch every client's tracked keywords concurrently (one round-trip each, in parallel).
  const keywordLists = await Promise.all(usable.map(u => getTrackedKeywords(u.clientId)))

  type Job = {
    clientId: string; domain: string; keywordId: string; keyword: string
    locationCode: number; languageCode: string; device: SeoDevice; depth: number; creds: DfsCreds
    lastChecked: string | null
  }
  const jobs: Job[] = []
  const epochDay = Math.floor(Date.parse(today + 'T00:00:00Z') / 86_400_000)
  let skippedNotDue = 0
  usable.forEach((u, i) => {
    for (const kw of keywordLists[i]) {
      for (const device of u.cfg.devices) {
        if (!isDue(kw.id, device, kw.age_days, kw.last_checked_at, epochDay)) { skippedNotDue++; continue }
        jobs.push({
          clientId: u.clientId, domain: u.domain, keywordId: kw.id, keyword: kw.keyword,
          // The connection's tracking config is the client's authoritative market. (The keyword's
          // stored location_code is only a registration default — always US, so the old
          // `kw.location_code || cfg` fallback never reached cfg and non-US clients were checked
          // against the US SERP.)
          locationCode: u.cfg.location_code,
          languageCode: u.cfg.language_code,
          device, depth: u.cfg.rank_depth, creds: u.creds,
          lastChecked: kw.last_checked_at,
        })
      }
    }
  })

  // Global rotation across ALL clients before the cap. Empty string sorts before any ISO
  // timestamp, so never-checked keywords go first, then the least-recently-checked.
  jobs.sort((a, b) => (a.lastChecked ?? '').localeCompare(b.lastChecked ?? ''))

  console.log(`[cron/dataforseo-rankings] ${jobs.length} check(s) due today, ${skippedNotDue} not due`)

  const capped = jobs.length > MAX_CHECKS_PER_RUN
  const runJobs = jobs.slice(0, MAX_CHECKS_PER_RUN)
  let checked = 0, written = 0
  const usage = new Map<string, { cost: number; units: number }>()   // real per-request cost per client
  const checkedKeywordIds = new Set<string>()                        // for a single batched last_checked_at write

  // Bounded-concurrency pool.
  async function worker(slice: Job[]) {
    for (const job of slice) {
      checked++
      const rank = await dfsSerpRank(job.domain, job.keyword, job.creds, {
        locationCode: job.locationCode, languageCode: job.languageCode, device: job.device, depth: job.depth,
        onCost: c => {
          const u = usage.get(job.clientId) ?? { cost: 0, units: 0 }
          u.cost += c; u.units += 1; usage.set(job.clientId, u)
        },
      })
      const ok = await upsertRanking({
        keywordId: job.keywordId, clientId: job.clientId, date: today, device: job.device,
        position: rank.position, rankAbsolute: rank.rank_absolute, url: rank.url,
        serpFeatures: rank.serp_features,
      })
      if (ok) { written++; checkedKeywordIds.add(job.keywordId) }
    }
  }
  const chunks: Job[][] = Array.from({ length: CONCURRENCY }, () => [])
  runJobs.forEach((j, i) => chunks[i % CONCURRENCY].push(j))
  await Promise.all(chunks.map(worker))

  // One batched last_checked_at write for every keyword actually checked (drives rotation).
  if (checkedKeywordIds.size) {
    try {
      await db.from('seo_keywords').update({ last_checked_at: new Date().toISOString() }).in('id', Array.from(checkedKeywordIds))
    } catch (e) { console.warn('[cron/dataforseo-rankings] last_checked_at batch failed:', e) }
  }

  // Record aggregated spend (one row per client per run).
  let cost = 0
  for (const [clientId, u] of Array.from(usage.entries())) {
    cost += u.cost
    await recordDfsUsage({ operation: 'rank_check', clientId, cost: u.cost, units: u.units, date: today })
  }

  if (capped) {
    console.warn(`[cron/dataforseo-rankings] capped at ${MAX_CHECKS_PER_RUN}/${jobs.length} checks this run (rotates by last_checked_at)`)
  }
  return NextResponse.json({ ok: true, clients: usable.length, checked, written, cost: Number(cost.toFixed(4)), total: jobs.length, capped })
}
