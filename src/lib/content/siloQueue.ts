// ─────────────────────────────────────────────────────────────────────────────
// Silo keyword queue.
//
// A silo does not need a hub page to be useful. The common case is simply:
// "here are four keywords, write me four posts" — which is also the fastest way
// to get a brand-new client's content pipeline moving before anyone has designed
// a hub-and-spoke structure.
//
// content_silo_keywords is the queue. Keywords are consumed in order and marked
// used_at only AFTER the topics they produced are safely inserted, so a failed
// generation never silently burns a keyword.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SiloQueueKeyword {
  id:           string
  keyword:      string
  keyword_type: string
  intent:       string | null
  sort_order:   number
  used_at:      string | null
}

/** Normalise for matching an AI-returned keyword back to a queue row. */
function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * The next unused keywords for a silo, in queue order.
 *
 * Deliberately does NOT claim them — see claimKeywordsForTopics.
 */
export async function fetchQueueKeywords(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  siloId: string,
  limit = 12,
): Promise<SiloQueueKeyword[]> {
  const { data, error } = await db
    .from('content_silo_keywords')
    .select('id, keyword, keyword_type, intent, sort_order, used_at')
    .eq('silo_id', siloId)
    .is('used_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    // The table predates migration 201 on some environments; treat as empty
    // rather than failing the whole generation run.
    console.error('[siloQueue] fetch failed:', error.message)
    return []
  }
  return (data ?? []) as unknown as SiloQueueKeyword[]
}

/** How many keywords are still available / already consumed. */
export async function queueCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  siloId: string,
): Promise<{ total: number; unused: number }> {
  const [{ count: total }, { count: unused }] = await Promise.all([
    db.from('content_silo_keywords').select('id', { count: 'exact', head: true }).eq('silo_id', siloId),
    db.from('content_silo_keywords').select('id', { count: 'exact', head: true }).eq('silo_id', siloId).is('used_at', null),
  ])
  return { total: total ?? 0, unused: unused ?? 0 }
}

/**
 * Link generated topics back to the keywords that produced them, and mark those
 * keywords consumed.
 *
 * Matching is by keyword text first (the model is instructed to target the exact
 * strings), falling back to queue order for anything it reworded. The update
 * carries an `.is('used_at', null)` guard so two concurrent generation runs
 * cannot both consume the same keyword — whichever loses simply updates nothing.
 *
 * Returns the topic-id -> keyword-id pairs that were actually claimed.
 */
export async function claimKeywordsForTopics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  keywords: SiloQueueKeyword[],
  topics: { id: string; target_keyword: string | null }[],
): Promise<{ topicId: string; keywordId: string }[]> {
  if (keywords.length === 0 || topics.length === 0) return []

  const byText = new Map<string, SiloQueueKeyword>()
  for (const k of keywords) byText.set(norm(k.keyword), k)

  const takenKeywordIds = new Set<string>()
  const pairs: { topicId: string; keywordId: string }[] = []
  const unmatchedTopics: string[] = []

  for (const t of topics) {
    const hit = byText.get(norm(t.target_keyword))
    if (hit && !takenKeywordIds.has(hit.id)) {
      takenKeywordIds.add(hit.id)
      pairs.push({ topicId: t.id, keywordId: hit.id })
    } else {
      unmatchedTopics.push(t.id)
    }
  }

  // Positional fallback for reworded keywords, in queue order.
  const leftovers = keywords.filter(k => !takenKeywordIds.has(k.id))
  for (const topicId of unmatchedTopics) {
    const k = leftovers.shift()
    if (!k) break
    takenKeywordIds.add(k.id)
    pairs.push({ topicId, keywordId: k.id })
  }

  const claimed: { topicId: string; keywordId: string }[] = []
  const now = new Date().toISOString()

  for (const pair of pairs) {
    // Compare-and-swap: only claim a keyword that is still unused.
    const { data: won, error } = await db
      .from('content_silo_keywords')
      .update({ used_at: now, target_topic_id: pair.topicId })
      .eq('id', pair.keywordId)
      .is('used_at', null)
      .select('id')

    if (error) { console.error('[siloQueue] claim failed:', error.message); continue }
    if (!won || won.length === 0) continue   // another run got there first

    const { error: linkErr } = await db
      .from('content_topics')
      .update({ silo_keyword_id: pair.keywordId })
      .eq('id', pair.topicId)
    if (linkErr) console.error('[siloQueue] topic link failed:', linkErr.message)

    claimed.push(pair)
  }

  return claimed
}

/**
 * Release a keyword back onto the queue.
 *
 * Called when the topic or post it produced is rejected — otherwise a rejected
 * article would silently retire its keyword and the silo would look exhausted
 * while nothing had actually been published for it.
 */
export async function releaseKeywordForTopic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  topicId: string,
): Promise<void> {
  const { error } = await db
    .from('content_silo_keywords')
    .update({ used_at: null, target_topic_id: null, target_post_id: null })
    .eq('target_topic_id', topicId)
  if (error) console.error('[siloQueue] release failed:', error.message)
}

/** Record which post a keyword ultimately produced (silo -> post provenance). */
export async function attachPostToKeyword(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  topicId: string,
  postId: string,
): Promise<void> {
  const { data: kw } = await db
    .from('content_silo_keywords')
    .select('id')
    .eq('target_topic_id', topicId)
    .maybeSingle()
  if (!kw) return

  await db.from('content_silo_keywords')
    .update({ target_post_id: postId })
    .eq('id', (kw as { id: string }).id)

  await db.from('content_posts')
    .update({ silo_keyword_id: (kw as { id: string }).id })
    .eq('id', postId)
}

/**
 * Prompt block for a hub-less silo.
 *
 * The hub-and-spoke block assumes a pillar page to funnel authority to. With no
 * hub there is nothing to link back to, so the instruction set is different:
 * cover the supplied keywords, one topic each, without inventing a hub link.
 */
export function buildKeywordQueueBlock(
  siloName: string,
  description: string | null,
  keywords: SiloQueueKeyword[],
  alreadyCovered: string,
  injectInternalLinks: boolean,
): string {
  const list = keywords
    .map((k, i) => `  ${i + 1}. "${k.keyword}"${k.intent ? ` (intent: ${k.intent})` : ''}`)
    .join('\n')

  return `
KEYWORD SET — "${siloName}"${description ? `\nContext: ${description}` : ''}

This is a flat keyword set, NOT a hub-and-spoke silo. There is no pillar page.
Do not reference, link to, or invent a hub page.

Write ONE topic for each keyword below, in this order, reusing the keyword
verbatim as that topic's target_keyword:
${list}
${alreadyCovered ? `\nAlready covered in this set (do NOT duplicate these intents):\n${alreadyCovered}` : ''}

RULES (override any conflicting instructions above):
1. Exactly one topic per keyword listed, in the order given.
2. Use each keyword EXACTLY as written for target_keyword — it is how the topic
   is matched back to the queue.
3. Angle each topic so no two compete for the same search intent.
4. ${injectInternalLinks
    ? 'Where it genuinely helps the reader, cross-link to the other articles in this set.'
    : 'Do NOT add internal links between these articles — linking is disabled for this set.'}`
}
