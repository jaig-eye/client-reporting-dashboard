// ─────────────────────────────────────────────────────────────────────────────
// Deleting scheduled content is a FULL STOP, not a hint.
//
// The content cron decides whether to generate for a publish date by asking "does a
// topic already exist for this client on this date?". That makes a plain delete
// self-defeating: removing the row is exactly what frees the slot, so the next run —
// at most two hours later — writes a replacement and the thing you deleted reappears,
// looking for all the world like a regeneration bug.
//
// So deleting records a SUPPRESSION for the slot (migration 209). It outlives the row,
// and the generator skips any date it covers.
//
// The two intents stay separate, which is the distinction the product cares about:
//   • the SLOT is suppressed — nothing regenerates on that date
//   • the SUBJECT is not     — the topic row is really gone, so it is absent from the
//                              avoid-list in generateTopics.ts and may be written
//                              about again on some future date.
// Rejection is the opposite signal: the row STAYS, so the subject is in the avoid-list
// and is never suggested again, and the cron's slot guard now counts 'rejected' as
// occupied so that date is not refilled either.
//
// Every helper here is best-effort about the suppression itself: a delete must never
// fail because the suppression could not be written. Migration 209 may also lag the
// code, so a missing table is logged, not thrown.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SlotRef {
  client_id: string
  target_publish_date: string | null
}

/**
 * Mark publish slots as deliberately emptied so the generator will not refill them.
 * Rows with no target_publish_date are skipped — there is no slot to suppress.
 * Idempotent: the table has a UNIQUE (client_id, target_publish_date) constraint and
 * this upserts against it, so re-deleting the same slot is not an error.
 */
export async function suppressSlots(
  db: SupabaseClient,
  slots: SlotRef[],
  reason: string,
): Promise<void> {
  const seen = new Set<string>()
  const rows: { client_id: string; target_publish_date: string; reason: string }[] = []

  for (const s of slots) {
    if (!s?.client_id || !s.target_publish_date) continue
    const key = `${s.client_id}|${s.target_publish_date}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ client_id: s.client_id, target_publish_date: s.target_publish_date, reason })
  }

  if (rows.length === 0) return

  const { error } = await db
    .from('content_slot_suppressions')
    .upsert(rows, { onConflict: 'client_id,target_publish_date', ignoreDuplicates: true })

  if (error) {
    // Never fatal. The caller's delete has either happened or is about to; failing
    // here would turn a successful delete into a 500 and invite a retry that 404s.
    console.error(
      `[slotSuppression] could not suppress ${rows.length} slot(s) — the content cron may regenerate them. ` +
      `If this says the relation does not exist, apply migration 209. Error:`, error.message,
    )
  }
}

/** Re-open a slot that was previously suppressed, so the generator may fill it again. */
export async function unsuppressSlot(
  db: SupabaseClient,
  clientId: string,
  targetPublishDate: string,
): Promise<void> {
  const { error } = await db
    .from('content_slot_suppressions')
    .delete()
    .eq('client_id', clientId)
    .eq('target_publish_date', targetPublishDate)
  if (error) console.error('[slotSuppression] unsuppress failed:', error.message)
}

/**
 * Resolve the post paired with a topic, or the topic paired with a post.
 *
 * Neither foreign key cascades — content_posts.topic_id and content_topics.post_id are
 * BOTH `ON DELETE SET NULL` — so deleting one side silently orphans the other. That is
 * how a deleted topic left its written post behind at status 'for_review', still
 * rendering on the calendar as though it had been regenerated.
 *
 * The two link columns are populated unevenly in real data (content_topics.post_id on
 * ~85% of rows, content_posts.topic_id on ~29%), so both directions are tried before
 * falling back to the slot pairing the calendar itself displays.
 */
export async function findPairedPostId(
  db: SupabaseClient,
  topic: { id: string; post_id?: string | null; client_id: string; target_publish_date: string | null },
): Promise<string | null> {
  if (topic.post_id) return topic.post_id

  const { data: byTopic } = await db
    .from('content_posts').select('id').eq('topic_id', topic.id).limit(1).maybeSingle()
  if ((byTopic as { id: string } | null)?.id) return (byTopic as { id: string }).id

  if (!topic.target_publish_date) return null
  const { data: bySlot } = await db
    .from('content_posts').select('id')
    .eq('client_id', topic.client_id)
    .eq('target_publish_date', topic.target_publish_date)
    .limit(1).maybeSingle()
  return (bySlot as { id: string } | null)?.id ?? null
}
