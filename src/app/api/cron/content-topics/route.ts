// GET /api/cron/content-topics
// Daily cron (7 AM + 7 PM UTC) that drives automated content scheduling.
//
// Topic generation timing is automatic based on frequency × weeks_ahead:
//   weekly  + weeks_ahead=1 → topics generated 7 days before publish
//   weekly  + weeks_ahead=2 → topics maintained for both upcoming slots (14-day window)
//   monthly + weeks_ahead=1 → topics generated 28 days before publish
//
// As each slot publishes, the next slot enters the window and is automatically covered.
// Emails are batched per client — one "Topics Ready" email and one "Posts Ready" email
// per client per run, instead of one email per slot/post.

export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeCompare } from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase/server'
import { generateTopicsForClient }   from '@/lib/content/generateTopics'
import type { TopicSummary }         from '@/lib/content/generateTopics'
import { sendEmail }                 from '@/lib/email'
import { buildTopicsEmail, buildPostsEmail } from '@/lib/content/emailTemplates'
import { sendDiscordMessage }        from '@/lib/discord'
import { getNotif, type NotifConfig } from '@/lib/notificationConfig'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCycleDays(frequency: string): number {
  switch (frequency) {
    case 'monthly': case 'monthly_first': case 'monthly_mid': case 'monthly_end': return 28
    case 'biweekly': return 14
    case 'weekly':   return 7
    default:         return 1
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getDate()
}

function computeFutureSlots(frequency: string, dayOfWeek: number, weeksLookahead: number): string[] {
  const now  = new Date()
  const end  = new Date(now.getTime() + weeksLookahead * 7 * 86_400_000)
  const slots: string[] = []

  if (frequency === 'daily') {
    let cur = new Date(now.getTime() + 86_400_000)
    while (cur <= end) { slots.push(cur.toISOString().slice(0, 10)); cur = new Date(cur.getTime() + 86_400_000) }
    return slots
  }

  if (frequency === 'weekly' || frequency === 'biweekly') {
    const interval = frequency === 'biweekly' ? 14 : 7
    let cur = new Date(now)
    const daysUntil = (dayOfWeek - cur.getUTCDay() + 7) % 7 || 7
    cur = new Date(cur.getTime() + daysUntil * 86_400_000)
    while (cur <= end) { slots.push(cur.toISOString().slice(0, 10)); cur = new Date(cur.getTime() + interval * 86_400_000) }
    return slots
  }

  if (frequency === 'monthly' || frequency === 'monthly_first' || frequency === 'monthly_mid' || frequency === 'monthly_end') {
    const targetDay = frequency === 'monthly_first' ? 1
                    : frequency === 'monthly_mid'   ? 15
                    : frequency === 'monthly_end'   ? 28
                    : now.getUTCDate()
    let y = now.getUTCFullYear(), m = now.getUTCMonth()
    while (true) {
      const candidate = new Date(Date.UTC(y, m, Math.min(targetDay, daysInMonth(y, m))))
      if (candidate > end) break
      if (candidate > now) slots.push(candidate.toISOString().slice(0, 10))
      m++; if (m > 11) { m = 0; y++ }
    }
    return slots
  }

  return []
}

// ── Cron handler ──────────────────────────────────────────────────────────────

interface PostSummary {
  title:              string | null
  targetKeyword:      string | null
  targetPublishDate:  string | null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!timingSafeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Load global notification settings once (used for batch emails)
  const { data: agencySettings } = await db
    .from('agency_settings')
    .select('notification_email, agency_name, notify_topics_created, notify_topic_ready, notify_post_generated, discord_bot_token, discord_ops_channel_id, consolidated_email_notifications, notification_config, quality_gate_blocks_autopush')
    .single()

  const notifEmail          = (agencySettings?.notification_email          as string | null)  ?? null
  const agencyName          = (agencySettings?.agency_name                 as string | null)  ?? 'Agency Dashboard'
  const consolidatedEmail   = (agencySettings?.consolidated_email_notifications as boolean | null) ?? true
  // Default true: unattended publishing is the risk, so the gate is on unless
  // an agency explicitly opts out.
  const qualityGateBlocksAutopush = (agencySettings?.quality_gate_blocks_autopush as boolean | null) ?? true
  const appUrl              = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

  // Ops channel: DB value preferred; env var as fallback for zero-downtime deploys
  const opsChannelId  = ((agencySettings?.discord_ops_channel_id as string | null) ?? process.env.DISCORD_OPS_CHANNEL_ID) ?? null
  const notifConfig   = (agencySettings?.notification_config as NotifConfig | null) ?? {}

  // Load all clients with auto_generate enabled
  const { data: settingsRows } = await db
    .from('content_settings')
    .select('client_id, schedule_frequency, schedule_day_of_week, weeks_ahead, auto_approve_topics, auto_push_posts, generate_service_pages, generate_regular_pages')
    .eq('auto_generate', true)
    .not('client_id', 'is', null)

  if (!settingsRows || settingsRows.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'No clients with auto_generate enabled' })
  }

  // Global fallback schedule
  const { data: globalSettings } = await db
    .from('content_settings')
    .select('schedule_frequency, schedule_day_of_week')
    .is('client_id', null)
    .maybeSingle()

  const globalFreq = (globalSettings as { schedule_frequency?: string } | null)?.schedule_frequency ?? 'weekly'
  const globalDay  = (globalSettings as { schedule_day_of_week?: number } | null)?.schedule_day_of_week ?? 1

  // Reset topics stuck in 'generating' for more than 1 hour (timed out or crashed)
  await db
    .from('content_topics')
    .update({ status: 'approved', generation_error: 'Timed out — reset by cron. Click retry to regenerate.' })
    .eq('status', 'generating')
    .lt('updated_at', new Date(Date.now() - 3_600_000).toISOString())

  // Same for POSTS. full-regenerate claims a post by setting status='generating'
  // and does the work in waitUntil; if that background job is KILLED rather than
  // throwing (function timeout, instance recycle, deploy mid-flight) its catch
  // never runs and the claim is never released. Every retry then matches the
  // `.neq('status','generating')` guard, claims nothing, and returns
  // 200 {queued:false,'Already regenerating'} — so the UI reports success while
  // the post is stuck forever and silently dropped from the auto-push selector.
  //
  // maxDuration there is 300s, so an hour is comfortably past any real run.
  // 'for_review' is the status a successful regenerate would have landed on.
  const { data: reapedPosts } = await db
    .from('content_posts')
    .update({ status: 'for_review' })
    .eq('status', 'generating')
    .lt('updated_at', new Date(Date.now() - 3_600_000).toISOString())
    .select('id, title')

  if (reapedPosts && reapedPosts.length > 0) {
    console.warn(`[content-topics] released ${reapedPosts.length} post(s) stuck in 'generating'`)
  }

  // Per-client email accumulators
  const topicAccum = new Map<string, { clientName: string; items: TopicSummary[] }>()
  const postAccum  = new Map<string, { clientName: string; items: PostSummary[] }>()

  // Blog post jobs collected during the per-client loop, executed in parallel after
  // all clients are processed. Decouples AI generation from the sequential client loop
  // so 10+ clients don't serially stack AI calls and blow the 300s cron timeout.
  type PendingPostJob = {
    topicId: string; topic: string; targetKeyword: string | null
    targetPublishDate: string | null; contentType: string | null
    clientId: string; clientName: string
  }
  const pendingBlogJobs: PendingPostJob[] = []

  const topicsGenerated: string[] = []
  const briefsGenerated: string[] = []
  const postsTriggered:  string[] = []

  for (const row of settingsRows) {
    const {
      client_id,
      schedule_frequency,
      schedule_day_of_week,
      weeks_ahead           = 1,
      auto_approve_topics   = true,  // legacy default: auto_generate implies auto_approve
      auto_push_posts       = false,
      generate_service_pages = false,
      generate_regular_pages = false,
    } = row as {
      client_id:              string
      schedule_frequency:     string | null
      schedule_day_of_week:   number | null
      weeks_ahead:            number
      auto_approve_topics:    boolean
      auto_push_posts:        boolean
      generate_service_pages: boolean
      generate_regular_pages: boolean
    }

    const frequency = (schedule_frequency as string | null) ?? globalFreq
    const dayOfWeek = (schedule_day_of_week as number | null) ?? globalDay

    const cycle      = getCycleDays(frequency)
    const leadWindow = cycle * Math.max(weeks_ahead, 1)
    const weeksToScan = Math.ceil(leadWindow / 7) + 1

    const slots = computeFutureSlots(frequency, dayOfWeek, weeksToScan).filter(slot => {
      const ms = new Date(slot + 'T00:00:00Z').getTime() - Date.now()
      const d  = Math.round(ms / 86_400_000)
      return d > 0 && d <= leadWindow
    })

    // ── Silo auto-selection: pick least-covered active silo, filtered by active content types ──
    let autoSiloId: string | undefined
    let autoSiloTargetExists: boolean | undefined
    let autoSiloTargetKeyword: string | undefined
    {
      // service_page and regular_page are now generated on-demand via the
      // Page Generation Wizard — they no longer participate in automated silo discovery.
      // The post-generation loop still processes any wizard-queued approved topics of those types.
      void generate_service_pages  // suppress unused-var lint without removing the destructure
      void generate_regular_pages
      const activeContentTypes: string[] = ['blog']

      const { data: activeSilos } = await db
        .from('content_silos')
        .select('id, content_type, target_exists, target_keyword, priority')
        .eq('client_id', client_id)
        .eq('status', 'active')
        .in('content_type', activeContentTypes)
        .order('priority', { ascending: true })

      if (activeSilos && activeSilos.length > 0) {
        type SiloCandidate = { id: string; content_type: string; target_exists: boolean; target_keyword: string | null; priority: number }
        const siloList = activeSilos as SiloCandidate[]
        const siloIds  = siloList.map(s => s.id)

        const { data: clusterPosts } = await db
          .from('content_posts')
          .select('silo_id')
          .in('silo_id', siloIds)
          .in('status', ['for_review', 'approved', 'draft_saved', 'published', 'pending'])

        const counts = new Map<string, number>(siloIds.map(id => [id, 0]))
        for (const p of (clusterPosts ?? []) as { silo_id: string }[]) {
          counts.set(p.silo_id, (counts.get(p.silo_id) ?? 0) + 1)
        }

        // Sort by priority ASC, then post count ASC (least-covered within same priority tier)
        const ranked = [...siloList].sort((a, b) => {
          const priDiff = a.priority - b.priority
          if (priDiff !== 0) return priDiff
          return (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0)
        })

        const chosen = ranked[0]
        if (chosen) {
          autoSiloId            = chosen.id
          autoSiloTargetExists  = chosen.target_exists
          autoSiloTargetKeyword = chosen.target_keyword ?? undefined
          console.log(`[content-topics cron] auto-selected silo ${autoSiloId} (${chosen.content_type}, priority=${chosen.priority}, posts=${counts.get(autoSiloId) ?? 0}) for ${client_id}`)
          if (!chosen.target_exists && chosen.target_keyword) {
            console.log(`[content-topics cron] silo ${autoSiloId} hub not yet created — target_keyword: "${chosen.target_keyword}"`)
          }
        }
      }
    }

    // ── Topic generation: cover every slot in the lead window ─────────────
    for (const slot of slots) {
      const { data: existing } = await db
        .from('content_topics')
        .select('id')
        .eq('client_id', client_id)
        .eq('target_publish_date', slot)
        .in('status', ['pending', 'approved', 'generating', 'generated', 'scheduled'])
        .limit(1)

      if (existing && existing.length > 0) continue

      try {
        const result = await generateTopicsForClient(db, client_id, 1, slot, { suppressEmail: true, siloId: autoSiloId })
        if (result.topics.length > 0) {
          const entry = topicAccum.get(client_id) ?? { clientName: result.clientName, items: [] }
          entry.items.push(...result.topics)
          topicAccum.set(client_id, entry)
          topicsGenerated.push(`${client_id}:${slot}`)

          // Flip target_exists=true if we just generated hub topic for this silo
          if (autoSiloId && autoSiloTargetExists === false && autoSiloTargetKeyword) {
            const hubTopic = result.topics.find(t =>
              t.target_keyword?.toLowerCase().includes(autoSiloTargetKeyword!.toLowerCase()) ||
              autoSiloTargetKeyword!.toLowerCase().includes((t.target_keyword ?? '').toLowerCase())
            )
            if (hubTopic) {
              await db.from('content_silos').update({ target_exists: true }).eq('id', autoSiloId)
              console.log(`[content-topics cron] flipped target_exists=true for silo ${autoSiloId} (hub topic: "${hubTopic.topic}")`)
              autoSiloTargetExists = true
            } else {
              console.warn(`[content-topics cron] silo ${autoSiloId} hub not found in generated topics — target_exists not flipped`)
            }
          }
        }
      } catch (e) {
        console.error(`[content-topics cron] Topic generation failed for client ${client_id} slot ${slot}:`, e)
      }
    }

    // ── Auto-approve: topics still pending past their review deadline ────────
    // Per-date-group: ALL groups are processed, each capped at posts_per_run.
    // Within each group, highest search_volume first, then lowest keyword_difficulty.
    if (auto_approve_topics) {
      const approveThreshold = new Date()
      approveThreshold.setUTCDate(approveThreshold.getUTCDate() + 35) // 35 days: posts generate ~5 weeks ahead for the monthly review workflow

      // Fetch all eligible pending topics (dated)
      const { data: pendingTopics } = await db
        .from('content_topics')
        .select('id, target_publish_date, search_volume, keyword_difficulty')
        .eq('client_id', client_id)
        .eq('status', 'pending')
        .lte('target_publish_date', approveThreshold.toISOString().slice(0, 10))
        .not('target_publish_date', 'is', null)

      // Group by date, pick best 1 per group (one topic → one post per slot)
      type PendingTopic = { id: string; target_publish_date: string | null; search_volume: number | null; keyword_difficulty: number | null }
      const grouped = new Map<string, PendingTopic[]>()
      for (const t of (pendingTopics ?? []) as PendingTopic[]) {
        const key = t.target_publish_date ?? 'none'
        grouped.set(key, [...(grouped.get(key) ?? []), t])
      }
      const toApprove: string[] = []
      for (const [, group] of Array.from(grouped)) {
        const picked = (group as PendingTopic[])
          .sort((a: PendingTopic, b: PendingTopic) => (b.search_volume ?? 0) - (a.search_volume ?? 0)
            || (a.keyword_difficulty ?? 99) - (b.keyword_difficulty ?? 99))
          .slice(0, 1)
        toApprove.push(...picked.map((t: PendingTopic) => t.id))
      }

      if (toApprove.length) {
        await db.from('content_topics')
          .update({ status: 'approved', auto_approved_at: new Date().toISOString() })
          .in('id', toApprove)
        console.log(`[content-topics cron] auto-approved ${toApprove.length} topics (${grouped.size} date groups) for ${client_id}`)
      }

      // Also approve dateless topics pending >3 days (1 per run)
      const staleCutoff = new Date(Date.now() - 3 * 86_400_000).toISOString()
      const { data: datelessRaw } = await db
        .from('content_topics')
        .select('id, search_volume, keyword_difficulty')
        .eq('client_id', client_id)
        .eq('status', 'pending')
        .is('target_publish_date', null)
        .lte('created_at', staleCutoff)
      const datelessPicked = ((datelessRaw ?? []) as PendingTopic[])
        .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0)
          || (a.keyword_difficulty ?? 99) - (b.keyword_difficulty ?? 99))
        .slice(0, 1)
      if (datelessPicked.length) {
        await db.from('content_topics')
          .update({ status: 'approved', auto_approved_at: new Date().toISOString() })
          .in('id', datelessPicked.map(t => t.id))
        console.log(`[content-topics cron] auto-approved ${datelessPicked.length} dateless topics for ${client_id}`)
      }
    }

    // ── SEO briefs: generate for approved topics that don't have one yet ──
    const { data: brieflessTopics } = await db
      .from('content_topics')
      .select('id')
      .eq('client_id', client_id)
      .in('status', ['approved', 'scheduled'])
      .is('seo_brief', null)

    await Promise.allSettled((brieflessTopics ?? []).map(async (topic) => {
      try {
        const res = await fetch(`${appUrl}/api/admin/content/topics/${topic.id}/brief`, {
          method:  'POST',
          headers: { 'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}` },
        })
        if (res.ok) briefsGenerated.push(topic.id)
        else console.error(`[content-topics cron] brief ${topic.id} returned ${res.status}: ${await res.text().catch(() => '')}`)
      } catch (e) {
        console.error(`[content-topics cron] Brief generation failed for topic ${topic.id}:`, e)
      }
    }))

    // ── Post generation: cover all approved slots within the lead window ────────
    // Use leadWindow (not a hardcoded 14 days) so posts generate as far ahead as
    // topics — enabling all of next month's posts to be ready before the month starts.
    const { data: approvedTopics } = await db
      .from('content_topics')
      .select('id, topic, target_keyword, target_publish_date, content_type')
      .eq('client_id', client_id)
      .in('status', ['scheduled', 'approved'])
      .or(`target_publish_date.is.null,target_publish_date.lte.${new Date(Date.now() + leadWindow * 86_400_000).toISOString().slice(0, 10)}`)
      .order('target_publish_date', { ascending: true })

    // Resolve client name once for the post accumulator
    let clientNameForPost = topicAccum.get(client_id)?.clientName ?? ''
    if (!clientNameForPost) {
      const { data: cl } = await db.from('clients').select('name').eq('id', client_id).single()
      clientNameForPost = (cl as { name?: string } | null)?.name ?? client_id
    }

    // Collect up to 3 approved topics per client — Phase 2 (after all clients) runs
    // them concurrently so AI calls span clients rather than stacking per client.
    // Skip service_area topics: they are handled exclusively by the SA loop below.
    // Including them here would cause duplicate generation once Phase 2 fires.
    for (const topic of (approvedTopics ?? []).slice(0, 3)) {
      const t = topic as { id: string; topic: string; target_keyword: string | null; target_publish_date: string | null; content_type: string | null }
      if (t.content_type === 'service_area') continue
      pendingBlogJobs.push({
        topicId:           t.id,
        topic:             t.topic,
        targetKeyword:     t.target_keyword,
        targetPublishDate: t.target_publish_date,
        contentType:       t.content_type,
        clientId:          client_id,
        clientName:        clientNameForPost,
      })
    }

    // ── Auto-push: admin-approved posts with publish date approaching ─────────
    // Requires explicit admin approval (status = 'approved') — prevents unreviewed posts
    // from auto-publishing. Dateless posts are excluded: they can't be reviewed in the
    // list view and must be manually pushed.
    if (auto_push_posts) {
      const pushThreshold = new Date()
      pushThreshold.setUTCDate(pushThreshold.getUTCDate() + 2)
      // NOTE: the platform-id filters that used to live here have been removed.
      //
      // `.is('wp_post_id', null)` meant a post that was regenerated after going
      // live could never be picked up again — which was half of the dead end the
      // approve route now fixes. A live post is eligible again only when its DB
      // copy is genuinely newer than the CMS copy, which is filtered below rather
      // than in SQL so the comparison stays in one place.
      const { data: duePosts } = await db
        .from('content_posts')
        .select('id, title, quality_report, quality_hold_alerted_at, wp_post_id, bc_post_id, updated_at, last_pushed_at')
        .eq('client_id', client_id)
        .eq('status', 'approved')
        .lte('target_publish_date', pushThreshold.toISOString().slice(0, 10))
        .not('target_publish_date', 'is', null)

      type DuePost = {
        id: string; title: string | null
        quality_report?: { blocksAutoPush?: boolean; findings?: { severity: string; message: string }[] } | null
        quality_hold_alerted_at?: string | null
        wp_post_id?: number | null; bc_post_id?: number | null
        updated_at?: string | null; last_pushed_at?: string | null
      }
      const dueRaw = ((duePosts ?? []) as unknown as DuePost[]).filter(p => {
        const live = Boolean(p.wp_post_id || p.bc_post_id)
        if (!live) return true            // never published — the normal case
        // Already live: only re-push when the DB copy is actually newer, so a
        // cron running every 2h cannot churn an unchanged article.
        if (!p.updated_at || !p.last_pushed_at) return false
        return new Date(p.updated_at).getTime() > new Date(p.last_pushed_at).getTime()
      })

      // QUALITY GATE — the whole point of this block.
      //
      // Reporting on the August 2026 spam update was blunt about the pattern:
      // sites "automatically posting" end to end were "being filtered and dropped
      // across the board", while publishers doing human checks before publishing
      // were fine. Unattended publishing is the risk being managed here, so a post
      // carrying a CRITICAL quality finding is held back for a human rather than
      // shipped by a cron at 2am. It stays 'approved' and remains fully publishable
      // by hand — nothing is rejected, only un-automated.
      // FAILS CLOSED. A post is eligible only when it carries a report that
      // explicitly passed — never merely because it has no report.
      //
      // `?.blocksAutoPush !== true` treated a MISSING report as a pass, so
      // anything generated before the gate existed, generated by a path that
      // skipped it, or whose report was cleared because its content changed,
      // was auto-published to a client's site with no checking at all. Absence
      // of evidence is not evidence of quality.
      const gateOn      = qualityGateBlocksAutopush !== false
      const passed      = (p: DuePost) => p.quality_report != null && p.quality_report.blocksAutoPush !== true
      const held        = gateOn ? dueRaw.filter(p => !passed(p)) : []
      const allDuePosts = gateOn ? dueRaw.filter(passed) : dueRaw

      if (held.length > 0) {
        console.log(`[content-topics] quality gate held ${held.length} post(s) from auto-push for client ${client_id}`)

        // Batched, not one INSERT + one UPDATE per post. quality_report only
        // exists from migration 203, so on the first run after deploy EVERY
        // approved due post lands here — 30 clients x 5 posts was 300 serial
        // round trips inside a budget already shared with AI generation.
        const alertRows: Record<string, unknown>[] = []
        const alertedIds: string[] = []

        for (const p of held) {
          // Alert ONCE per hold. A held post legitimately stays 'approved' and
          // keeps matching the selector, so without this marker the same alert
          // is re-raised every run — 12 times a day, indefinitely, per post.
          if (p.quality_hold_alerted_at) continue

          const reasons = (p.quality_report?.findings ?? [])
            .filter(f => f.severity === 'critical')
            .map(f => f.message)

          // Distinguish "checked and failed" from "never checked" — the remedy
          // differs, and telling someone a post was "flagged" when it simply has
          // no report sends them looking for findings that do not exist.
          // Every path that writes content now re-runs the gate (see
          // lib/content/recheckQuality.ts), so a missing report means the post
          // predates that or its last re-check failed. Saving it re-scores it —
          // which is only true since the re-check went on the write path; the
          // advice used to name a remedy that cleared the report again.
          const body = p.quality_report == null
            ? 'This post has no quality report, so it was not published automatically. Open it and save it to run the checks, then publish by hand.'
            : `The quality gate flagged this post, so it was not published automatically. Review and publish it by hand.\n\n${reasons.join('\n')}`

          alertRows.push({
            type:      'content',
            severity:  'warning',
            client_id,
            title:     `Held from auto-publish: ${p.title ?? 'Untitled post'}`,
            body,
            link_url:  '/admin/content',
          })
          alertedIds.push(p.id)
        }

        if (alertRows.length > 0) {
          const { error: alertErr } = await db.from('admin_alerts').insert(alertRows)
          if (alertErr) {
            // Nothing is stamped, so the next run retries the whole batch.
            console.error('[content-topics] hold alert insert failed', alertErr.message)
          } else {
            await db.from('content_posts')
              .update({ quality_hold_alerted_at: new Date().toISOString() })
              .in('id', alertedIds)
          }
        }
      }

      // Resolve client name once for notifications
      let clientNameForPush = topicAccum.get(client_id)?.clientName ?? ''
      if (!clientNameForPush) {
        const { data: cl } = await db.from('clients').select('name, discord_channel_id').eq('id', client_id).single()
        clientNameForPush = (cl as { name?: string } | null)?.name ?? client_id
      }

      const pushResults: { title: string | null; ok: boolean; error?: string }[] = []

      for (const post of allDuePosts) {
        try {
          const approveRes = await fetch(`${appUrl}/api/admin/content/posts/${post.id}/approve`, {
            method:  'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}`,
            },
            body: JSON.stringify({ auto: true }),
          })
          if (approveRes.ok) {
            await db.from('content_posts')
              .update({ auto_pushed_at: new Date().toISOString() })
              .eq('id', post.id)
            pushResults.push({ title: post.title, ok: true })
          } else {
            const errText = await approveRes.text().catch(() => '')
            await db.from('content_posts')
              .update({
                auto_pushed_at: new Date().toISOString(),
                auto_push_error: `${approveRes.status}: ${errText.slice(0, 200)}`,
              })
              .eq('id', post.id)
            pushResults.push({ title: post.title, ok: false, error: `${approveRes.status}: ${errText.slice(0, 100)}` })
            console.error(`[content-topics cron] Auto-push approve returned ${approveRes.status} for post ${post.id}:`, errText)
          }
        } catch (e) {
          console.error(`[content-topics cron] Auto-push failed for post ${post.id}:`, e)
          pushResults.push({ title: post.title, ok: false, error: String(e).slice(0, 100) })
        }
      }

      if (pushResults.length) {
        console.log(`[content-topics cron] auto-pushed ${pushResults.length} posts for ${client_id}`)
        // admin_alerts for auto-push (deferred — no await)
        const successPosts = pushResults.filter(r => r.ok)
        const failedPosts  = pushResults.filter(r => !r.ok)
        const contentUrl   = `${appUrl}/admin/content`
        if (successPosts.length) {
          db.from('admin_alerts').insert({
            type:        'content',
            severity:    'info',
            client_id:   client_id,
            client_name: clientNameForPush,
            title:       `${successPosts.length} post${successPosts.length === 1 ? '' : 's'} auto-pushed — ${clientNameForPush}`,
            body:        successPosts.map(p => `• ${p.title ?? '(untitled)'}`).join('\n'),
            meta:        { content_type: 'auto_push', count: successPosts.length },
            link_url:    contentUrl,
          }).then(null, () => {})
        }
        if (failedPosts.length) {
          db.from('admin_alerts').insert({
            type:        'content',
            severity:    'warning',
            client_id:   client_id,
            client_name: clientNameForPush,
            title:       `${failedPosts.length} auto-push failure${failedPosts.length === 1 ? '' : 's'} — ${clientNameForPush}`,
            body:        failedPosts.map(p => `• ${p.title ?? '(untitled)'}: ${p.error ?? 'unknown error'}`).join('\n'),
            meta:        { content_type: 'auto_push_error', count: failedPosts.length },
            link_url:    contentUrl,
          }).then(null, () => {})
        }
      }
    }

    // ── BC spot-check alert: draft_saved BC posts due tomorrow (one per post) ──
    {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
      const { data: bcDuePosts } = await db
        .from('content_posts')
        .select('id, title, target_publish_date, bc_store_hash')
        .eq('client_id', client_id)
        .eq('status', 'draft_saved')
        .not('bc_post_id', 'is', null)
        .eq('target_publish_date', tomorrow)

      if (bcDuePosts && bcDuePosts.length > 0) {
        const { data: cl } = await db.from('clients').select('name, discord_channel_id').eq('id', client_id).single()
        const clientNameBc = (cl as { name?: string } | null)?.name ?? client_id
        const channelIdBc  = (cl as { discord_channel_id?: string | null } | null)?.discord_channel_id
        const discordBotTk = (agencySettings?.discord_bot_token as string | null) ?? null

        // Dedup: skip posts already notified (check admin_alerts for prior bc_spot_check entry)
        const { data: existingAlerts } = await db
          .from('admin_alerts')
          .select('meta')
          .eq('client_id', client_id)
          .eq('type', 'content')
          .filter('meta->>content_type', 'eq', 'bc_spot_check')
        const notifiedPostIds = new Set(
          (existingAlerts ?? []).map((a: { meta: Record<string, unknown> }) => a.meta?.post_id as string).filter(Boolean)
        )

        for (const bp of bcDuePosts as { id: string; title: string | null; target_publish_date: string | null; bc_store_hash: string | null }[]) {
          if (notifiedPostIds.has(bp.id)) continue

          const bcBlogUrl = `https://login.bigcommerce.com/manage/content/blog`
          const alertMsg  = `⚠️ BC post due tomorrow — ${bp.title ?? '(untitled)'} for ${clientNameBc} needs manual publish: ${bcBlogUrl}`

          if (discordBotTk && opsChannelId && getNotif(notifConfig, 'content_bc_post_due').agency) {
            void sendDiscordMessage(discordBotTk, opsChannelId, alertMsg).catch(() => {})
          }

          db.from('admin_alerts').insert({
            type:        'content',
            severity:    'warning',
            client_id:   client_id,
            client_name: clientNameBc,
            title:       `BC post due tomorrow — manual publish needed (${clientNameBc})`,
            body:        `"${bp.title ?? '(untitled)'}" is a BigCommerce draft scheduled for ${bp.target_publish_date}. Go to BigCommerce → Blog to publish it manually.`,
            meta:        { content_type: 'bc_spot_check', post_id: bp.id, bc_blog_url: bcBlogUrl, target_publish_date: bp.target_publish_date },
            link_url:    bcBlogUrl,
          }).then(null, () => {})
        }
      }
    }
  }

  // ── Service Area auto-generate/approve/push loop ───────────────────────────
  {
    const { data: saSettingsRows } = await db
      .from('service_area_settings')
      .select('client_id, pages_per_run, auto_approve_pages, auto_push_pages, schedule_frequency, schedule_day_of_week, service_areas, service_pages, slug_structure, base_page_path')
      .eq('auto_generate', true)
      .not('client_id', 'is', null)

    const saGenerated:  string[] = []
    const saPushed:     string[] = []

    for (const saRow of (saSettingsRows ?? []) as {
      client_id:            string
      pages_per_run:        number | null
      auto_approve_pages:   boolean | null
      auto_push_pages:      boolean | null
      schedule_frequency:   string | null
      schedule_day_of_week: number | null
      service_areas:        { city: string; state: string; rationale?: string }[] | null
      service_pages:        { name: string; url?: string }[] | null
      slug_structure:       string | null
      base_page_path:       string | null
    }[]) {
      const {
        client_id:          saClientId,
        pages_per_run:      pagesPerRun       = 1,
        auto_approve_pages: autoApprovePages  = false,
        auto_push_pages:    autoPushPages     = false,
      } = saRow

      const saLimit = pagesPerRun ?? 1

      // ── Auto-schedule SA topics for upcoming slots (mirrors blog lead-window) ─
      {
        const saFrequency  = saRow.schedule_frequency   ?? 'monthly'
        const saDayOfWeek  = saRow.schedule_day_of_week ?? 1
        const saServiceAreas = saRow.service_areas ?? []

        if (saServiceAreas.length > 0) {
          const saCycle      = getCycleDays(saFrequency)
          const saLeadWindow = saCycle * 8 // 8-cycle look-ahead (same as wizard default)
          const saWeeksToScan = Math.ceil(saLeadWindow / 7) + 1

          const saSlots = computeFutureSlots(saFrequency, saDayOfWeek, saWeeksToScan).filter(slot => {
            const daysOut = Math.round((new Date(slot + 'T00:00:00Z').getTime() - Date.now()) / 86_400_000)
            return daysOut > 0 && daysOut <= saLeadWindow
          })

          // Fetch all non-rejected SA topics for this client (slot occupancy + dedup)
          const { data: allSaTopics } = await db
            .from('content_topics')
            .select('target_publish_date, city, state_abbr, service_name')
            .eq('client_id', saClientId)
            .eq('content_type', 'service_area')
            .not('status', 'eq', 'rejected')

          // Count existing topics per slot
          type SaTopicRow = { target_publish_date: string | null; city: string | null; state_abbr: string | null; service_name: string | null }
          const topicsPerSlot = new Map<string, number>()
          for (const t of (allSaTopics ?? []) as SaTopicRow[]) {
            if (t.target_publish_date) topicsPerSlot.set(t.target_publish_date, (topicsPerSlot.get(t.target_publish_date) ?? 0) + 1)
          }

          const saSlugStructure = saRow.slug_structure ?? 'service_slash_city_state'
          const saBasePath      = saRow.base_page_path?.trim() ?? null

          // Dedup key: omit state for service_slash_city (state not encoded in URLs for this structure)
          const saComboKey = (city: string, state: string, service: string) => {
            const stateNorm = saSlugStructure === 'service_slash_city' ? '' : state.toLowerCase()
            return `${city.toLowerCase().replace(/[^a-z0-9]/g, '')}|${stateNorm}|${service.toLowerCase().replace(/[^a-z0-9]/g, '')}`
          }

          // Build dedup set from existing topics
          const saExistingCombos = new Set<string>()
          for (const t of (allSaTopics ?? []) as SaTopicRow[]) {
            if (t.city && t.service_name) {
              saExistingCombos.add(saComboKey(t.city, t.state_abbr ?? '', t.service_name))
            }
          }

          // Also dedup against live sitemap pages
          const { data: sitemapRows } = await db
            .from('content_sitemap_pages')
            .select('url')
            .eq('client_id', saClientId)

          for (const p of (sitemapRows ?? []) as { url: string }[]) {
            try {
              const pathname = new URL(p.url).pathname.replace(/\/$/, '')
              let city = '', state = '', service = ''
              if (saBasePath) {
                const base = saBasePath.replace(/^\/|\/$/g, '')
                if (!pathname.startsWith(`/${base}/`)) continue
                const child = pathname.slice(`/${base}/`.length)
                if (!child) continue
                service = base.split('/').pop() ?? ''
                const lastHyphen = child.lastIndexOf('-')
                if (lastHyphen !== -1 && child.slice(lastHyphen + 1).length === 2) {
                  state = child.slice(lastHyphen + 1).toUpperCase()
                  city  = child.slice(0, lastHyphen)
                } else {
                  city = child
                }
              } else if (saSlugStructure === 'service_slash_city_state' || saSlugStructure === 'service_slash_city') {
                const parts = pathname.split('/').filter(Boolean)
                if (parts.length !== 2) continue
                service = parts[0]
                const lastHyphen = parts[1].lastIndexOf('-')
                if (saSlugStructure === 'service_slash_city_state' && lastHyphen !== -1 && parts[1].slice(lastHyphen + 1).length === 2) {
                  state = parts[1].slice(lastHyphen + 1).toUpperCase()
                  city  = parts[1].slice(0, lastHyphen)
                } else {
                  city = parts[1]
                }
              } else if (saSlugStructure === 'service_dash_city_state') {
                const seg = pathname.split('/').filter(Boolean)
                if (seg.length !== 1) continue
                const m = seg[0].match(/^(.+)-([a-z]{2})$/)
                if (!m) continue
                state = m[2].toUpperCase()
                const dashParts = m[1].split('-')
                service = dashParts[0]; city = dashParts.slice(1).join('-')
              }
              if (city && service) saExistingCombos.add(saComboKey(city, state, service))
            } catch { /* skip unparseable URLs */ }
          }

          // Build service list (same priority as wizard: service_pages → brand DNA)
          const saServicePageNames = (saRow.service_pages ?? []).map((p: { name: string }) => p.name)
          const { data: saContentSettings } = await db
            .from('content_settings')
            .select('services')
            .eq('client_id', saClientId)
            .maybeSingle()
          const brandDnaServices = ((saContentSettings?.services as string | null) ?? '')
            .split(',').map((s: string) => s.trim()).filter(Boolean)

          const serviceSet = new Map<string, string>()
          const addSvc = (s: string) => { const k = s.toLowerCase(); if (!serviceSet.has(k)) serviceSet.set(k, s) }
          saServicePageNames.forEach(addSvc)
          brandDnaServices.forEach(addSvc)
          const saServices = Array.from(serviceSet.values())

          if (saServices.length > 0) {
            const saToInsert: {
              client_id: string; content_type: string
              city: string; state_abbr: string; service_name: string
              topic: string; rationale: string | null; status: string; target_publish_date: string
            }[] = []
            // Cartesian-product traversal: outer = areas, inner = services.
            // Indices persist across slots so we distribute evenly without diagonal-skip bias.
            let areaIdx = 0, serviceIdx = 0
            const numAreas    = saServiceAreas.length
            const numServices = saServices.length

            for (const slot of saSlots) {
              const filled = topicsPerSlot.get(slot) ?? 0
              const needed = Math.max(0, saLimit - filled)
              for (let p = 0; p < needed; p++) {
                let placed = false
                outer: for (let ai = 0; ai < numAreas; ai++) {
                  for (let si = 0; si < numServices; si++) {
                    const area    = saServiceAreas[(areaIdx + ai) % numAreas]
                    const service = saServices[(serviceIdx + si) % numServices]
                    const key = saComboKey(area.city, area.state, service)
                    if (saExistingCombos.has(key)) continue
                    saExistingCombos.add(key)
                    saToInsert.push({
                      client_id:           saClientId,
                      content_type:        'service_area',
                      city:                area.city,
                      state_abbr:          area.state,
                      service_name:        service,
                      topic:               `${service} in ${area.city}, ${area.state}`,
                      rationale:           area.rationale ?? null,
                      status:              'pending',
                      target_publish_date: slot,
                    })
                    // Advance indices past what we just used
                    areaIdx    = (areaIdx + ai + 1) % numAreas
                    serviceIdx = (serviceIdx + si + 1) % numServices
                    placed = true
                    break outer
                  }
                }
                if (!placed) break // all combos exhausted for this client
              }
            }

            if (saToInsert.length > 0) {
              await db.from('content_topics').insert(saToInsert)
              console.log(`[content-topics cron] SA auto-scheduled ${saToInsert.length} topics for ${saClientId}`)
            }
          }
        }
      }

      // Resolve client name for notifications
      const { data: saClient } = await db
        .from('clients')
        .select('name, discord_channel_id')
        .eq('id', saClientId)
        .single()
      const saClientName = (saClient as { name?: string } | null)?.name ?? saClientId
      const saChannelId  = (saClient as { discord_channel_id?: string | null } | null)?.discord_channel_id

      // ── Auto-approve SA topics ────────────────────────────────────────────
      if (autoApprovePages) {
        const approveThreshold = new Date()
        approveThreshold.setUTCDate(approveThreshold.getUTCDate() + 9)

        // Fetch all eligible pending SA topics (dated)
        const { data: pendingSaTopics } = await db
          .from('content_topics')
          .select('id, target_publish_date, search_volume, keyword_difficulty, city, state_abbr, service_name')
          .eq('client_id', saClientId)
          .eq('content_type', 'service_area')
          .eq('status', 'pending')
          .lte('target_publish_date', approveThreshold.toISOString().slice(0, 10))
          .not('target_publish_date', 'is', null)

        // Group by date, pick best saLimit per group — with city+service dedup so only one
        // topic per combo is approved even if multiple duplicates exist for the same date.
        type PendingSaTopic = { id: string; target_publish_date: string | null; search_volume: number | null; keyword_difficulty: number | null; city: string | null; state_abbr: string | null; service_name: string | null }
        const saGrouped = new Map<string, PendingSaTopic[]>()
        for (const t of (pendingSaTopics ?? []) as PendingSaTopic[]) {
          const key = t.target_publish_date ?? 'none'
          saGrouped.set(key, [...(saGrouped.get(key) ?? []), t])
        }
        const saToApprove: string[] = []
        const seenSaCombos = new Set<string>()
        for (const [, group] of Array.from(saGrouped)) {
          const picked = (group as PendingSaTopic[])
            .sort((a: PendingSaTopic, b: PendingSaTopic) => (b.search_volume ?? 0) - (a.search_volume ?? 0)
              || (a.keyword_difficulty ?? 99) - (b.keyword_difficulty ?? 99))
            .slice(0, saLimit)
          for (const t of picked) {
            const combo = `${t.city ?? ''}|${t.state_abbr ?? ''}|${t.service_name ?? ''}`
            if (seenSaCombos.has(combo)) continue
            seenSaCombos.add(combo)
            saToApprove.push(t.id)
          }
        }

        // Also approve dateless SA topics pending >3 days, capped at saLimit
        const staleCutoff = new Date(Date.now() - 3 * 86_400_000).toISOString()
        const { data: datelessSaRaw } = await db
          .from('content_topics')
          .select('id, search_volume, keyword_difficulty')
          .eq('client_id', saClientId)
          .eq('content_type', 'service_area')
          .eq('status', 'pending')
          .is('target_publish_date', null)
          .lte('created_at', staleCutoff)
        const datelessSaPicked = ((datelessSaRaw ?? []) as PendingSaTopic[])
          .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0)
            || (a.keyword_difficulty ?? 99) - (b.keyword_difficulty ?? 99))
          .slice(0, saLimit)
        saToApprove.push(...datelessSaPicked.map(t => t.id))

        if (saToApprove.length) {
          await db.from('content_topics')
            .update({ status: 'approved', auto_approved_at: new Date().toISOString() })
            .in('id', saToApprove)
          console.log(`[content-topics cron] SA auto-approved ${saToApprove.length} topics for ${saClientId}`)

          // admin_alert for approvals
          db.from('admin_alerts').insert({
            type:        'content',
            severity:    'info',
            client_id:   saClientId,
            client_name: saClientName,
            title:       `${saToApprove.length} service area topic${saToApprove.length === 1 ? '' : 's'} auto-approved — ${saClientName}`,
            body:        `${saToApprove.length} service area page topic${saToApprove.length === 1 ? '' : 's'} auto-approved for content generation.`,
            meta:        { content_type: 'sa_auto_approve', count: saToApprove.length },
            link_url:    `${appUrl}/admin/content`,
          }).then(null, () => {})
        }
      }

      // ── Generate SA pages for approved topics ─────────────────────────────
      const { data: approvedSaTopics } = await db
        .from('content_topics')
        .select('id, city, state_abbr, service_name')
        .eq('client_id', saClientId)
        .eq('content_type', 'service_area')
        .eq('status', 'approved')

      await Promise.allSettled((approvedSaTopics ?? []).slice(0, saLimit).map(async (topic) => {
        const t = topic as { id: string; city: string | null; state_abbr: string | null; service_name: string | null }
        try {
          const res = await fetch(`${appUrl}/api/admin/content/service-area/generate`, {
            method:  'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}`,
            },
            body: JSON.stringify({ topic_id: t.id }),
          })
          if (!res.ok) throw new Error(await res.text())
          saGenerated.push(t.id)
        } catch (e) {
          console.error(`[content-topics cron] SA generation failed for topic ${t.id}:`, e)
          await db.from('content_topics')
            .update({ status: 'approved', generation_error: String(e) })
            .eq('id', t.id)
        }
      }))

      // ── Auto-push: generated SA pages not yet uploaded ─────────────────────
      if (autoPushPages) {
        const pushThreshold = new Date()
        pushThreshold.setUTCDate(pushThreshold.getUTCDate() + 2)

        const { data: dueSaPosts } = await db
          .from('content_posts')
          .select('id, title')
          .eq('client_id', saClientId)
          .eq('content_type', 'service_area')
          .eq('status', 'approved')
          .lte('target_publish_date', pushThreshold.toISOString().slice(0, 10))
          .not('target_publish_date', 'is', null)
          .is('wp_post_id', null)
          .is('bc_post_id', null)

        const allDueSaPosts = (dueSaPosts ?? [])
          .slice(0, saLimit) as { id: string; title: string | null }[]

        const saPushResults: { title: string | null; ok: boolean; error?: string }[] = []

        for (const post of allDueSaPosts) {
          try {
            const approveRes = await fetch(`${appUrl}/api/admin/content/posts/${post.id}/approve`, {
              method:  'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}`,
              },
              body: JSON.stringify({ auto: true }),
            })
            if (approveRes.ok) {
              await db.from('content_posts')
                .update({ auto_pushed_at: new Date().toISOString() })
                .eq('id', post.id)
              saPushResults.push({ title: post.title, ok: true })
              saPushed.push(post.id)
            } else {
              const errText = await approveRes.text().catch(() => '')
              await db.from('content_posts')
                .update({
                  auto_pushed_at: new Date().toISOString(),
                  auto_push_error: `${approveRes.status}: ${errText.slice(0, 200)}`,
                })
                .eq('id', post.id)
              saPushResults.push({ title: post.title, ok: false, error: `${approveRes.status}: ${errText.slice(0, 100)}` })
            }
          } catch (e) {
            console.error(`[content-topics cron] SA auto-push failed for post ${post.id}:`, e)
            saPushResults.push({ title: post.title, ok: false, error: String(e).slice(0, 100) })
          }
        }

        if (saPushResults.length) {
          const contentUrl = `${appUrl}/admin/content`
          const successSaPosts = saPushResults.filter(r => r.ok)
          const failedSaPosts  = saPushResults.filter(r => !r.ok)

          const saDiscordToken = (agencySettings?.discord_bot_token as string | null) ?? null

          if (successSaPosts.length) {
            db.from('admin_alerts').insert({
              type:        'content',
              severity:    'info',
              client_id:   saClientId,
              client_name: saClientName,
              title:       `${successSaPosts.length} service area page${successSaPosts.length === 1 ? '' : 's'} auto-pushed — ${saClientName}`,
              body:        successSaPosts.map(p => `• ${p.title ?? '(untitled)'}`).join('\n'),
              meta:        { content_type: 'sa_auto_push', count: successSaPosts.length },
              link_url:    contentUrl,
            }).then(null, () => {})

            if (saDiscordToken && opsChannelId && getNotif(notifConfig, 'content_sa_auto_pushed').agency) {
              void sendDiscordMessage(
                saDiscordToken, opsChannelId,
                `📍 **${successSaPosts.length} service area page${successSaPosts.length === 1 ? '' : 's'} auto-pushed** for **${saClientName}** — review in draft: ${contentUrl}`
              ).catch(() => {})
            }
          }

          if (failedSaPosts.length) {
            db.from('admin_alerts').insert({
              type:        'content',
              severity:    'warning',
              client_id:   saClientId,
              client_name: saClientName,
              title:       `${failedSaPosts.length} SA auto-push failure${failedSaPosts.length === 1 ? '' : 's'} — ${saClientName}`,
              body:        failedSaPosts.map(p => `• ${p.title ?? '(untitled)'}: ${p.error ?? 'unknown error'}`).join('\n'),
              meta:        { content_type: 'sa_auto_push_error', count: failedSaPosts.length },
              link_url:    contentUrl,
            }).then(null, () => {})
          }
        }

        // BC spot-check alert for SA pages due tomorrow (one per post)
        {
          const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
          const { data: bcDueSaPosts } = await db
            .from('content_posts')
            .select('id, title, target_publish_date')
            .eq('client_id', saClientId)
            .eq('content_type', 'service_area')
            .eq('status', 'draft_saved')
            .not('bc_post_id', 'is', null)
            .eq('target_publish_date', tomorrow)

          const saDiscordTokenSpot = (agencySettings?.discord_bot_token as string | null) ?? null

          // Dedup: skip posts already notified
          const { data: saExistingAlerts } = await db
            .from('admin_alerts')
            .select('meta')
            .eq('client_id', saClientId)
            .eq('type', 'content')
            .filter('meta->>content_type', 'eq', 'bc_sa_spot_check')
          const saNotifiedPostIds = new Set(
            (saExistingAlerts ?? []).map((a: { meta: Record<string, unknown> }) => a.meta?.post_id as string).filter(Boolean)
          )

          for (const bp of (bcDueSaPosts ?? []) as { id: string; title: string | null; target_publish_date: string | null }[]) {
            if (saNotifiedPostIds.has(bp.id)) continue

            const bcPagesUrl = `https://login.bigcommerce.com/manage/content/pages`
            const alertMsg   = `⚠️ BC service area page due tomorrow — ${bp.title ?? '(untitled)'} for ${saClientName} needs manual publish: ${bcPagesUrl}`

            if (saDiscordTokenSpot && opsChannelId && getNotif(notifConfig, 'content_bc_sa_due').agency) {
              void sendDiscordMessage(saDiscordTokenSpot, opsChannelId, alertMsg).catch(() => {})
            }
            db.from('admin_alerts').insert({
              type:        'content',
              severity:    'warning',
              client_id:   saClientId,
              client_name: saClientName,
              title:       `BC service area page due tomorrow — manual publish needed (${saClientName})`,
              body:        `"${bp.title ?? '(untitled)'}" is a BigCommerce draft page scheduled for ${bp.target_publish_date}. Go to BigCommerce → Pages to publish it manually.`,
              meta:        { content_type: 'bc_sa_spot_check', post_id: bp.id, bc_pages_url: bcPagesUrl, target_publish_date: bp.target_publish_date },
              link_url:    bcPagesUrl,
            }).then(null, () => {})
          }
        }
      }

      console.log(`[content-topics cron] SA client ${saClientId}: ${saGenerated.length} generated, ${saPushed.length} pushed`)
    }
  }

  // ── Phase 2: run all collected blog post generation jobs concurrently ─────────
  // All per-client loops are done. Firing here means up to GLOBAL_POST_CAP AI calls
  // run in parallel across all clients. Wall clock ≈ slowest single call (~90s),
  // regardless of how many clients there are — scales to 10+ clients within 300s.
  {
    const GLOBAL_POST_CAP = 15
    type PostResult = { clientId: string; clientName: string; title: string; targetKeyword: string | null; targetPublishDate: string | null } | null

    const results = await Promise.allSettled(
      pendingBlogJobs.slice(0, GLOBAL_POST_CAP).map(async (job): Promise<PostResult> => {
        try {
          await db.from('content_topics').update({ status: 'generating' }).eq('id', job.topicId)
          const isSA = job.contentType === 'service_area'
          const generateUrl = isSA
            ? `${appUrl}/api/admin/content/service-area/generate`
            : `${appUrl}/api/admin/content/generate`
          const generateBody = isSA
            ? JSON.stringify({ topic_id: job.topicId })
            : JSON.stringify({ topic_id: job.topicId, suppress_email: true })
          const generateHeaders = {
            'Content-Type': 'application/json',
            'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}`,
          }

          let res = await fetch(generateUrl, { method: 'POST', headers: generateHeaders, body: generateBody })

          // Retry once on transient 5xx — connection pool exhaustion during long cron runs
          if (!res.ok && res.status >= 500) {
            console.warn(`[content-topics cron] Generate ${job.topicId} returned ${res.status} — retrying once`)
            await new Promise(r => setTimeout(r, 2000))
            res = await fetch(generateUrl, { method: 'POST', headers: generateHeaders, body: generateBody })
          }

          if (!res.ok) throw new Error(await res.text())
          const data = await res.json() as { title?: string; focusKeyword?: string }
          postsTriggered.push(job.topicId)
          return {
            clientId:          job.clientId,
            clientName:        job.clientName,
            title:             data.title ?? job.topic,
            targetKeyword:     data.focusKeyword ?? job.targetKeyword,
            targetPublishDate: job.targetPublishDate,
          }
        } catch (e) {
          console.error(`[content-topics cron] Post generation failed for topic ${job.topicId}:`, e)
          await db.from('content_topics')
            .update({ status: 'approved', generation_error: String(e) })
            .eq('id', job.topicId)
          return null
        }
      })
    )

    // Update postAccum sequentially after all promises settle to avoid the race where
    // two callbacks for the same clientId both read an empty entry and overwrite each other.
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        const { clientId, clientName, title, targetKeyword, targetPublishDate } = r.value
        const entry = postAccum.get(clientId) ?? { clientName, items: [] }
        entry.items.push({ title, targetKeyword, targetPublishDate })
        postAccum.set(clientId, entry)
      }
    }
  }

  // ── Batch emails — consolidated or per-client based on agency setting ────────
  if (notifEmail) {
    // Gated by the Notifications panel (notification_config) — NOT legacy notify_* columns.
    const emailTopics = getNotif(notifConfig, 'content_topics_generated').email
    const emailPosts  = getNotif(notifConfig, 'content_post_generated').email

    // At most ONE content digest email per day, no matter how many times the cron runs —
    // mirrors the monthly-once admin_alerts dedup used for the Discord message below.
    const dayStartIso = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString() })()
    const { data: digestSentToday } = await db.from('admin_alerts')
      .select('id').eq('type', 'content')
      .filter('meta->>content_type', 'eq', 'content_email_digest')
      .gte('created_at', dayStartIso).limit(1)
    const recordDigestSent = () => db.from('admin_alerts').insert({
      type: 'content', severity: 'info', title: 'Content digest email sent',
      meta: { content_type: 'content_email_digest', day: dayStartIso },
    }).then(null, () => {})

    if (digestSentToday && digestSentToday.length > 0) {
      // Already emailed today — skip (in-app admin_alerts below still log everything).
    } else if (consolidatedEmail) {
      // ONE comprehensive daily digest — query EVERYTHING still awaiting review that was
      // generated TODAY (not just this cron run), grouped by client, so the single daily
      // email covers the whole day no matter how many runs produced content.
      type PostRowT  = { client_id: string; title: string | null; target_publish_date: string | null }
      type TopicRowT = { client_id: string; topic: string; target_keyword: string | null; target_publish_date: string | null }
      const [postRowsRes, topicRowsRes] = await Promise.all([
        emailPosts
          ? db.from('content_posts').select('client_id, title, target_publish_date').eq('status', 'for_review').is('wp_post_id', null).is('bc_post_id', null).gte('created_at', dayStartIso)
          : Promise.resolve({ data: [] as PostRowT[] }),
        emailTopics
          ? db.from('content_topics').select('client_id, topic, target_keyword, target_publish_date').in('status', ['pending', 'approved']).gte('created_at', dayStartIso)
          : Promise.resolve({ data: [] as TopicRowT[] }),
      ])
      const dayPosts  = (postRowsRes.data  ?? []) as PostRowT[]
      const dayTopics = (topicRowsRes.data ?? []) as TopicRowT[]

      if (dayPosts.length > 0 || dayTopics.length > 0) {
        const clientIds = Array.from(new Set([...dayPosts.map(p => p.client_id), ...dayTopics.map(t => t.client_id)]))
        const { data: clientRows } = await db.from('clients').select('id, name').in('id', clientIds)
        const nameOf = new Map(((clientRows ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
        const groupByClient = <T extends { client_id: string }>(rows: T[]) => {
          const m = new Map<string, T[]>()
          for (const r of rows) m.set(r.client_id, [...(m.get(r.client_id) ?? []), r])
          return m
        }
        const reviewLink = `${appUrl}/admin/content`
        const sections: string[] = []

        if (dayTopics.length > 0) {
          sections.push(`<h2 style="margin:0 0 8px;font-size:16px">New Topics (${dayTopics.length})</h2>`)
          for (const [cid, items] of Array.from(groupByClient(dayTopics).entries())) {
            sections.push(`<p style="margin:4px 0"><strong>${nameOf.get(cid) ?? 'Client'}</strong> — ${items.length} topic${items.length === 1 ? '' : 's'}</p>`)
            sections.push(`<ul style="margin:0 0 12px;padding-left:20px">${items.map(t => `<li>${t.target_keyword ?? t.topic}${t.target_publish_date ? ` <em>(${t.target_publish_date})</em>` : ''}</li>`).join('')}</ul>`)
          }
        }
        if (dayPosts.length > 0) {
          sections.push(`<h2 style="margin:16px 0 8px;font-size:16px">Posts Generated (${dayPosts.length})</h2>`)
          for (const [cid, items] of Array.from(groupByClient(dayPosts).entries())) {
            sections.push(`<p style="margin:4px 0"><strong>${nameOf.get(cid) ?? 'Client'}</strong> — ${items.length} post${items.length === 1 ? '' : 's'}</p>`)
            sections.push(`<ul style="margin:0 0 12px;padding-left:20px">${items.map(p => `<li>${p.title ?? '(untitled)'}${p.target_publish_date ? ` <em>(${p.target_publish_date})</em>` : ''}</li>`).join('')}</ul>`)
          }
        }

        const parts: string[] = []
        if (dayTopics.length > 0) parts.push(`${dayTopics.length} topic${dayTopics.length === 1 ? '' : 's'}`)
        if (dayPosts.length > 0)  parts.push(`${dayPosts.length} post${dayPosts.length === 1 ? '' : 's'}`)
        const subjectSummary = parts.join(' + ')

        try {
          await sendEmail({
            to:      notifEmail,
            subject: `${agencyName} | Content Update — ${subjectSummary} across ${clientIds.length} client${clientIds.length === 1 ? '' : 's'}`,
            html:    `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">${sections.join('\n')}<p style="margin-top:16px"><a href="${reviewLink}">Review in dashboard →</a></p></div>`,
          })
          await recordDigestSent()  // only mark the day done once the email actually sent
        } catch (e) {
          console.error('[content-topics cron] Consolidated email failed:', e)
        }
      }
    } else {
      // Per-client emails
      if (emailTopics) {
        for (const [clientId, { clientName, items }] of Array.from(topicAccum.entries())) {
          const clientLink = `${appUrl}/admin/clients/${clientId}?tab=content&subtab=schedule`
          try {
            await sendEmail({
              to:      notifEmail,
              subject: `${agencyName} | ${clientName} — Topics Ready for Review`,
              html:    buildTopicsEmail({ agencyName, clientName, topics: items, clientLink }),
            })
          } catch (e) {
            console.error(`[content-topics cron] Topics email failed for client ${clientId}:`, e)
          }
        }
      }
      if (emailPosts) {
        for (const [clientId, { clientName, items }] of Array.from(postAccum.entries())) {
          const clientLink = `${appUrl}/admin/clients/${clientId}?tab=content&subtab=schedule`
          try {
            await sendEmail({
              to:      notifEmail,
              subject: `${agencyName} | ${clientName} — Posts Ready for Review`,
              html:    buildPostsEmail({ agencyName, clientName, posts: items, clientLink }),
            })
          } catch (e) {
            console.error(`[content-topics cron] Posts email failed for client ${clientId}:`, e)
          }
        }
      }
      if ((emailTopics && topicAccum.size > 0) || (emailPosts && postAccum.size > 0)) await recordDigestSent()
    }
  }

  // ── Discord notifications — ONE consolidated ops-channel message ─────────────
  const discordBotToken = (agencySettings?.discord_bot_token as string | null) ?? null
  const contentUrl      = `${appUrl}/admin/content`
  const nowTs           = new Date()

  if (discordBotToken && opsChannelId) {
    // Monthly-once message when posts are generated — fires the first time any month, never again that month
    const totalPostsReady = Array.from(postAccum.values()).reduce((s, { items }) => s + items.length, 0)
    if (totalPostsReady > 0) {
      const monthStart = new Date(Date.UTC(nowTs.getUTCFullYear(), nowTs.getUTCMonth(), 1)).toISOString()
      const { data: existingMonthlyAlert } = await db.from('admin_alerts')
        .select('id').eq('type', 'content')
        .filter('meta->>content_type', 'eq', 'monthly_review_ready')
        .gte('created_at', monthStart)
        .limit(1)

      if (!existingMonthlyAlert || existingMonthlyAlert.length === 0) {
        // Query all current-month posts so the message is comprehensive even if
        // posts were generated across multiple cron runs this month (postAccum only covers THIS run)
        const { data: monthPosts } = await db
          .from('content_posts')
          .select('client_id, target_publish_date')
          .in('status', ['for_review', 'pending'])
          .gte('created_at', monthStart)
          .is('wp_post_id', null).is('bc_post_id', null)

        const clientCountMap = new Map<string, number>()
        for (const p of (monthPosts ?? [])) {
          clientCountMap.set(p.client_id, (clientCountMap.get(p.client_id) ?? 0) + 1)
        }
        // Fall back to current-run accumulator if DB returned nothing
        if (clientCountMap.size === 0) {
          Array.from(postAccum.entries()).forEach(([cid, { items }]) => clientCountMap.set(cid, items.length))
        }

        const totalCount  = Array.from(clientCountMap.values()).reduce((s, n) => s + n, 0)
        const clientCount = clientCountMap.size
        // Distinct calendar weeks covered by the batch (ISO Monday-aligned)
        const isoWeekKey = (dateStr: string): string => {
          const d = new Date(dateStr + 'T00:00:00Z')
          const day = d.getUTCDay()
          d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day))
          return d.toISOString().slice(0, 10)
        }
        const weekNums = new Set(
          (monthPosts ?? [])
            .filter((p): p is typeof p & { target_publish_date: string } => !!p.target_publish_date)
            .map(p => isoWeekKey(p.target_publish_date))
        )
        const weekCount = weekNums.size || Math.ceil(totalCount / Math.max(clientCount, 1))

        // Insert dedup row first — if Discord fires but insert fails, we'd re-notify all month.
        const { error: insertErr } = await db.from('admin_alerts').insert({
          type: 'content', severity: 'info',
          title: `Monthly review ready — ${totalCount} post(s) across ${clientCount} client(s)`,
          body: `${totalCount} posts · ${clientCount} clients · ${weekCount} weeks`,
          meta: { content_type: 'monthly_review_ready', month: monthStart },
          link_url: contentUrl,
        })
        if (!insertErr && getNotif(notifConfig, 'content_monthly_review').agency) {
          void sendDiscordMessage(
            discordBotToken, opsChannelId,
            `✍️ **Monthly review ready** — ${totalCount} post${totalCount === 1 ? '' : 's'} · ${clientCount} client${clientCount === 1 ? '' : 's'} · ${weekCount} week${weekCount === 1 ? '' : 's'}\nReview: ${contentUrl}`
          ).catch(() => {})
        }
      }
    }
  }

  // In-app admin_alerts (topics)
  for (const [clientId, { clientName, items }] of Array.from(topicAccum.entries())) {
    db.from('admin_alerts').insert({
      type:        'content',
      severity:    'info',
      client_id:   clientId,
      client_name: clientName,
      title:       `${items.length} topic${items.length === 1 ? '' : 's'} ready for review — ${clientName}`,
      body:        items.map((t: TopicSummary) => `• ${t.target_keyword ?? t.topic}${t.target_publish_date ? ` (${t.target_publish_date})` : ''}`).join('\n'),
      meta:        { content_type: 'topics', count: items.length, items: items.map((t: TopicSummary) => ({ keyword: t.target_keyword ?? t.topic, publish_date: t.target_publish_date })) },
      link_url:    contentUrl,
    }).then(null, () => {})
  }
  // In-app admin_alerts (posts)
  for (const [clientId, { clientName, items }] of Array.from(postAccum.entries())) {
    db.from('admin_alerts').insert({
      type:        'content',
      severity:    'info',
      client_id:   clientId,
      client_name: clientName,
      title:       `${items.length} post${items.length === 1 ? '' : 's'} ready for review — ${clientName}`,
      body:        items.map((p: PostSummary) => `• ${p.title ?? '(untitled)'}${p.targetPublishDate ? ` (${p.targetPublishDate})` : ''}`).join('\n'),
      meta:        { content_type: 'posts', count: items.length, items: items.map((p: PostSummary) => ({ title: p.title, keyword: p.targetKeyword, publish_date: p.targetPublishDate })) },
      link_url:    contentUrl,
    }).then(null, () => {})
  }

  // ── Mid-month pending check — ONE Discord message per calendar month after the 10th ──
  // Only fires if at least 7 days have passed since the monthly_review_ready alert so we
  // don't double-notify on the same run that just generated posts.
  if (discordBotToken && opsChannelId && nowTs.getUTCDate() >= 10) {
    const contentReviewUrl = contentUrl
    type PostRow = { id: string; client_id: string }

    const monthStart     = new Date(Date.UTC(nowTs.getUTCFullYear(), nowTs.getUTCMonth(), 1)).toISOString()
    const sevenDaysAgo   = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const monthStartDate = monthStart.slice(0, 10)

    // Skip mid-check if review-ready was sent within the last 7 days — posts were just generated
    const { data: recentReviewReady } = await db.from('admin_alerts')
      .select('id').eq('type', 'content')
      .filter('meta->>content_type', 'eq', 'monthly_review_ready')
      .gte('created_at', sevenDaysAgo)
      .limit(1)

    if (!recentReviewReady || recentReviewReady.length === 0) {
      const { data: pendingPosts } = await db
        .from('content_posts')
        .select('id, client_id')
        .in('status', ['for_review', 'pending'])
        .not('target_publish_date', 'is', null)
        .gte('target_publish_date', monthStartDate)
        .is('wp_post_id', null).is('bc_post_id', null)

      if (pendingPosts && pendingPosts.length > 0) {
        const { data: existingMidCheck } = await db.from('admin_alerts')
          .select('id').eq('type', 'content')
          .filter('meta->>content_type', 'eq', 'monthly_mid_check')
          .gte('created_at', monthStart)
          .limit(1)

        if (!existingMidCheck || existingMidCheck.length === 0) {
          const pendingCount  = pendingPosts.length
          const pendingClients = new Set((pendingPosts as PostRow[]).map(p => p.client_id)).size
          // Insert dedup row first so a Discord failure doesn't re-alert next run
          const { error: midInsertErr } = await db.from('admin_alerts').insert({
            type: 'content', severity: 'warning',
            title: `${pendingCount} post(s) still awaiting approval`,
            body: `${pendingCount} posts across ${pendingClients} clients`,
            meta: { content_type: 'monthly_mid_check', count: pendingCount, month: monthStart },
            link_url: contentReviewUrl,
          })
          if (!midInsertErr && getNotif(notifConfig, 'content_mid_month_check').agency) {
            void sendDiscordMessage(discordBotToken, opsChannelId,
              `📋 **${pendingCount} post${pendingCount === 1 ? '' : 's'} still awaiting approval** — ${pendingClients} client${pendingClients === 1 ? '' : 's'} need review\nReview: ${contentReviewUrl}`
            ).catch(() => {})
          }
        }
      }
    }
  }

  console.log(`[content-topics cron] slots covered: ${topicsGenerated.length}, ${briefsGenerated.length} briefs, ${postsTriggered.length} posts triggered`)

  return NextResponse.json({
    ok:              true,
    topicsGenerated: topicsGenerated.length,
    briefsGenerated: briefsGenerated.length,
    postsTriggered:  postsTriggered.length,
  })
}
