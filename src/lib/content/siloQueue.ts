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
    .eq('selected', true)
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

  const now = new Date().toISOString()

  // Concurrent, not serial. Each claim needs its own statement — the
  // compare-and-swap writes a DIFFERENT target_topic_id per row, so it cannot
  // collapse into one bulk UPDATE — but they are independent, and the queue
  // returns up to 12 keywords. Serially that was ~24 round trips (a second of
  // pure latency) per silo generation, multiplied by every silo-backed client on
  // every cron run. The compare-and-swap is what makes concurrency safe here:
  // whichever writer loses the `is('used_at', null)` race simply updates nothing.
  const claimed = (await Promise.all(pairs.map(async pair => {
    const { data: won, error } = await db
      .from('content_silo_keywords')
      .update({ used_at: now, target_topic_id: pair.topicId })
      .eq('id', pair.keywordId)
      .is('used_at', null)
      .select('id')

    if (error) { console.error('[siloQueue] claim failed:', error.message); return null }
    if (!won || won.length === 0) return null   // another run got there first

    const { error: linkErr } = await db
      .from('content_topics')
      .update({ silo_keyword_id: pair.keywordId })
      .eq('id', pair.topicId)
    if (linkErr) console.error('[siloQueue] topic link failed:', linkErr.message)

    return pair
  }))).filter((p): p is { topicId: string; keywordId: string } => p !== null)

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
  return releaseKeywordsForTopics(db, [topicId])
}

/**
 * Bulk form, for the paths that reject many topics at once — the slot-quota
 * auto-reject, the bulk-reject endpoint, and the topic swap inside
 * full-regenerate. Without this those routes strand their keywords as used
 * forever and the silo reads as exhausted.
 */
export async function releaseKeywordsForTopics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  topicIds: string[],
): Promise<void> {
  if (topicIds.length === 0) return
  const { error } = await db
    .from('content_silo_keywords')
    .update({ used_at: null, target_topic_id: null, target_post_id: null })
    .in('target_topic_id', topicIds)
    // A keyword that already PRODUCED a post is not free, whatever happened to
    // the topic row afterwards. Deleting or rejecting the topic used to match
    // here regardless, so a keyword whose article is live went back on the queue,
    // the silo counted it as an open slot, and the next generation handed the
    // same term to a second topic — two articles competing for one keyword,
    // which is precisely the invariant dismiss/route.ts guards. Clearing
    // target_post_id at the same time also severed the provenance link while
    // content_posts.silo_keyword_id still pointed the other way.
    .is('target_post_id', null)
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
  // 'transactional', 'navigational' and 'local' are valid values of the intent
  // column (migration 165) but naming them here tells a BLOG topic generator to
  // serve an intent blogs may not serve. Only the intents a blog can legitimately
  // target are passed through; the rest are simply omitted rather than argued with.
  const BLOG_SAFE_INTENTS = new Set(['informational', 'commercial'])
  const list = keywords
    .map((k, i) => {
      const intent = k.intent && BLOG_SAFE_INTENTS.has(k.intent) ? ` (intent: ${k.intent})` : ''
      return `  ${i + 1}. "${k.keyword}"${intent}`
    })
    .join('\n')

  return `
KEYWORD SET — "${siloName}"${description ? `\nContext: ${description}` : ''}

This is a flat keyword set, NOT a hub-and-spoke silo. There is no pillar page.
Do not reference, link to, or invent a hub page.

Write ONE topic for each keyword below, in this order, reusing the keyword
verbatim as that topic's target_keyword:
${list}
${alreadyCovered ? `\nAlready covered in this set (do NOT duplicate these intents):\n${alreadyCovered}` : ''}

RULES:
1. Exactly one topic per keyword listed, in the order given.
2. Use each keyword EXACTLY as written for target_keyword — UNLESS it would break
   the blog-intent rules stated above. Those rules win: a blog target_keyword must
   be a question or an informational noun phrase, never a bare geo+service term
   ("roof repair Dallas"), a "near me" phrase, or anything transactional. When a
   queued keyword is one of those, keep it as the SUBJECT of the article and write
   an informational target_keyword for it instead — the queue still matches the
   topic by position, so nothing is lost.
3. Angle each topic so no two compete for the same search intent.
4. ${injectInternalLinks
    ? 'Where it genuinely helps the reader, cross-link to the other articles in this set.'
    : 'Do NOT add internal links between these articles — linking is disabled for this set.'}`
}
