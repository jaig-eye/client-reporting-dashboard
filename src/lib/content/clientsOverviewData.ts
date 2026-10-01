// The Content page's Clients overview (?view=overview): every client with content settings, read
// agency-wide in a fixed number of requests rather than one set per client.
//
// Each read stands alone. One that fails is logged and its columns show "—" for everyone; the rest
// of the table still renders. Only the settings read is essential — without it there are no rows.

import { createAdminClient } from '@/lib/supabase/server'
import { cadenceLabel, planningWindowLabel } from '@/lib/content/cadence'
import { windowSlots, SLOT_STATUSES } from '@/lib/content/scheduleSlots'
import {
  overviewFlags, sortOverviewRows, countOpenDates,
  type ClientOverviewRow, type OverviewFacts,
} from '@/lib/content/clientOverviewFlags'

type Db = ReturnType<typeof createAdminClient>
type Result = { data: unknown[] | null; error: { message: string } | null }

/** PostgREST answers at most this many rows per request, so longer reads are paged. */
const PAGE = 1000
/** A ceiling on any one paged read, so a runaway table can't hold the page open. */
const MAX_ROWS = 50_000
/** Ids per `in` filter: it rides in the URL, so this keeps it short. */
const CHUNK = 200
/** How far back a failure still counts as recent. */
/** When "SEO fields not stored" became trustworthy (an accepted Rank Math write is no longer re-judged). */
const SEO_EVENTS_TRUSTED_FROM = '2026-10-02'

const RECENT_DAYS = 14

const log = (what: string, message: string) => console.error(`[content/overview] ${what} read failed:`, message)

/** Every row of a read, page by page. Null when any page fails — partial data would read as "none". */
async function readAll<T>(what: string, page: (from: number, to: number) => PromiseLike<Result>): Promise<T[] | null> {
  const out: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) { log(what, error.message); return null }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
  console.warn(`[content/overview] ${what}: stopped after ${MAX_ROWS} rows`)
  return out
}

/** readAll over id chunks, for reads filtered by a list of ids. */
async function readChunked<T>(what: string, ids: string[], page: (chunk: string[], from: number, to: number) => PromiseLike<Result>): Promise<T[] | null> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const rows = await readAll<T>(what, (from, to) => page(chunk, from, to))
    if (!rows) return null
    out.push(...rows)
  }
  return out
}

/** A read that may throw (a network failure rather than an error answer) still only costs its columns. */
async function safe<T>(what: string, run: () => Promise<T | null>): Promise<T | null> {
  try { return await run() } catch (e) { log(what, e instanceof Error ? e.message : String(e)); return null }
}

type SettingsRow = {
  client_id: string | null
  schedule_frequency: string | null; schedule_day_of_week: number | null; weeks_ahead: number | null
  monthly_publish_day: number | null; schedule_start_date: string | null; posts_per_run: number | null
  auto_generate: boolean | null; auto_approve_topics: boolean | null; auto_push_posts: boolean | null
  wp_publish_mode: string | null; target_length: number | null; last_keyword_research_at: string | null
  connection_id: string | null; updated_at: string | null
}
type Embedded<T> = T | T[] | null
type ConnRow = {
  id: string; client_id: string; external_id: string | null; external_name: string | null; status: string | null
  connector: Embedded<{ type: string; status: string | null; role: string | null }>
}
type TopicRow = { client_id: string; target_publish_date: string; status: string }
type SuppressionRow = { client_id: string; target_publish_date: string }
type PostRow = {
  id: string; client_id: string; status: string | null; wp_status: string | null; archived_at: string | null
  published_at: string | null; target_publish_date: string | null
  auto_push_error: string | null; auto_pushed_at: string | null; last_pushed_at: string | null
  image_generation_error: string | null; generated_at: string | null
  wp_post_id: number | null; bc_post_id: number | null; featured_image_url: string | null
}
type ActivityRow = { client_id: string | null; resource_id: string | null }

const one = <T,>(e: Embedded<T>): T | null => (Array.isArray(e) ? e[0] ?? null : e)

/** "https://www.example.com/" → "www.example.com" */
function siteName(c: ConnRow): string {
  const raw = (c.external_name || c.external_id || '').trim()
  return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || 'Unnamed site'
}

export async function getClientsOverview(db: Db, clientNames: Map<string, string>, clientLogos: Map<string, string | null> = new Map()): Promise<{ rows: ClientOverviewRow[]; error: string | null }> {
  const now      = new Date()
  const today    = now.toISOString().slice(0, 10)
  const sinceDay = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10)
  // "SEO fields not stored" events logged before the fix that trusts an accepted Rank Math write
  // were false alarms (the fields were saved), so they are not read.
  const seoSince = sinceDay > SEO_EVENTS_TRUSTED_FROM ? sinceDay : SEO_EVENTS_TRUSTED_FROM

  // Everything that doesn't depend on another read, at once.
  const [settings, conns, topics, suppressions, posts, activity, silos] = await Promise.all([
    safe('settings', () => readAll<SettingsRow>('settings', (f, t) => db.from('content_settings')
      .select('client_id, schedule_frequency, schedule_day_of_week, weeks_ahead, monthly_publish_day, schedule_start_date, posts_per_run, auto_generate, auto_approve_topics, auto_push_posts, wp_publish_mode, target_length, last_keyword_research_at, connection_id, updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false }).order('client_id', { ascending: true })
      .range(f, t))),
    // Every status, not only active ones: a connection that stopped working is what the column is for.
    safe('connections', () => readAll<ConnRow>('connections', (f, t) => db.from('client_connections')
      .select('id, client_id, external_id, external_name, status, connector:connectors!inner(type, status, role:config->>role)')
      .in('connector.type', ['wordpress', 'bigcommerce', 'dataforseo'])
      .order('id', { ascending: true }).range(f, t))),
    // The statuses that hold a date, as the planner counts them; rejected ones are set aside below.
    safe('topics', () => readAll<TopicRow>('topics', (f, t) => db.from('content_topics')
      .select('client_id, target_publish_date, status')
      .gt('target_publish_date', today)
      .in('status', SLOT_STATUSES)
      .order('id', { ascending: true }).range(f, t))),
    safe('suppressions', () => readAll<SuppressionRow>('suppressions', (f, t) => db.from('content_slot_suppressions')
      .select('client_id, target_publish_date')
      .gt('target_publish_date', today)
      .order('id', { ascending: true }).range(f, t))),
    // Posts in review, everything published (for the latest date) and recent failures — one read.
    safe('posts', () => readAll<PostRow>('posts', (f, t) => db.from('content_posts')
      .select('id, client_id, status, wp_status, archived_at, published_at, target_publish_date, auto_push_error, auto_pushed_at, last_pushed_at, image_generation_error, generated_at, wp_post_id, bc_post_id, featured_image_url')
      .or(`status.eq.for_review,wp_status.eq.publish,and(auto_push_error.not.is.null,auto_pushed_at.gte.${sinceDay}),and(image_generation_error.not.is.null,generated_at.gte.${sinceDay})`)
      .order('id', { ascending: true }).range(f, t))),
    safe('activity', () => readAll<ActivityRow>('activity', (f, t) => db.from('activity_log')
      .select('client_id, resource_id')
      .eq('action', 'seo_meta_not_stored')
      .gte('created_at', seoSince)
      .order('id', { ascending: true }).range(f, t))),
    // Active blog sets — the ones the planner takes keywords from.
    safe('sets', () => readAll<{ id: string; client_id: string }>('sets', (f, t) => db.from('content_silos')
      .select('id, client_id')
      .eq('status', 'active').eq('content_type', 'blog')
      .order('id', { ascending: true }).range(f, t))),
  ])

  if (!settings) return { rows: [], error: 'Content settings could not be read.' }

  // The second wave: keywords still waiting in those sets, and the posts behind SEO-field events
  // that were logged without a client.
  const orphanPostIds = Array.from(new Set((activity ?? []).filter(a => !a.client_id && a.resource_id).map(a => a.resource_id!)))
  const [waiting, orphanPosts] = await Promise.all([
    silos && silos.length > 0
      ? safe('waiting keywords', () => readChunked<{ silo_id: string }>('waiting keywords', silos.map(s => s.id), (chunk, f, t) => db.from('content_silo_keywords')
          .select('silo_id')
          .eq('selected', true).is('used_at', null)
          .in('silo_id', chunk)
          .order('id', { ascending: true }).range(f, t)))
      : Promise.resolve(silos ? [] : null),
    orphanPostIds.length > 0
      ? safe('activity posts', () => readChunked<{ id: string; client_id: string }>('activity posts', orphanPostIds, (chunk, f, t) => db.from('content_posts')
          .select('id, client_id').in('id', chunk)
          .order('id', { ascending: true }).range(f, t)))
      : Promise.resolve([]),
  ])

  // The global default schedule a client without its own falls back to — newest row, as the planner takes it.
  const global = settings.find(s => s.client_id === null) ?? null
  const own = new Map<string, SettingsRow>()
  for (const s of settings) if (s.client_id && !own.has(s.client_id)) own.set(s.client_id, s)

  const group = <T extends { client_id: string | null }>(rows: T[] | null) => {
    if (!rows) return null
    const m = new Map<string, T[]>()
    for (const r of rows) {
      if (!r.client_id) continue
      const list = m.get(r.client_id)
      if (list) list.push(r); else m.set(r.client_id, [r])
    }
    return m
  }
  const connsBy = group(conns)
  const topicsBy = group(topics)
  const suppressedBy = group(suppressions)
  const postsBy = group(posts)

  // SEO-field events per client, one per post however often it was retried.
  let seoBy: Map<string, Set<string>> | null = null
  if (activity && orphanPosts) {
    const postClient = new Map(orphanPosts.map(p => [p.id, p.client_id]))
    seoBy = new Map()
    for (const a of activity) {
      const client = a.client_id ?? (a.resource_id ? postClient.get(a.resource_id) : undefined)
      if (!client) continue
      const set = seoBy.get(client) ?? new Set<string>()
      set.add(a.resource_id ?? `event-${set.size}`)
      seoBy.set(client, set)
    }
  }

  let setsBy: Map<string, number> | null = null
  if (silos && waiting) {
    const hasWaiting = new Set(waiting.map(k => k.silo_id))
    setsBy = new Map()
    for (const s of silos) if (hasWaiting.has(s.id)) setsBy.set(s.client_id, (setsBy.get(s.client_id) ?? 0) + 1)
  }

  const rows: ClientOverviewRow[] = Array.from(own.entries()).map(([id, cs]) => {
    const frequency = cs.schedule_frequency ?? global?.schedule_frequency ?? 'weekly'
    const dayOfWeek = cs.schedule_day_of_week ?? global?.schedule_day_of_week ?? 1
    const running   = cs.auto_generate === true

    // ── Site ──
    let site: ClientOverviewRow['site'] = null
    let dfs: ClientOverviewRow['dfs'] = null
    if (connsBy) {
      const mine = connsBy.get(id) ?? []
      const isActive = (c: ConnRow) => (c.status ?? 'active') === 'active' && !['error', 'disconnected'].includes(one(c.connector)?.status ?? '')
      // A BigCommerce connection kept for analytics only is not where posts go.
      const content = mine.filter(c => {
        const conn = one(c.connector)
        return conn?.type === 'wordpress' || (conn?.type === 'bigcommerce' && conn.role !== 'analytics')
      })
      const chosen = content.find(c => c.id === cs.connection_id) ?? content.find(isActive) ?? content[0] ?? null
      if (chosen) {
        const type = one(chosen.connector)?.type
        site = {
          platform: type === 'bigcommerce' ? 'BigCommerce' : 'WordPress',
          name:     siteName(chosen),
          status:   isActive(chosen) ? 'active' : (chosen.status && chosen.status !== 'active' ? chosen.status : one(chosen.connector)?.status ?? 'error'),
          mode:     type === 'wordpress' ? (cs.wp_publish_mode === 'draft_only' ? 'Draft only' : 'Scheduled draft') : null,
        }
      } else site = 'none'
      const dfsConn = mine.some(c => one(c.connector)?.type === 'dataforseo' && (c.status ?? 'active') === 'active' && !!(c.external_id ?? '').trim())
      dfs = { connected: dfsConn, researchedAt: cs.last_keyword_research_at ? cs.last_keyword_research_at.slice(0, 10) : null }
    }

    // ── Planned ──
    let planned: ClientOverviewRow['planned'] = null
    let plannedFuture: number | null = null
    if (topicsBy) {
      const mine = topicsBy.get(id) ?? []
      const live = mine.filter(t => t.status !== 'rejected')
      plannedFuture = live.length
      const through = live.reduce<string | null>((max, t) => (!max || t.target_publish_date > max ? t.target_publish_date : max), null)
      let open: number | null = null
      if (suppressedBy) {
        // A monthly client with no anchor publishes on today's day of the month; passing it in says
        // so without the schedule code warning about it on every page view.
        const anchorless = frequency === 'monthly' && !cs.monthly_publish_day && !cs.schedule_start_date
        const slots = windowSlots({
          frequency, dayOfWeek, weeksAhead: cs.weeks_ahead,
          monthlyPublishDay: anchorless ? now.getUTCDate() : cs.monthly_publish_day,
          scheduleStartDate: cs.schedule_start_date,
        })
        open = countOpenDates(slots, mine.map(t => t.target_publish_date), (suppressedBy.get(id) ?? []).map(s => s.target_publish_date), cs.posts_per_run ?? 1)
      }
      planned = { through, open }
    }

    // ── Posts ──
    let review: ClientOverviewRow['review'] = null
    let lastPublished: ClientOverviewRow['lastPublished'] = null
    let pushErrors: number | null = null
    let imageErrors: number | null = null
    if (postsBy) {
      const mine = postsBy.get(id) ?? []
      const current = mine.filter(p => !p.archived_at)
      const inReview = current.filter(p => p.status === 'for_review')
      review = { count: inReview.length, overdue: inReview.filter(p => p.target_publish_date && p.target_publish_date < today).length }
      // Archived posts are still live on the site, so they count here.
      const last = mine
        .filter(p => p.wp_status === 'publish' && p.status !== 'rejected')
        .map(p => (p.published_at ?? p.target_publish_date ?? '').slice(0, 10))
        .filter(Boolean)
        .sort()
        .pop() ?? null
      lastPublished = {
        date: last,
        daysAgo: last ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(last + 'T00:00:00Z')) / 86_400_000) : null,
      }
      // A failed automatic push counts while the post is still not on a site. auto_push_error was never
      // cleared on a later success, so a retry that worked kept the flag for two weeks.
      pushErrors = current.filter(p => p.auto_push_error && p.auto_pushed_at && p.auto_pushed_at.slice(0, 10) >= sinceDay
        && !p.wp_post_id && !p.bc_post_id).length
      // An image error counts while the post still has no image: an upload does not clear the error.
      imageErrors = current.filter(p => p.image_generation_error && !p.featured_image_url
        && p.generated_at && p.generated_at.slice(0, 10) >= sinceDay).length
    }

    const facts: OverviewFacts = {
      autoGenerate: running, frequency,
      monthlyPublishDay: cs.monthly_publish_day, scheduleStartDate: cs.schedule_start_date,
      site: site === null ? undefined : site === 'none' ? null : site,
      draftOnly: site !== null && site !== 'none' && cs.wp_publish_mode === 'draft_only' && site.mode !== null,
      openDates: planned?.open ?? null, plannedFuture,
      reviewOverdue: review?.overdue ?? null,
      pushErrors, imageErrors,
      seoMetaLost: seoBy ? (seoBy.get(id)?.size ?? 0) : null,
    }

    return {
      id,
      name:        clientNames.get(id) ?? 'Unknown client',
      logoUrl:     clientLogos.get(id) ?? null,
      running,
      offSwitches: running
        ? [cs.auto_approve_topics !== true && 'topic approval', cs.auto_push_posts !== true && 'publishing'].filter((x): x is string => !!x)
        : [],
      cadence:     cadenceLabel({ ...cs, schedule_frequency: frequency, schedule_day_of_week: dayOfWeek, posts_per_run: 1 }),
      postsPerDate: Math.min(10, Math.max(1, Number(cs.posts_per_run ?? 1) || 1)),
      window:      planningWindowLabel(frequency, cs.weeks_ahead),
      startDate:   cs.schedule_start_date,
      site, planned, review, lastPublished,
      length:      cs.target_length,
      dfs,
      prioritySets: setsBy ? (setsBy.get(id) ?? 0) : null,
      flags:       overviewFlags(facts),
    }
  })

  return { rows: sortOverviewRows(rows), error: null }
}
