// ─────────────────────────────────────────────────────────────────────────────
// Re-run the quality gate for a post that already exists.
//
// WHY THIS HAS TO EXIST
//
// Migration 206's trigger clears quality_report whenever a content-bearing
// column changes, because a report computed against the old text says nothing
// about the new text. The cron auto-push gate then fails closed: no report means
// no unattended publish.
//
// Those two rules are each correct and together they were a trap. The gate was
// only ever invoked from the three generators, so any OTHER path that legitimately
// writes content — the editor's Save, "Regenerate with notes", the service-area
// generator, the schedule route — cleared the report and had no way to produce a
// new one. One typo fix on an approved post disqualified it from auto-publish
// permanently, and the hold alert's advice ("re-save it to run the checks")
// re-triggered the same bug.
//
// So the gate belongs on the write path. Call this after any update that changes
// content/title/slug/meta and the invariant holds: a post either has a report
// describing its current text, or is deliberately held.
//
// Fetches its own inputs (siblings, site URLs, vertical) so callers do not have
// to reassemble them, and never throws — a failure to re-check leaves the row
// without a report, which is the safe direction.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import { runQualityGate }      from './qualityGate'
import { isRegulatedVertical } from './editorialStandards'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>

interface RecheckablePost {
  id:            string
  client_id:     string
  content_type:  string | null
  title:         string | null
  content:       string | null
  slug:          string | null
  target_keyword: string | null
}

/**
 * Recompute and persist the quality report for one post.
 *
 * Returns the report on success, or null when the post could not be read or the
 * gate could not run. The write is a second statement on purpose: the trigger
 * only clears the report when the SAME statement did not supply one, so writing
 * quality_report here (with no content change) is pure bookkeeping and leaves
 * updated_at alone.
 */
export async function recheckPostQuality(db: Db, postId: string) {
  try {
    const { data } = await db
      .from('content_posts')
      .select('id, client_id, content_type, title, content, slug, target_keyword')
      .eq('id', postId)
      .maybeSingle()

    const post = data as unknown as RecheckablePost | null
    if (!post || !post.content) return null

    const [siblingsRes, sitemapRes, settingsRes] = await Promise.all([
      db.from('content_posts')
        .select('id, title, content')
        .eq('client_id', post.client_id)
        .eq('content_type', post.content_type ?? 'blog')
        .in('status', ['draft_saved', 'published'])
        .neq('id', post.id)
        .order('generated_at', { ascending: false })
        .limit(20),
      db.from('content_sitemap_pages')
        .select('url')
        .eq('client_id', post.client_id)
        .limit(500),
      db.from('content_settings')
        .select('vertical')
        .eq('client_id', post.client_id)
        .maybeSingle(),
    ])

    const report = runQualityGate({
      html:          post.content,
      title:         post.title ?? '',
      targetKeyword: post.target_keyword,
      slug:          post.slug ?? '',
      siteUrls:      ((sitemapRes.data ?? []) as { url: string }[]).map(r => r.url),
      siblings:      (siblingsRes.data ?? []) as { id: string; title: string | null; content: string | null }[],
      regulated:     isRegulatedVertical(
        (settingsRes.data as { vertical?: string | null } | null)?.vertical ?? null,
      ),
    })

    const { error } = await db
      .from('content_posts')
      .update({
        quality_report:          report,
        quality_score:           report.score,
        quality_checked_at:      new Date().toISOString(),
        // A fresh report means the previous hold is resolved one way or the
        // other, so the next hold is allowed to alert again.
        quality_hold_alerted_at: null,
      })
      .eq('id', postId)

    if (error) {
      console.error('[recheckQuality] write failed', postId, error.message)
      return null
    }

    return report
  } catch (e) {
    console.error('[recheckQuality] failed', postId, e instanceof Error ? e.message : e)
    return null
  }
}
