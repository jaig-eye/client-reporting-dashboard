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
  usable.forEach((u, i) => {
    for (const kw of keywordLists[i]) {
      for (const device of u.cfg.devices) {
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
