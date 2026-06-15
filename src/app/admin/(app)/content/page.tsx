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
    db.from('content_silos').select('id, client_id, name, hub_page_url, central_entity, section, pending_links').neq('status', 'archived').order('created_at', { ascending: true }),
    db.from('content_posts').select('silo_id, status').not('silo_id', 'is', null).limit(2000),
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

  // Silo coverage data
  type SiloRow = { id: string; client_id: string; name: string; hub_page_url: string | null; central_entity: string | null; section: string; pending_links: unknown[] }
  const silos = (silosRes.data ?? []) as SiloRow[]
  const siloPostCounts: Record<string, { published: number; total: number }> = {}
  for (const p of (siloPostsRes.data ?? []) as { silo_id: string; status: string }[]) {
    if (!siloPostCounts[p.silo_id]) siloPostCounts[p.silo_id] = { published: 0, total: 0 }
    siloPostCounts[p.silo_id].total++
    if (p.status === 'draft_saved' || p.status === 'published') siloPostCounts[p.silo_id].published++
  }
  const silosGrouped = Array.from(
    silos.reduce((m, s) => { if (!m.has(s.client_id)) m.set(s.client_id, []); m.get(s.client_id)!.push(s); return m }, new Map<string, SiloRow[]>())
  )

  const tabs = [
    { id: 'calendar', label: 'Calendar' },
    { id: 'silos',    label: 'Silos' },
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

      {activeTab === 'silos' && (
        <div>
          {silos.length === 0 ? (
            <p style={{ color: 'var(--text-faint)', fontSize: '0.875rem' }}>
              No silos yet — create silos from a client&apos;s schedule tab to enable pillar-cluster topic strategy.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {silosGrouped.map(([clientId, clientSilos]) => (
                <div key={clientId}>
                  <h3 style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {allClientsMap.get(clientId) ?? 'Unknown Client'}
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                    {clientSilos.map(s => {
                      const counts      = siloPostCounts[s.id] ?? { published: 0, total: 0 }
                      const pct         = counts.total > 0 ? Math.round((counts.published / counts.total) * 100) : 0
                      const pendingCount = Array.isArray(s.pending_links) ? s.pending_links.length : 0
                      return (
                        <div key={s.id} className="card" style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                            <span style={{ fontWeight: 700, fontSize: '0.8125rem' }}>{s.name}</span>
                            <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: 3, background: s.section === 'core' ? 'var(--blue-subtle)' : 'var(--amber-subtle)', color: s.section === 'core' ? 'var(--blue)' : 'var(--amber)', flexShrink: 0 }}>
                              {s.section}
                            </span>
                          </div>
                          {s.hub_page_url && (
                            <a href={s.hub_page_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: 'var(--blue)', display: 'block', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.hub_page_url}
                            </a>
                          )}
                          <div style={{ marginBottom: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-faint)', marginBottom: 3 }}>
                              <span>Coverage</span>
                              <span>{counts.published} / {counts.total} published</span>
                            </div>
                            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--blue)', borderRadius: 2 }} />
                            </div>
                          </div>
                          {pendingCount > 0 && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--amber)', marginTop: 4 }}>
                              ⚠ {pendingCount} pending hub link{pendingCount !== 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <GlobalContentSettings clients={allClients} />
      )}
    </div>
  )
}
