// Content Tool — /admin/content
// Global calendar view + global settings. Per-client workflows live on the client tab.

import { createAdminClient }   from '@/lib/supabase/server'
import { isAdminAuthed }       from '@/lib/auth'
import { cookies }             from 'next/headers'
import { redirect }            from 'next/navigation'
import GlobalContentSettings   from './ContentSettingsPanel'
import ContentCalendar         from './ContentCalendar'
import type { CalendarItem }   from './ContentCalendar'

export const dynamic = 'force-dynamic'

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; highlight?: string }>
}) {
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) redirect('/admin/login')

  const params    = await searchParams
  const activeTab = params.tab ?? 'calendar'

  const db = createAdminClient()

  const [
    allClientsRes,
    postsRes,
    scheduledTopicsRes,
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
  ])

  const allClientsMap = new Map(((allClientsRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const allClients    = (allClientsRes.data ?? []) as { id: string; name: string }[]

  // Build calendar items
  const postItems = (postsRes.data ?? []).map(p => ({
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

  const topicItems = (scheduledTopicsRes.data ?? []).map(t => ({
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
      const postId = (scheduledTopicsRes.data ?? []).find(r => String(r.id) === t.id)?.post_id
      return !postId || !postIdSet.has(String(postId))
    }),
    ...postItems,
  ]

  const tabs = [
    { id: 'calendar', label: 'Calendar' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Content</h1>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {tabs.map(tab => (
          <a
            key={tab.id}
            href={`?tab=${tab.id}`}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--blue)' : 'var(--text-muted)',
              textDecoration: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--blue)' : '2px solid transparent',
              marginBottom: -1,
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {activeTab === 'calendar' && (
        <ContentCalendar items={calendarItems} clients={allClients} />
      )}

      {activeTab === 'settings' && (
        <GlobalContentSettings clients={allClients} />
      )}
    </div>
  )
}
