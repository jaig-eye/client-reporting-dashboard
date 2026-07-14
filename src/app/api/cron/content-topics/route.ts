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
    .select('notification_email, agency_name, notify_topics_created, notify_topic_ready, notify_post_generated, discord_bot_token, discord_ops_channel_id, consolidated_email_notifications')
    .single()

  const notifEmail          = (agencySettings?.notification_email          as string | null)  ?? null
  const agencyName          = (agencySettings?.agency_name                 as string | null)  ?? 'Agency Dashboard'
  const consolidatedEmail   = (agencySettings?.consolidated_email_notifications as boolean | null) ?? true
  const appUrl              = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

  // Ops channel: DB value preferred; env var as fallback for zero-downtime deploys
  const opsChannelId = ((agencySettings?.discord_ops_channel_id as string | null) ?? process.env.DISCORD_OPS_CHANNEL_ID) ?? null

  // Load all clients with auto_generate enabled
  const { data: settingsRows } = await db
    .from('content_settings')
    .select('client_id, schedule_frequency, schedule_day_of_week, topics_per_run, posts_per_run, weeks_ahead, auto_approve_topics, auto_push_posts, generate_service_pages, generate_regular_pages')
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
    .update({ status: 'scheduled', generation_error: 'Timed out — reset by cron' })
    .eq('status', 'generating')
    .lt('updated_at', new Date(Date.now() - 3_600_000).toISOString())

  // Per-client email accumulators
  const topicAccum = new Map<string, { clientName: string; items: TopicSummary[] }>()
  const postAccum  = new Map<string, { clientName: string; items: PostSummary[] }>()

  const topicsGenerated: string[] = []
  const briefsGenerated: string[] = []
  const postsTriggered:  string[] = []

  for (const row of settingsRows) {
    const {
      client_id,
      schedule_frequency,
      schedule_day_of_week,
      topics_per_run        = 1,
      posts_per_run         = 2,
      weeks_ahead           = 1,
      auto_approve_topics   = false,
      auto_push_posts       = false,
      generate_service_pages = false,
      generate_regular_pages = false,
    } = row as {
      client_id:              string
      schedule_frequency:     string | null
      schedule_day_of_week:   number | null
      topics_per_run:         number
      posts_per_run:          number
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
      const activeContentTypes: string[] = ['blog']
      if (generate_service_pages) activeContentTypes.push('service_page')
      if (generate_regular_pages) activeContentTypes.push('regular_page')

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
        const result = await generateTopicsForClient(db, client_id, topics_per_run, slot, { suppressEmail: true, siloId: autoSiloId })
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

      // Group by date, pick best posts_per_run per group
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
          .slice(0, posts_per_run)
        toApprove.push(...picked.map((t: PendingTopic) => t.id))
      }

      if (toApprove.length) {
        await db.from('content_topics')
          .update({ status: 'approved', auto_approved_at: new Date().toISOString() })
          .in('id', toApprove)
        console.log(`[content-topics cron] auto-approved ${toApprove.length} topics (${grouped.size} date groups) for ${client_id}`)
      }

      // Also approve dateless topics pending >3 days, capped at posts_per_run
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
        .slice(0, posts_per_run)
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
      } catch (e) {
        console.error(`[content-topics cron] Brief generation failed for topic ${topic.id}:`, e)
      }
    }))

    // ── Post generation: fire for approved/scheduled topics up to posts_per_run ─
    const { data: approvedTopics } = await db
      .from('content_topics')
      .select('id, topic, target_keyword, target_publish_date, content_type')
      .eq('client_id', client_id)
      .in('status', ['scheduled', 'approved'])

    // Resolve client name once for the post accumulator
    let clientNameForPost = topicAccum.get(client_id)?.clientName ?? ''
    if (!clientNameForPost) {
      const { data: cl } = await db.from('clients').select('name').eq('id', client_id).single()
      clientNameForPost = (cl as { name?: string } | null)?.name ?? client_id
    }

    const topicsToGenerate = (approvedTopics ?? []).slice(0, posts_per_run)
    await Promise.allSettled(topicsToGenerate.map(async (topic) => {
      const t = topic as { id: string; topic: string; target_keyword: string | null; target_publish_date: string | null; content_type: string | null }
      try {
        await db.from('content_topics').update({ status: 'generating' }).eq('id', t.id)
        // Route service-area topics to the SA generate endpoint; blog topics to the blog endpoint
        const isSA = t.content_type === 'service_area'
        const res = await fetch(
          isSA
            ? `${appUrl}/api/admin/content/service-area/generate`
            : `${appUrl}/api/admin/content/generate`,
          {
            method:  'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `admin_session=${process.env.ADMIN_PASSWORD}`,
            },
            body: isSA
              ? JSON.stringify({ topic_id: t.id })
              : JSON.stringify({ topic_id: t.id, suppress_email: true }),
          },
        )
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json() as { title?: string; focusKeyword?: string }
        postsTriggered.push(t.id)

        // Accumulate for batch email
        const entry = postAccum.get(client_id) ?? { clientName: clientNameForPost, items: [] }
        entry.items.push({
          title:             data.title ?? t.topic,
          targetKeyword:     data.focusKeyword ?? t.target_keyword,
          targetPublishDate: t.target_publish_date,
        })
        postAccum.set(client_id, entry)
      } catch (e) {
        console.error(`[content-topics cron] Post generation failed for topic ${t.id}:`, e)
        await db.from('content_topics')
          .update({ status: 'scheduled', generation_error: String(e) })
          .eq('id', t.id)
      }
    }))

    // ── Auto-push: admin-approved posts with publish date approaching ─────────
    // Requires explicit admin approval (status = 'approved') — prevents unreviewed posts
    // from auto-publishing. Dateless posts are excluded: they can't be reviewed in the
    // list view and must be manually pushed.
    if (auto_push_posts) {
      const pushThreshold = new Date()
      pushThreshold.setUTCDate(pushThreshold.getUTCDate() + 2)
      const { data: duePosts } = await db
        .from('content_posts')
        .select('id, title')
        .eq('client_id', client_id)
        .eq('status', 'approved')
        .lte('target_publish_date', pushThreshold.toISOString().slice(0, 10))
        .not('target_publish_date', 'is', null)
        .is('wp_post_id', null)
        .is('bc_post_id', null)

      const allDuePosts = (duePosts ?? []) as { id: string; title: string | null }[]

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

          if (discordBotTk && opsChannelId) {
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
      .select('client_id, pages_per_run, auto_approve_pages, auto_push_pages, schedule_frequency, schedule_day_of_week')
      .eq('auto_generate', true)
      .not('client_id', 'is', null)

    const saGenerated:  string[] = []
    const saPushed:     string[] = []

    for (const saRow of (saSettingsRows ?? []) as {
      client_id:           string
      pages_per_run:       number | null
      auto_approve_pages:  boolean | null
      auto_push_pages:     boolean | null
      schedule_frequency:  string | null
      schedule_day_of_week: number | null
    }[]) {
      const {
        client_id:          saClientId,
        pages_per_run:      pagesPerRun       = 1,
        auto_approve_pages: autoApprovePages  = false,
        auto_push_pages:    autoPushPages     = false,
      } = saRow

      const saLimit = pagesPerRun ?? 1

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

      await Promise.allSettled((approvedSaTopics ?? []).map(async (topic) => {
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

            if (saDiscordToken && opsChannelId) {
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

            if (saDiscordTokenSpot && opsChannelId) {
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

  // ── Batch emails — consolidated or per-client based on agency setting ────────
  if (notifEmail) {
    const shouldEmailTopics = agencySettings?.notify_topics_created || agencySettings?.notify_topic_ready

    if (consolidatedEmail) {
      // ONE email covering all clients that had activity this run
      const allTopicClients  = Array.from(topicAccum.entries())
      const allPostClients   = Array.from(postAccum.entries())
      const hasTopics        = shouldEmailTopics && allTopicClients.length > 0
      const hasPosts         = agencySettings?.notify_post_generated && allPostClients.length > 0

      if (hasTopics || hasPosts) {
        const totalTopics = allTopicClients.reduce((s, [, { items }]) => s + items.length, 0)
        const totalPosts  = allPostClients.reduce((s, [, { items }]) => s + items.length, 0)
        const reviewLink  = `${appUrl}/admin/content`
        const sections: string[] = []

        if (hasTopics) {
          sections.push(`<h2 style="margin:0 0 8px;font-size:16px">New Topics (${totalTopics})</h2>`)
          for (const [, { clientName, items }] of allTopicClients) {
            sections.push(`<p style="margin:4px 0"><strong>${clientName}</strong> — ${items.length} topic${items.length === 1 ? '' : 's'}</p>`)
            sections.push(`<ul style="margin:0 0 12px;padding-left:20px">${items.map((t: TopicSummary) => `<li>${t.target_keyword ?? t.topic}${t.target_publish_date ? ` <em>(${t.target_publish_date})</em>` : ''}</li>`).join('')}</ul>`)
          }
        }
        if (hasPosts) {
          sections.push(`<h2 style="margin:16px 0 8px;font-size:16px">Posts Generated (${totalPosts})</h2>`)
          for (const [, { clientName, items }] of allPostClients) {
            sections.push(`<p style="margin:4px 0"><strong>${clientName}</strong> — ${items.length} post${items.length === 1 ? '' : 's'}</p>`)
            sections.push(`<ul style="margin:0 0 12px;padding-left:20px">${items.map((p: PostSummary) => `<li>${p.title ?? '(untitled)'}${p.targetPublishDate ? ` <em>(${p.targetPublishDate})</em>` : ''}</li>`).join('')}</ul>`)
          }
        }

        const parts: string[] = []
        if (hasTopics) parts.push(`${totalTopics} topic${totalTopics === 1 ? '' : 's'}`)
        if (hasPosts)  parts.push(`${totalPosts} post${totalPosts === 1 ? '' : 's'}`)
        const subjectSummary = parts.join(' + ')
        const clientCount    = new Set([...allTopicClients.map(([id]) => id), ...allPostClients.map(([id]) => id)]).size

        try {
          await sendEmail({
            to:      notifEmail,
            subject: `${agencyName} | Content Update — ${subjectSummary} across ${clientCount} client${clientCount === 1 ? '' : 's'}`,
            html:    `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">${sections.join('\n')}<p style="margin-top:16px"><a href="${reviewLink}">Review in dashboard →</a></p></div>`,
          })
        } catch (e) {
          console.error('[content-topics cron] Consolidated email failed:', e)
        }
      }
    } else {
      // Legacy: one email per client
      if (shouldEmailTopics) {
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
      if (agencySettings?.notify_post_generated) {
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
    }
  }

  // ── Discord notifications — ONE consolidated ops-channel message ─────────────
  const discordBotToken = (agencySettings?.discord_bot_token as string | null) ?? null
  const contentUrl      = `${appUrl}/admin/content`

  if (discordBotToken && opsChannelId) {
    // ONE message for all topics generated this run
    const totalTopicsReady = Array.from(topicAccum.values()).reduce((s, { items }) => s + items.length, 0)
    if (totalTopicsReady > 0) {
      const topicLines = Array.from(topicAccum.entries()).map(([, { clientName, items }]) =>
        `• **${clientName}** — ${items.length} topic${items.length === 1 ? '' : 's'}`
      )
      void sendDiscordMessage(
        discordBotToken, opsChannelId,
        `📋 **${totalTopicsReady} topic${totalTopicsReady === 1 ? '' : 's'} generated** — auto-approves in ~24h\n${topicLines.join('\n')}\nReview: ${contentUrl}`
      ).catch(() => {})
    }

    // ONE message for all posts generated this run
    const totalPostsReady = Array.from(postAccum.values()).reduce((s, { items }) => s + items.length, 0)
    if (totalPostsReady > 0) {
      const postLines = Array.from(postAccum.entries()).map(([, { clientName, items }]) =>
        `• **${clientName}** — ${items.length} post${items.length === 1 ? '' : 's'}`
      )
      void sendDiscordMessage(
        discordBotToken, opsChannelId,
        `✍️ **${totalPostsReady} post${totalPostsReady === 1 ? '' : 's'} generated** — ready for monthly review\n${postLines.join('\n')}\nReview: ${contentUrl}`
      ).catch(() => {})
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

  // ── Consolidated content review alerts (ONE Discord message each) ────────────
  // These query across ALL clients so there's never per-client Discord noise.
  {
    const contentReviewUrl = contentUrl

    if (discordBotToken && opsChannelId) {
      type PostRow = { id: string; title: string | null; target_publish_date: string | null; client_id: string }

      // Review reminder: posts needing approval in 3–7 days (not yet in the critical window)
      const reminderFrom = new Date(); reminderFrom.setUTCDate(reminderFrom.getUTCDate() + 3)
      const reminderTo   = new Date(); reminderTo.setUTCDate(reminderTo.getUTCDate() + 7)
      const { data: reviewPosts } = await db
        .from('content_posts')
        .select('id, title, target_publish_date, client_id')
        .in('status', ['for_review', 'pending'])
        .gte('target_publish_date', reminderFrom.toISOString().slice(0, 10))
        .lte('target_publish_date', reminderTo.toISOString().slice(0, 10))
        .not('target_publish_date', 'is', null)
        .is('wp_post_id', null).is('bc_post_id', null)
        .order('target_publish_date', { ascending: true })

      if (reviewPosts && reviewPosts.length > 0) {
        // Dedup: skip if review_reminder already sent in last 20 hours
        const { data: recentReminder } = await db.from('admin_alerts')
          .select('id').eq('type', 'content')
          .filter('meta->>content_type', 'eq', 'review_reminder')
          .gte('created_at', new Date(Date.now() - 20 * 3_600_000).toISOString())
          .limit(1)

        if (!recentReminder || recentReminder.length === 0) {
          const clientIds = Array.from(new Set((reviewPosts as PostRow[]).map(p => p.client_id)))
          const { data: clientRows } = await db.from('clients').select('id, name').in('id', clientIds)
          const clientNameMap = new Map((clientRows ?? []).map((c: { id: string; name: string }) => [c.id, c.name]))
          const earliest = (reviewPosts as PostRow[])[0].target_publish_date
          const displayPosts = (reviewPosts as PostRow[]).slice(0, 8)
          const lines = displayPosts.map(p =>
            `• **${clientNameMap.get(p.client_id) ?? p.client_id}** — ${p.title ?? '(untitled)'} (${p.target_publish_date})`
          )
          if (reviewPosts.length > 8) lines.push(`…and ${reviewPosts.length - 8} more`)
          void sendDiscordMessage(discordBotToken, opsChannelId,
            `📋 **${reviewPosts.length} post${reviewPosts.length === 1 ? '' : 's'} awaiting approval**${earliest ? ` — earliest deadline: ${earliest}` : ''}\n${lines.join('\n')}\nReview: ${contentReviewUrl}`
          ).catch(() => {})
          db.from('admin_alerts').insert({
            type: 'content', severity: 'info',
            title: `${reviewPosts.length} post${reviewPosts.length === 1 ? '' : 's'} awaiting approval`,
            body: lines.join('\n'),
            meta: { content_type: 'review_reminder', count: reviewPosts.length, earliest_deadline: earliest },
            link_url: contentReviewUrl,
          }).then(null, () => {})
        }
      }

      // Missed-approval alert: posts due within 2 days still not approved (critical)
      const missedDeadline = new Date(); missedDeadline.setUTCDate(missedDeadline.getUTCDate() + 2)
      const { data: skippedPosts } = await db
        .from('content_posts')
        .select('id, title, target_publish_date, client_id')
        .in('status', ['for_review', 'pending'])
        .lte('target_publish_date', missedDeadline.toISOString().slice(0, 10))
        .not('target_publish_date', 'is', null)
        .is('wp_post_id', null).is('bc_post_id', null)
        .order('target_publish_date', { ascending: true })

      if (skippedPosts && skippedPosts.length > 0) {
        const clientIds = Array.from(new Set((skippedPosts as PostRow[]).map(p => p.client_id)))
        const { data: clientRows } = await db.from('clients').select('id, name').in('id', clientIds)
        const clientNameMap = new Map((clientRows ?? []).map((c: { id: string; name: string }) => [c.id, c.name]))
        const lines = (skippedPosts as PostRow[]).map(p =>
          `• ${clientNameMap.get(p.client_id) ?? p.client_id} — ${p.title ?? '(untitled)'} (${p.target_publish_date})`
        )
        void sendDiscordMessage(discordBotToken, opsChannelId,
          `⚠️ **Auto-publish skipped — ${skippedPosts.length} post${skippedPosts.length === 1 ? '' : 's'} not approved**\n${lines.join('\n')}\nManual push or approval required → ${contentReviewUrl}`
        ).catch(() => {})
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
