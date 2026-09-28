// What Google shows for a keyword, captured when the operator picks it.
//
// WHY HERE
//
// SERP snapshots arrived from two places: the seed services, captured while research ran, and a
// post's target keyword, captured while the post was written. So a keyword picked in the Keywords
// tab showed nothing under "What Google shows" until an article already existed for it — which is
// backwards. The moment the talking points are worth reading is while deciding whether to commit a
// post to the keyword, not after the post is written.
//
// WHAT IT COSTS
//
// One SERP call per keyword, once. A keyword that already carries a snapshot is skipped, so this
// is charged per keyword for the life of that keyword rather than per pick, per re-pick or per
// research run. The spend is recorded in the usage ledger under its own operation so it can be
// told apart from discovery.
//
// WHAT IT NEVER DOES
//
// It never fails a selection. Choosing keywords is a database write that must succeed whether or
// not DataForSEO is connected, reachable, or in credit — so every path here returns a count and
// swallows its own errors. With no credentials it does nothing at all, which is exactly the
// behaviour before it existed.

import type { createAdminClient } from '@/lib/supabase/server'
import {
  resolveDfsCreds, resolveSeoConfig, dfsSerpIntel, readResearchLocation,
  type ResearchLocation, type DfsCreds, type SeoTrackingConfig,
} from '@/lib/connectors/dataforseo'
import { deriveResearchLocation } from '@/lib/content/deriveLocation'
import { toSerpInsight, readSerpInsight, saveSerpInsightById } from '@/lib/content/serpInsights'
import { recordDfsUsage } from '@/lib/content/dataforseoUsage'

type Db = ReturnType<typeof createAdminClient>

/**
 * How many keywords one selection will buy snapshots for.
 *
 * A bound, not a target. Picking is cheap to do and easy to do in bulk — the bulk endpoint accepts
 * 500 — and an unbounded loop here would turn one click into an unbounded bill. Anything past the
 * cap keeps the behaviour it had before: it gets its snapshot when a post is written for it.
 */
const MAX_PER_SELECTION = 30

/** Calls in flight. Enough to keep 30 within a few seconds, low enough not to trip rate limits. */
const CONCURRENCY = 5

export interface SnapshotResult {
  /** Snapshots captured and stored. */
  captured: number
  /** Chosen keywords that already had one, so nothing was spent on them. */
  skipped:  number
  /** Dollars spent, as DataForSEO reported it. */
  cost:     number
  /** Why nothing happened, when nothing happened. Not an error — the selection still succeeded. */
  reason?:  string
}

/**
 * Capture what Google shows for keywords that were just chosen and have no snapshot yet.
 *
 * `normalized` is the same normalised form the selection update matched on.
 */
export async function snapshotChosenKeywords(
  db: Db,
  clientId: string,
  normalized: string[],
): Promise<SnapshotResult> {
  const none: SnapshotResult = { captured: 0, skipped: 0, cost: 0 }
  if (!clientId || normalized.length === 0) return none

  try {
    // The client's DataForSEO connection, read the same way research reads it.
    let creds: DfsCreds | null = null
    let cfg: SeoTrackingConfig = resolveSeoConfig(null, null)
    const { data: conns, error: connErr } = await db
      .from('client_connections')
      .select('config, connector:connectors(type, auth, config)')
      .eq('client_id', clientId)
    if (connErr) {
      console.warn('[snapshot] cannot read connections:', connErr.message)
      return { ...none, reason: 'could not read the connection' }
    }
    type Row = {
      config: Record<string, unknown> | null
      connector: { type?: string; auth?: Record<string, unknown>; config?: Record<string, unknown> }
               | { type?: string; auth?: Record<string, unknown>; config?: Record<string, unknown> }[]
               | null
    }
    for (const row of (conns ?? []) as Row[]) {
      const conn = Array.isArray(row.connector) ? row.connector[0] : row.connector
      if (conn?.type !== 'dataforseo') continue
      creds = resolveDfsCreds(conn.auth ?? {})
      cfg   = resolveSeoConfig(conn.config, row.config)
      break
    }
    // Not connected is not a failure. Everything else on this page works without it.
    if (!creds) return { ...none, reason: 'keyword research not connected' }

    // Only the rows that were actually chosen, and only the ones with nothing stored. The read
    // carries metadata so "already has one" is decided here rather than by a second query.
    const { data, error } = await db
      .from('seo_keywords')
      .select('id, keyword, metadata')
      .eq('client_id', clientId)
      .in('normalized_keyword', normalized)
    if (error) {
      // PostgREST reports failure in the payload rather than by throwing, so an unchecked read
      // here would look like "no keywords needed a snapshot" and quietly do nothing forever.
      console.warn('[snapshot] cannot read chosen keywords:', error.message)
      return { ...none, reason: 'could not read the chosen keywords' }
    }

    const rows = ((data ?? []) as Array<{ id: string; keyword: string; metadata: unknown }>)
      .filter(r => r.id && String(r.keyword ?? '').trim())
    const needed = rows.filter(r => readSerpInsight(r.metadata) == null)
    const skipped = rows.length - needed.length
    if (needed.length === 0) return { ...none, skipped }

    const targets = needed.slice(0, MAX_PER_SELECTION)

    // Where to measure. A picked research location wins; failing that it is read out of the
    // service areas, exactly as research does — so a snapshot taken here and one taken by
    // research describe the same market rather than two different ones.
    let location: ResearchLocation | null = null
    const { data: cs } = await db
      .from('content_settings')
      .select('research_location, geographic_focus')
      .eq('client_id', clientId)
      .maybeSingle()
    const settings = cs as Record<string, unknown> | null
    location = readResearchLocation(settings?.research_location)
    if (!location) {
      const derived = await deriveResearchLocation(String(settings?.geographic_focus ?? ''), creds)
      location = derived?.location ?? null
    }
    const locationCode = location?.code ?? cfg.location_code
    const locationName = location?.name ?? null

    let cost = 0
    let captured = 0
    const onCost = (c: number) => { cost += c }

    // A small worker pool rather than Promise.all over everything: thirty simultaneous live SERP
    // requests is how a provider starts refusing them.
    let next = 0
    const worker = async () => {
      for (;;) {
        const i = next++
        if (i >= targets.length) return
        const row = targets[i]
        try {
          const snap = await dfsSerpIntel(row.keyword, creds, {
            locationCode, languageCode: cfg.language_code, limit: 10, aiOverview: true, onCost,
          })
          // `answered: false` means the call returned nothing usable — a refused task bills
          // nothing and there is no snapshot worth storing.
          if (!snap.answered) continue
          const insight = toSerpInsight(snap, { query: row.keyword, locationCode, location: locationName })
          if (await saveSerpInsightById(db, row.id, insight)) captured++
        } catch (e) {
          // One keyword failing must not take the rest of the batch with it.
          console.warn(`[snapshot] "${row.keyword}" failed:`, e instanceof Error ? e.message : e)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))

    if (cost > 0) {
      await recordDfsUsage({
        operation: 'serp_snapshot_on_select',
        clientId,
        cost,
        units: captured,
        date: new Date().toISOString().slice(0, 10),
      })
    }
    console.log(`[snapshot] client ${clientId}: captured ${captured}, skipped ${skipped}, cost $${cost.toFixed(4)}`)
    return { captured, skipped, cost: Number(cost.toFixed(4)) }
  } catch (e) {
    console.warn('[snapshot] failed:', e instanceof Error ? e.message : e)
    return { ...none, reason: 'could not capture what Google shows' }
  }
}
