// /api/cron/dataforseo-rankings
// Daily rank sync: for every client with a DataForSEO connection, rank-check each of
// its tracked keywords (per configured device + depth) and store a snapshot in
// seo_rankings. Completely dormant (no-op) until a DataForSEO connector + domain and
// tracked keywords exist. Auth: Authorization: Bearer CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveDfsCreds, resolveSeoConfig, dfsSerpRank, type SeoDevice } from '@/lib/connectors/dataforseo'
import { getTrackedKeywords, upsertRanking } from '@/lib/content/seoRankings'

export const maxDuration = 300

// Cap a single run so a large keyword universe can't overrun the function timeout;
// remaining keywords are picked up on the next run. Logged, never silent.
const MAX_CHECKS_PER_RUN = 600
const CONCURRENCY = 6

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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

  // Build the flat work list (keyword × device) across all clients.
  type Job = {
    clientId: string; domain: string; keywordId: string; keyword: string
    locationCode: number; languageCode: string; device: SeoDevice
    creds: ReturnType<typeof resolveDfsCreds>
  }
  const jobs: Job[] = []
  for (const conn of connections) {
    const creds = resolveDfsCreds(conn.connector?.auth ?? {})
    const domain = (conn.external_id ?? '').trim()
    if (!creds || !domain) continue
    const cfg = resolveSeoConfig(conn.connector?.config, conn.config)
    const keywords = await getTrackedKeywords(conn.client_id)
    for (const kw of keywords) {
      for (const device of cfg.devices) {
        jobs.push({
          clientId: conn.client_id, domain, keywordId: kw.id, keyword: kw.keyword,
          locationCode: kw.location_code || cfg.location_code,
          languageCode: kw.language_code || cfg.language_code,
          device, creds,
        })
      }
    }
  }

  const capped = jobs.length > MAX_CHECKS_PER_RUN
  const runJobs = jobs.slice(0, MAX_CHECKS_PER_RUN)
  let checked = 0, written = 0

  // Bounded-concurrency pool.
  async function worker(slice: Job[]) {
    for (const job of slice) {
      if (!job.creds) continue
      checked++
      const rank = await dfsSerpRank(job.domain, job.keyword, job.creds, {
        locationCode: job.locationCode, languageCode: job.languageCode,
        device: job.device, depth: resolveDepthForClient(connections, job.clientId),
      })
      const ok = await upsertRanking({
        keywordId: job.keywordId, clientId: job.clientId, date: today, device: job.device,
        position: rank.position, rankAbsolute: rank.rank_absolute, url: rank.url,
        serpFeatures: rank.serp_features,
      })
      if (ok) written++
    }
  }
  const chunks: Job[][] = Array.from({ length: CONCURRENCY }, () => [])
  runJobs.forEach((j, i) => chunks[i % CONCURRENCY].push(j))
  await Promise.all(chunks.map(worker))

  if (capped) {
    console.warn(`[cron/dataforseo-rankings] capped at ${MAX_CHECKS_PER_RUN}/${jobs.length} checks this run`)
  }
  return NextResponse.json({ ok: true, clients: connections.length, checked, written, total: jobs.length, capped })
}

// Depth is per-client-configurable; resolve it from the client's connection config.
function resolveDepthForClient(
  connections: Array<{ client_id: string; config?: Record<string, unknown> | null; connector?: { config?: Record<string, unknown> } }>,
  clientId: string,
): number {
  const conn = connections.find(c => c.client_id === clientId)
  return resolveSeoConfig(conn?.connector?.config, conn?.config).rank_depth
}
