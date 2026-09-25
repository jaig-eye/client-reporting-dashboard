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

type KeywordMovement = 'up' | 'down' | 'entered' | 'dropped' | 'flat' | 'none'

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
      .select('id, content_post_id, is_tracked')
      .eq('client_id', params.clientId)
      .eq('normalized_keyword', normalized)
      .eq('location_code', location_code)
      .eq('language_code', language_code)
      .maybeSingle()

    const row = existing as { id?: string; content_post_id?: string | null; is_tracked?: boolean | null } | null
    if (row?.id) {
      // Fill the post link only if empty — never overwrite an earlier post's claim.
      if (params.contentPostId && !row.content_post_id) {
        await db.from('seo_keywords')
          .update({
            content_post_id: params.contentPostId,
            // Writing the article is what turns a candidate into something worth measuring.
            // Discovery deliberately stores its suggestions untracked so nobody is billed to
            // rank-check a list a tool produced; without this, a keyword we researched, chose and
            // wrote for stayed untracked forever while one the model invented was tracked by
            // default. Only ever set here, never cleared — un-tracking stays a human decision.
            is_tracked:      true,
            updated_at:      new Date().toISOString(),
          })
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
  id:              string
  keyword:         string
  location_code:   number
  language_code:   string
  last_checked_at: string | null
  /** The post this keyword was registered for, when it came from content. */
  content_post_id: string | null
  /**
   * Days since the post went live. Null when no post backs this keyword — a money keyword or a
   * manual one, which never matures and stays at the top of the cadence ladder.
   * Drives the check cadence — see checkIntervalDays in the rankings cron.
   */
  age_days:        number | null
  /**
   * A post is attached but has not published yet.
   *
   * Distinct from age_days === null, which means there is no post at all. A draft has nothing to
   * rank, so checking it buys a guaranteed miss — and keywords are claimed at generation, often
   * weeks before publication, so this is the common case rather than an edge one.
   */
  awaiting_publish: boolean
}

/** Tracked keywords for a client (the cron rank-checks these). Carries last_checked_at so the
 *  cron can rotate GLOBALLY across all clients (per-client ordering alone starves later clients). */
export async function getTrackedKeywords(clientId: string): Promise<TrackedKeyword[]> {
  if (!clientId) return []
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('seo_keywords')
      .select('id, keyword, location_code, language_code, last_checked_at, content_post_id, created_at')
      .eq('client_id', clientId)
      .eq('is_tracked', true)
      .order('last_checked_at', { ascending: true, nullsFirst: true })
    if (error || !Array.isArray(data)) return []
    const rows = data as Record<string, unknown>[]

    // A keyword's age is its post's age. Published date beats registration date: a keyword can be
    // registered weeks before the article goes out, and it is the article's time in the index that
    // decides how fast its position is still moving.
    const postIds = Array.from(new Set(rows.map(r => r.content_post_id).filter((v): v is string => typeof v === 'string')))
    const publishedAt = new Map<string, string>()
    if (postIds.length > 0) {
      const { data: posts, error: postsErr } = await db
        .from('content_posts')
        .select('id, published_at, last_pushed_at')
        .in('id', postIds)
      // Ages drive the whole cadence. A failure leaves every age null, which reads as "money
      // keyword" and puts the entire universe on the fastest check interval — the expensive
      // direction, silently.
      if (postsErr) console.warn('[seoRankings] cannot read post dates, ages unavailable:', postsErr.message)
      // published_at is only written by the legacy /content/publish route. Everything that goes
      // out through Approve & Push — which is everything, in practice — stamps last_pushed_at
      // instead, so reading published_at alone left every real post looking unpublished:
      // awaiting_publish stayed true and the rankings cron skipped the entire universe.
      for (const p of (posts ?? []) as { id: string; published_at: string | null; last_pushed_at: string | null }[]) {
        const anchor = p.published_at ?? p.last_pushed_at
        if (anchor) publishedAt.set(p.id, anchor)
      }
    }

    const daysSince = (iso: string | null): number | null => {
      if (!iso) return null
      const t = Date.parse(iso)
      if (!isFinite(t)) return null
      return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
    }

    return rows.map(k => {
      const postId = typeof k.content_post_id === 'string' ? k.content_post_id : null
      // No post means a money keyword or a manual one, and it has no age. The rankings cron
      // SKIPS those (`age_days === null`) and leaves them to the free site-wide snapshot rather
      // than paying for a live check — this comment used to claim the opposite, which is worth
      // knowing if the policy is ever revisited: the snapshot only covers terms the domain
      // already ranks for, so a money keyword it has not broken into yet is never measured.
      const anchor = postId ? (publishedAt.get(postId) ?? null) : null
      return {
        id:               String(k.id),
        keyword:          String(k.keyword ?? ''),
        location_code:    numOrNull(k.location_code) ?? 2840,
        language_code:    String(k.language_code ?? 'en'),
        last_checked_at:  k.last_checked_at ? String(k.last_checked_at) : null,
        content_post_id:  postId,
        age_days:         postId ? daysSince(anchor) : null,
        // A post that exists but has never published. Its keyword has nothing to rank yet.
        awaiting_publish: !!postId && anchor === null,
      }
    })
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
    return true
  } catch (e) {
    console.error('[seoRankings] upsertRanking threw:', e)
    return false
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
