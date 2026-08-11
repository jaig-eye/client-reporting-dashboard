// ─────────────────────────────────────────────────────────────────────────────
// SEO keyword & rank datastream helpers
//
// Read/write layer over the seo_keywords / seo_rankings tables (migration 189) and
// the seo_keyword_current view. Provider-agnostic: today keywords can be registered
// from content topics or GSC; once OpenSEO is connected its rank checks upsert into
// seo_rankings and these same reads light up the Analytics tab, pipeline cards, and
// the post editor's SEO panel.
//
// Every function SOFT-FAILS (returns null / [] / {}) if the tables do not yet exist
// (migration not applied) or on any query error, so content generation never breaks.
// ─────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from '@/lib/supabase/server'

export interface KeywordRank {
  keyword_id:         string
  keyword:            string
  current_position:   number | null
  previous_position:  number | null
  position_delta:     number | null   // +ve = improved (moved toward #1)
  current_url:        string | null
  search_volume:      number | null
  keyword_difficulty: number | null
  intent:             string | null
  content_post_id:    string | null
}

type KeywordSource = 'manual' | 'gsc' | 'topic' | 'openseo' | 'ahrefs'

function normalize(kw: string): string {
  return kw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Idempotently register a tracked keyword for a client. Returns the keyword_id, or
 * null on failure. Only the fields you pass are written, so calling this from topic
 * generation (with contentPostId) never clobbers volume/rank enrichment from OpenSEO.
 */
export async function registerKeyword(params: {
  clientId:       string
  keyword:        string
  country?:       string
  source?:        KeywordSource
  contentPostId?: string | null
  connectionId?:  string | null
  intent?:        string | null
}): Promise<string | null> {
  const keyword = params.keyword?.trim()
  if (!params.clientId || !keyword) return null
  const country = params.country ?? 'us'
  try {
    const db = createAdminClient()
    const payload: Record<string, unknown> = {
      client_id:          params.clientId,
      keyword,
      normalized_keyword: normalize(keyword),
      country,
      source:             params.source ?? 'manual',
      updated_at:         new Date().toISOString(),
    }
    if (params.contentPostId) payload.content_post_id = params.contentPostId
    if (params.connectionId)  payload.connection_id   = params.connectionId
    if (params.intent)        payload.intent          = params.intent

    const { data, error } = await db
      .from('seo_keywords')
      .upsert(payload, { onConflict: 'client_id,normalized_keyword,country' })
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
  'keyword_id,keyword,current_position,previous_position,position_delta,current_url,search_volume,keyword_difficulty,intent,content_post_id'

function rowToRank(r: Record<string, unknown>): KeywordRank {
  return {
    keyword_id:         String(r.keyword_id ?? ''),
    keyword:            String(r.keyword ?? ''),
    current_position:   numOrNull(r.current_position),
    previous_position:  numOrNull(r.previous_position),
    position_delta:     numOrNull(r.position_delta),
    current_url:        r.current_url ? String(r.current_url) : null,
    search_volume:      numOrNull(r.search_volume),
    keyword_difficulty: numOrNull(r.keyword_difficulty),
    intent:             r.intent ? String(r.intent) : null,
    content_post_id:    r.content_post_id ? String(r.content_post_id) : null,
  }
}

/** Current rank for a single content post's target keyword (nearest match). */
export async function getRankForPost(contentPostId: string): Promise<KeywordRank | null> {
  if (!contentPostId) return null
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('seo_keyword_current')
      .select(RANK_COLS)
      .eq('content_post_id', contentPostId)
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
      .in('content_post_id', ids)
    if (error || !Array.isArray(data)) return {}
    const out: Record<string, KeywordRank> = {}
    for (const row of data as Record<string, unknown>[]) {
      const rank = rowToRank(row)
      if (!rank.content_post_id) continue
      // Keep the best (lowest) current position when multiple keywords map to one post.
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

function betterPosition(a: number | null, b: number | null): boolean {
  if (a === null) return false
  if (b === null) return true
  return a < b
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null
}
