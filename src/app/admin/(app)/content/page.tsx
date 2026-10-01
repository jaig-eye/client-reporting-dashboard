// Content Tool — /admin/content
// Global calendar view, the agency-wide Priority topics overview, and global settings. Per-client
// workflows live on the client tab.

import { createAdminClient }   from '@/lib/supabase/server'
import { isAdminAuthed }       from '@/lib/auth'
import { cookies }             from 'next/headers'
import { redirect }            from 'next/navigation'
import ContentCalendar         from './ContentCalendar'
import type { CalendarItem }   from './ContentCalendar'
import MonthlyReviewSession    from '@/components/admin/MonthlyReviewSession'
import { getMonthlyReviewData } from '@/lib/content/monthlyReviewData'
import PriorityTopicsOverview, { type OverviewClient } from '@/components/admin/PriorityTopicsOverview'
import { nextOpenSlot }         from '@/lib/content/scheduleSlots'

export const dynamic = 'force-dynamic'

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; view?: string; month?: string; highlight?: string }>
}) {
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) redirect('/admin/login')

  const params      = await searchParams
  // Monthly Review is the default landing view; Calendar and Priority topics are secondary views.
  const activeView  = params.view ?? 'review'

  const db = createAdminClient()

  // Existing 5-element query (typing must stay intact — adding to this array breaks TS tuple inference)
  const [
    allClientsRes,
    postsRes,
    scheduledTopicsRes,
    silosRes,
    siloPostsRes,
  ] = await Promise.all([
    db.from('clients').select('id, name').order('name'),
    db.from('content_posts')
      .select('id, client_id, status, target_keyword, title, word_count, generated_at, published_url, target_publish_date, wp_post_id, wp_site_url, topic_rationale, content_type')
      .order('target_publish_date', { ascending: true, nullsFirst: false })
      .limit(300),
    db.from('content_topics')
      .select('id, client_id, topic, target_keyword, target_publish_date, status, rationale, keyword_opportunity, ranking_strategy, audience_intent, why_now, competition_level, generation_error, suggested_title, search_volume, keyword_difficulty, created_at, post_id, cluster_group, content_type, city, state_abbr, service_name')
      .order('target_publish_date', { ascending: true, nullsFirst: false })
      .limit(500),
    // In the order the topic run takes them (priority, then oldest first), so "Next up" here is the
    // set that really goes next.
    db.from('content_silos').select('id, client_id, name, hub_page_url, hub_page_title, content_type').neq('status', 'archived').order('priority', { ascending: true }).order('created_at', { ascending: true }),
    db.from('content_posts').select('silo_id, status').not('silo_id', 'is', null).limit(2000),
  ])

  // Monthly-review window data — only fetched when the Review view is active.
  const reviewData = activeView === 'review'
    ? await getMonthlyReviewData(
        db,
        typeof params.month === 'string' ? params.month : null,
        mp => `/admin/content?view=review&month=${mp}`,
      )
    : null

  const allClientsMap = new Map(((allClientsRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const allClients    = (allClientsRes.data ?? []) as { id: string; name: string }[]

  // Build calendar items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postItems = ((postsRes.data ?? []) as Record<string, any>[]).map(p => ({
    id:                 String(p.id),
    type:               'post' as const,
    contentType:        (p as Record<string, unknown>).content_type ? String((p as Record<string, unknown>).content_type) : 'blog',
    clientId:           String(p.client_id),
    clientName:         allClientsMap.get(String(p.client_id)) ?? 'Unknown',
    status:             String(p.status),
    targetPublishDate:  p.target_publish_date  ? String(p.target_publish_date)  : null,
    topicText:          null,
    title:              p.title                ? String(p.title)                : null,
    targetKeyword:      p.target_keyword       ? String(p.target_keyword)       : null,
    wpPostId:           p.wp_post_id           ? Number(p.wp_post_id)           : null,
    wpSiteUrl:          p.wp_site_url          ? String(p.wp_site_url)          : null,
    publishedUrl:       p.published_url        ? String(p.published_url)        : null,
    rationale:          (p as Record<string, unknown>).topic_rationale ? String((p as Record<string, unknown>).topic_rationale) : null,
    competitionLevel:   null,
    generationError:    null,
    keywordOpportunity: null,
    rankingStrategy:    null,
    audienceIntent:     null,
    whyNow:             null,
    suggestedTitle:     null,
    searchVolume:       null,
    keywordDifficulty:  null,
    clusterGroup:       null,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topicItems = ((scheduledTopicsRes.data ?? []) as Record<string, any>[]).map(t => ({
    id:                 String(t.id),
    type:               'topic' as const,
    contentType:        (t as Record<string, unknown>).content_type ? String((t as Record<string, unknown>).content_type) : 'blog',
    clientId:           String(t.client_id),
    clientName:         allClientsMap.get(String(t.client_id)) ?? 'Unknown',
    status:             String(t.status),
    targetPublishDate:  t.target_publish_date  ? String(t.target_publish_date)  : null,
    topicText:          (t as Record<string, unknown>).content_type === 'service_area'
      ? [t.service_name, t.city, t.state_abbr].filter(Boolean).join(', ') || String(t.topic)
      : String(t.topic),
    title:              null,
    targetKeyword:      t.target_keyword       ? String(t.target_keyword)       : null,
    wpPostId:           null,
    wpSiteUrl:          null,
    publishedUrl:       null,
    rationale:          t.rationale            ? String(t.rationale)            : null,
    competitionLevel:   (t as Record<string, unknown>).competition_level  ? String((t as Record<string, unknown>).competition_level)  : null,
    generationError:    (t as Record<string, unknown>).generation_error   ? String((t as Record<string, unknown>).generation_error)   : null,
    keywordOpportunity: (t as Record<string, unknown>).keyword_opportunity ? String((t as Record<string, unknown>).keyword_opportunity) : null,
    rankingStrategy:    (t as Record<string, unknown>).ranking_strategy   ? String((t as Record<string, unknown>).ranking_strategy)   : null,
    audienceIntent:     (t as Record<string, unknown>).audience_intent    ? String((t as Record<string, unknown>).audience_intent)    : null,
    whyNow:             (t as Record<string, unknown>).why_now            ? String((t as Record<string, unknown>).why_now)            : null,
    suggestedTitle:     (t as Record<string, unknown>).suggested_title    ? String((t as Record<string, unknown>).suggested_title)    : null,
    searchVolume:       (t as Record<string, unknown>).search_volume      != null ? Number((t as Record<string, unknown>).search_volume)      : null,
    keywordDifficulty:  (t as Record<string, unknown>).keyword_difficulty != null ? Number((t as Record<string, unknown>).keyword_difficulty) : null,
    clusterGroup:       (t as Record<string, unknown>).cluster_group      ? String((t as Record<string, unknown>).cluster_group)      : null,
  }))

  // Exclude topic rows that already have a linked post
  const postIdSet = new Set(postItems.map(p => p.id))
  const calendarItems: CalendarItem[] = [
    ...topicItems.filter(t => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const postId = ((scheduledTopicsRes.data ?? []) as Record<string, any>[]).find(r => String(r.id) === t.id)?.post_id
      return !postId || !postIdSet.has(String(postId))
    }),
    ...postItems,
  ]

  // Priority topics (content_silos): read in full only when that view is open.
  type SiloRow = { id: string; client_id: string; name: string; hub_page_url: string | null; hub_page_title: string | null; content_type: string | null }
  const silos = (silosRes.data ?? []) as SiloRow[]
  const siloPostCounts: Record<string, number> = {}
  for (const p of (siloPostsRes.data ?? []) as { silo_id: string }[]) {
    siloPostCounts[p.silo_id] = (siloPostCounts[p.silo_id] ?? 0) + 1
  }
  const overviewClients = activeView === 'silos'
    ? await priorityOverview(db, silos, siloPostCounts, allClientsMap)
    : []

  // The view's id stays "silos" so existing links keep working; its name follows the Pipeline's.
  const views = [
    { id: 'review',   label: 'Review' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'silos',    label: 'Priority topics' },
  ]

  return (
    <div>
      {/* Header: title + gear settings on the left, view switcher on the right */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Content</h1>
        <a
          href="/admin/content/settings"
          title="Content settings"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.8125rem', color: 'var(--text-muted)', textDecoration: 'none', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
        >
          ⚙ Settings
        </a>

        <div style={{ flex: 1 }} />

        {/* View switcher */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-subtle)', borderRadius: 8, padding: 3 }}>
          {views.map(v => (
            <a
              key={v.id}
              href={`?view=${v.id}`}
              style={{
                display:        'inline-block',
                padding:        '5px 14px',
                borderRadius:   6,
                fontSize:       '0.8125rem',
                fontWeight:     activeView === v.id ? 600 : 400,
                color:          activeView === v.id ? '#fff' : 'var(--text-muted)',
                background:     activeView === v.id ? 'var(--blue, #2563eb)' : 'transparent',
                textDecoration: 'none',
              }}
            >
              {v.label}
            </a>
          ))}
        </div>
      </div>

      {activeView === 'review' && reviewData && (
        <MonthlyReviewSession
          posts={reviewData.posts}
          allSites={reviewData.allSites}
          month={reviewData.month}
          prevUrl={reviewData.prevUrl}
          nextUrl={reviewData.nextUrl}
          embedded
        />
      )}

      {activeView === 'calendar' && (
        <ContentCalendar items={calendarItems} clients={allClients} />
      )}

      {activeView === 'silos' && (
        <PriorityTopicsOverview clients={overviewClients} />
      )}

    </div>
  )
}

/** Sets per read of their keywords: an `in` filter rides in the URL, so this keeps it short. */
const SET_CHUNK = 200
/** PostgREST answers at most this many rows per request, so longer reads are paged. */
const PAGE = 1000

/**
 * Everything the Priority topics view shows, read in a bounded number of requests: the keywords of
 * every listed set (in chunks of sets, paged), and each client's next open date — once per client
 * with a set, in parallel, so one client's failure leaves the rest of the page intact.
 *
 * "Written" counts keywords with a post, "in progress" ones whose topic is picked but not yet
 * written — the same split the Pipeline's card makes, so the two never disagree.
 */
async function priorityOverview(
  db: ReturnType<typeof createAdminClient>,
  silos: { id: string; client_id: string; name: string; hub_page_url: string | null; hub_page_title: string | null; content_type: string | null }[],
  postCounts: Record<string, number>,
  clientNames: Map<string, string>,
): Promise<OverviewClient[]> {
  if (silos.length === 0) return []

  type Stat = { total: number; written: number; picked: number; nextKeyword: string | null; nextOrder: number }
  const stats = new Map<string, Stat | null>()
  const ids = silos.map(s => s.id)
  for (let i = 0; i < ids.length; i += SET_CHUNK) {
    const chunk = ids.slice(i, i + SET_CHUNK)
    const found = new Map<string, Stat>(chunk.map(id => [id, { total: 0, written: 0, picked: 0, nextKeyword: null, nextOrder: Infinity }]))
    let failed = false
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('content_silo_keywords')
        .select('id, silo_id, keyword, used_at, target_post_id, sort_order')
        .eq('selected', true)   // the queue, as the topic run and the Pipeline count it
        .in('silo_id', chunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) { console.warn('[content/priority] keyword read failed:', error.message); failed = true; break }
      const rows = (data ?? []) as { silo_id: string; keyword: string; used_at: string | null; target_post_id: string | null; sort_order: number | null }[]
      for (const k of rows) {
        const s = found.get(k.silo_id)
        if (!s) continue
        s.total++
        if (k.target_post_id) s.written++
        else if (k.used_at) s.picked++
        else if ((k.sort_order ?? 0) < s.nextOrder) { s.nextOrder = k.sort_order ?? 0; s.nextKeyword = k.keyword }
      }
      if (rows.length < PAGE) break
    }
    // A failed read is "unknown", never "0 of 0".
    for (const id of chunk) stats.set(id, failed ? null : found.get(id)!)
  }

  const clientIds = Array.from(new Set(silos.map(s => s.client_id)))
  const slots = await Promise.allSettled(clientIds.map(id => nextOpenSlot(db, id)))
  const slotOf = new Map(clientIds.map((id, i) => {
    const r = slots[i]
    return [id, r.status === 'fulfilled' ? r.value : 'error' as const]
  }))

  return clientIds
    .map(id => ({
      id,
      name: clientNames.get(id) ?? 'Unknown client',
      slot: slotOf.get(id) ?? null,
      sets: silos.filter(s => s.client_id === id).map(s => {
        const st = stats.get(s.id)
        return {
          id: s.id, name: s.name, contentType: s.content_type ?? 'blog',
          hubUrl: s.hub_page_url, hubTitle: s.hub_page_title,
          stats: st ? { total: st.total, written: st.written, picked: st.picked, nextKeyword: st.nextKeyword } : null,
          posts: postCounts[s.id] ?? 0,
        }
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
