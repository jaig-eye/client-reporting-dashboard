// ─────────────────────────────────────────────────────────────────────────────
// SEO keyword & rank datastream helpers (DataForSEO-backed)
//
// Read/write layer over seo_keywords / seo_rankings (migrations 189 + 190) and the
// seo_keyword_current view. Provider-agnostic: keywords can be registered from content
// topics or GSC today; once DataForSEO is connected the rank cron fills seo_rankings
// and these reads light up the Analytics tab, pipeline cards, and the post editor.
//
// Every function SOFT-FAILS (returns null / [] / {}) if the tables don't exist yet
// (migrations not applied) or on any query error, so content generation never breaks.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from '@/lib/supabase/server'
import { countryToLocationCode } from '@/lib/connectors/dataforseo'
import type { SeoDevice } from '@/lib/connectors/dataforseo'

export type KeywordMovement = 'up' | 'down' | 'entered' | 'dropped' | 'flat' | 'none'

export interface KeywordRank {
  keyword_id:            string
  keyword:               string
  current_position:      number | null
  previous_position:     number | null
  position_delta:        number | null   // +ve = improved (moved toward #1)
  current_rank_absolute: number | null
  current_url:           string | null
  current_device:        string | null
  movement:              KeywordMovement
  search_volume:         number | null
  keyword_difficulty:    number | null
  intent:                string | null
  content_post_id:       string | null
}

type KeywordSource = 'manual' | 'gsc' | 'topic' | 'dataforseo' | 'ahrefs'

function normalize(kw: string): string {
  return kw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Idempotently register a tracked keyword for a client. Returns the keyword_id, or
 * null on failure.
 *
 * Correctness notes (from code review):
 *  - content_post_id is only filled when currently empty, so two posts targeting the
 *    same keyword don't steal the rank link from each other.
 *  - source (provenance) and enrichment (volume/difficulty) are written on INSERT only
 *    and never overwritten on a later re-registration.
 */
export async function registerKeyword(params: {
  clientId:       string
  keyword:        string
  country?:       string
  locationCode?:  number
  languageCode?:  string
  source?:        KeywordSource
  contentPostId?: string | null
  connectionId?:  string | null
  intent?:        string | null
}): Promise<string | null> {
  const keyword = params.keyword?.trim()
  if (!params.clientId || !keyword) return null
  const normalized     = normalize(keyword)
  const location_code  = params.locationCode ?? countryToLocationCode(params.country)
  const language_code  = params.languageCode ?? 'en'
  try {
    const db = createAdminClient()
    const { data: existing } = await db
      .from('seo_keywords')
      .select('id, content_post_id')
      .eq('client_id', params.clientId)
      .eq('normalized_keyword', normalized)
      .eq('location_code', location_code)
      .eq('language_code', language_code)
      .maybeSingle()

    const row = existing as { id?: string; content_post_id?: string | null } | null
    if (row?.id) {
      // Fill the post link only if empty — never overwrite an earlier post's claim.
      if (params.contentPostId && !row.content_post_id) {
        await db.from('seo_keywords')
          .update({ content_post_id: params.contentPostId, updated_at: new Date().toISOString() })
          .eq('id', row.id)
      }
      return row.id
    }

    const insertPayload: Record<string, unknown> = {
      client_id:          params.clientId,
      keyword,
      normalized_keyword: normalized,
      country:            params.country ?? 'us',
      location_code,
      language_code,
      source:             params.source ?? 'manual',
    }
    if (params.contentPostId) insertPayload.content_post_id = params.contentPostId
    if (params.connectionId)  insertPayload.connection_id   = params.connectionId
    if (params.intent)        insertPayload.intent          = params.intent

    const { data, error } = await db
      .from('seo_keywords')
      .insert(insertPayload)
      .select('id')
      .maybeSingle()
    if (error) { console.error('[seoRankings] registerKeyword:', error.message); return null }
    return (data as { id?: string } | null)?.id ?? null
  } catch (e) {
    console.error('[seoRankings] registerKeyword threw:', e)
    return null
  }
}

const RANK_COLS =
  'keyword_id,keyword,current_position,previous_position,position_delta,current_rank_absolute,current_url,current_device,movement,search_volume,keyword_difficulty,intent,content_post_id'

function rowToRank(r: Record<string, unknown>): KeywordRank {
  const mv = String(r.movement ?? 'none')
  return {
    keyword_id:            String(r.keyword_id ?? ''),
    keyword:               String(r.keyword ?? ''),
    current_position:      numOrNull(r.current_position),
    previous_position:     numOrNull(r.previous_position),
    position_delta:        numOrNull(r.position_delta),
    current_rank_absolute: numOrNull(r.current_rank_absolute),
    current_url:           r.current_url ? String(r.current_url) : null,
    current_device:        r.current_device ? String(r.current_device) : null,
    movement:              (['up','down','entered','dropped','flat','none'].includes(mv) ? mv : 'none') as KeywordMovement,
    search_volume:         numOrNull(r.search_volume),
    keyword_difficulty:    numOrNull(r.keyword_difficulty),
    intent:                r.intent ? String(r.intent) : null,
    content_post_id:       r.content_post_id ? String(r.content_post_id) : null,
  }
}

/** Current rank for a single content post's target keyword (tracked keywords only). */
export async function getRankForPost(contentPostId: string): Promise<KeywordRank | null> {
  if (!contentPostId) return null
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('seo_keyword_current')
      .select(RANK_COLS)
      .eq('content_post_id', contentPostId)
      .eq('is_tracked', true)
      .order('current_position', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    return rowToRank(data as Record<string, unknown>)
  } catch {
    return null
  }
}

/** Current ranks keyed by content_post_id, for a batch of posts (pipeline cards). */
export async function getRanksForPosts(contentPostIds: string[]): Promise<Record<string, KeywordRank>> {
  const ids = contentPostIds.filter(Boolean)
  if (ids.length === 0) return {}
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('seo_keyword_current')
      .select(RANK_COLS)
      .eq('is_tracked', true)
      .in('content_post_id', ids)
    if (error || !Array.isArray(data)) return {}
    const out: Record<string, KeywordRank> = {}
    for (const row of data as Record<string, unknown>[]) {
      const rank = rowToRank(row)
      if (!rank.content_post_id) continue
      const existing = out[rank.content_post_id]
      if (!existing || betterPosition(rank.current_position, existing.current_position)) {
        out[rank.content_post_id] = rank
      }
    }
    return out
  } catch {
    return {}
  }
}

/** All tracked keyword ranks for a client, best-ranked first (Analytics tab). */
export async function getClientKeywordRankings(clientId: string, limit = 200): Promise<KeywordRank[]> {
  if (!clientId) return []
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('seo_keyword_current')
      .select(RANK_COLS)
      .eq('client_id', clientId)
      .eq('is_tracked', true)
      .order('current_position', { ascending: true, nullsFirst: false })
      .limit(limit)
    if (error || !Array.isArray(data)) return []
    return (data as Record<string, unknown>[]).map(rowToRank)
  } catch {
    return []
  }
}

// ── Write helpers used by the rank-sync cron ──────────────────────────────────

export interface TrackedKeyword {
  id:            string
  keyword:       string
  location_code: number
  language_code: string
}

/** Tracked keywords for a client (the cron rank-checks these). */
export async function getTrackedKeywords(clientId: string): Promise<TrackedKeyword[]> {
  if (!clientId) return []
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('seo_keywords')
      .select('id, keyword, location_code, language_code')
      .eq('client_id', clientId)
      .eq('is_tracked', true)
    if (error || !Array.isArray(data)) return []
    return (data as Record<string, unknown>[]).map(k => ({
      id:            String(k.id),
      keyword:       String(k.keyword ?? ''),
      location_code: numOrNull(k.location_code) ?? 2840,
      language_code: String(k.language_code ?? 'en'),
    }))
  } catch {
    return []
  }
}

/** Upsert one rank snapshot (per keyword per date per device). Soft-fails. */
export async function upsertRanking(params: {
  keywordId:     string
  clientId:      string
  date:          string   // YYYY-MM-DD
  device:        SeoDevice
  position:      number | null
  rankAbsolute?: number | null
  url?:          string | null
  serpFeatures?: string[]
  searchVolume?: number | null
  provider?:     string
}): Promise<boolean> {
  try {
    const db = createAdminClient()
    const { error } = await db.from('seo_rankings').upsert({
      keyword_id:    params.keywordId,
      client_id:     params.clientId,
      date:          params.date,
      device:        params.device,
      position:      params.position,
      rank_absolute: params.rankAbsolute ?? null,
      url:           params.url ?? null,
      serp_features: params.serpFeatures ?? null,
      search_volume: params.searchVolume ?? null,
      provider:      params.provider ?? 'dataforseo',
    }, { onConflict: 'keyword_id,date,device' })
    if (error) { console.error('[seoRankings] upsertRanking:', error.message); return false }
    // Touch the keyword's last_checked_at.
    await db.from('seo_keywords').update({ last_checked_at: new Date().toISOString() }).eq('id', params.keywordId)
    return true
  } catch (e) {
    console.error('[seoRankings] upsertRanking threw:', e)
    return false
  }
}

/** Update a keyword's enrichment (volume/difficulty/cpc/intent) after a keyword refresh. */
export async function updateKeywordEnrichment(keywordId: string, data: {
  search_volume?:      number | null
  keyword_difficulty?: number | null
  cpc?:                number | null
  competition?:        number | null
  intent?:             string | null
  monthly_searches?:   unknown[] | null
}): Promise<void> {
  try {
    const db = createAdminClient()
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (data.search_volume      !== undefined) patch.search_volume      = data.search_volume
    if (data.keyword_difficulty !== undefined) patch.keyword_difficulty = data.keyword_difficulty
    if (data.cpc                !== undefined) patch.cpc                = data.cpc
    if (data.competition        !== undefined) patch.competition        = data.competition
    if (data.intent             !== undefined && data.intent) patch.intent = data.intent
    if (data.monthly_searches   !== undefined) patch.monthly_searches   = data.monthly_searches
    await db.from('seo_keywords').update(patch).eq('id', keywordId)
  } catch { /* soft-fail */ }
}

function betterPosition(a: number | null, b: number | null): boolean {
  if (a === null) return false
  if (b === null) return true
  return a < b
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null
}
