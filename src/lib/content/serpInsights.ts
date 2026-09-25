// What Google showed for a search, kept so the Analytics tab can show it too.
//
// The writer already receives this — the People-Also-Ask questions, related searches, who the AI
// Overview cites, who holds the featured snippet — as a prompt block, and then it was thrown away.
// The operator never saw the talking points their posts were written from. Stored on the
// keyword's own row (seo_keywords.metadata.serp) it needs no migration and sits next to the volume
// and rank the same keyword already carries.
//
// Update-only, on purpose. An earlier version inserted a bare row when the keyword had none, and
// every reader of the researched pool — the Analytics table, topic selection — took that row for a
// keyword candidate with no metrics. The write path now files the insight against the row
// registerKeyword() creates for the post (saveSerpInsightById); research files it on the rows it
// inserts itself.

import type { createAdminClient } from '@/lib/supabase/server'
import type { DfsSerpSnapshot } from '@/lib/connectors/dataforseo'

type Db = ReturnType<typeof createAdminClient>

export interface SerpSource { domain: string; title: string; url: string }

/** One keyword's stored insight, as the Analytics tab reads it. */
export interface SerpInsightRow {
  keyword:       string
  tracked:       boolean
  contentPostId: string | null
  insight:       SerpInsight
}

export interface SerpInsight {
  checked_at:       string
  /** The phrase that was searched. Can differ from the row's keyword when the writer pivoted. */
  query:            string
  /** "Los Angeles County,California,United States" when the search was local; null for country-level. */
  location:         string | null
  location_code:    number
  /** SERP element types present: ai_overview, featured_snippet, local_pack, people_also_ask, video, … */
  features:         string[]
  paa:              string[]
  related:          string[]
  /** Null when the search did not ask about an AI Overview; { present: false } when it asked and there was none. */
  ai_overview:      { present: boolean; sources: SerpSource[] } | null
  featured_snippet: SerpSource | null
  local_pack:       Array<{ title: string; domain: string | null; rating: number | null; votes: number | null }>
  organic:          Array<{ domain: string; title: string; url: string; rank: number }>
}

const clip = (s: unknown, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const strings = (v: unknown, n: number, max = 10): string[] =>
  (Array.isArray(v) ? v : []).map(x => clip(x, n)).filter(Boolean).slice(0, max)
const objects = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
// These become <a href>s in the admin UI, and they come from third-party pages Google listed.
// Only a web URL is kept; anything else ("javascript:", data:, a bare path) is dropped.
const webUrl = (u: unknown): string => { const s = clip(u, 300); return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : '' }
// A domain becomes "https://<domain>" when there is no URL, so it must look like a hostname.
const host = (d: unknown): string => { const s = clip(d, 80).toLowerCase(); return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '' }
const source = (s: unknown): SerpSource | null => {
  if (!s || typeof s !== 'object') return null
  const o = s as Record<string, unknown>
  const domain = host(o.domain), url = webUrl(o.url)
  return domain || url ? { domain, title: clip(o.title), url } : null
}

/** A stored insight from a live snapshot. Everything is clipped: this is display data, not a cache. */
export function toSerpInsight(snap: DfsSerpSnapshot, at: { query: string; locationCode: number; location: string | null }): SerpInsight {
  return {
    checked_at:       new Date().toISOString(),
    query:            clip(at.query, 120),
    location:         at.location,
    location_code:    at.locationCode,
    features:         strings(snap.features, 40, 20),
    paa:              strings(snap.paa, 160),
    related:          strings(snap.related, 80),
    ai_overview:      snap.aiOverview
      ? { present: snap.aiOverview.present, sources: snap.aiOverview.sources.map(source).filter((s): s is SerpSource => !!s).slice(0, 8) }
      : null,
    featured_snippet: source(snap.featuredSnippet),
    local_pack:       snap.localPack.slice(0, 8).map(p => ({ title: clip(p.title, 80), domain: host(p.domain) || null, rating: p.rating, votes: p.votes })),
    organic:          snap.organic.filter(o => o.rank <= 10).slice(0, 10)
      .map(o => ({ domain: host(o.domain), title: clip(o.title), url: webUrl(o.url), rank: o.rank }))
      .filter(o => o.domain),
  }
}

/** The insight a seo_keywords row carries, or null. Never trusts the column's shape. */
export function readSerpInsight(metadata: unknown): SerpInsight | null {
  const v = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).serp : null
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.checked_at !== 'string') return null
  const ao = o.ai_overview && typeof o.ai_overview === 'object' ? o.ai_overview as { present?: unknown; sources?: unknown } : null
  return {
    checked_at:       o.checked_at,
    query:            clip(o.query, 120),
    location:         typeof o.location === 'string' ? o.location : null,
    location_code:    Number(o.location_code) || 0,
    features:         strings(o.features, 40, 20),
    paa:              strings(o.paa, 160),
    related:          strings(o.related, 80),
    ai_overview:      ao ? { present: ao.present === true, sources: objects(ao.sources).map(source).filter((s): s is SerpSource => !!s) } : null,
    featured_snippet: source(o.featured_snippet),
    local_pack:       objects(o.local_pack)
      .map(p => ({ title: clip(p.title, 80), domain: host(p.domain) || null, rating: typeof p.rating === 'number' ? p.rating : null, votes: typeof p.votes === 'number' ? p.votes : null }))
      .filter(p => p.title),
    organic:          objects(o.organic)
      .map(r => ({ domain: host(r.domain), title: clip(r.title), url: webUrl(r.url), rank: Number(r.rank) || 0 }))
      .filter(r => r.domain),
  }
}

/**
 * Merge `patch` into the metadata of the client's row for `keyword`, when there is one. False
 * when there is no row or the write failed. Never inserts — see the header.
 */
export async function patchKeywordMetadata(db: Db, clientId: string, keyword: string, patch: Record<string, unknown>): Promise<boolean> {
  const normalized = keyword.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!clientId || !normalized) return false
  try {
    const { data } = await db
      .from('seo_keywords')
      .select('id, metadata')
      .eq('client_id', clientId)
      .eq('normalized_keyword', normalized)
      .limit(1)
      .maybeSingle()
    const row = data as { id?: string; metadata?: Record<string, unknown> | null } | null
    if (!row?.id) return false
    const { error } = await db.from('seo_keywords')
      .update({ metadata: { ...(row.metadata ?? {}), ...patch }, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) { console.warn('[serp-insights] metadata not saved:', error.message); return false }
    return true
  } catch (e) {
    console.warn('[serp-insights] metadata not saved:', e)
    return false
  }
}

/** File the insight on the keyword's existing row. Best-effort; false when the keyword has no row yet. */
export function saveSerpInsight(db: Db, clientId: string, keyword: string, insight: SerpInsight): Promise<boolean> {
  return patchKeywordMetadata(db, clientId, keyword, { serp: insight })
}

/** File the insight on a row by id — the one registerKeyword() returned for the post. */
export async function saveSerpInsightById(db: Db, keywordId: string, insight: SerpInsight): Promise<boolean> {
  if (!keywordId) return false
  try {
    const { data } = await db.from('seo_keywords').select('metadata').eq('id', keywordId).maybeSingle()
    const metadata = ((data as { metadata?: Record<string, unknown> | null } | null)?.metadata) ?? {}
    const { error } = await db.from('seo_keywords')
      .update({ metadata: { ...metadata, serp: insight }, updated_at: new Date().toISOString() })
      .eq('id', keywordId)
    if (error) { console.warn('[serp-insights] not saved:', error.message); return false }
    return true
  } catch (e) {
    console.warn('[serp-insights] not saved:', e)
    return false
  }
}
