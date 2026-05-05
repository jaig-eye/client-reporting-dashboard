// Content Tool — /admin/content
// Calendar-first layout: calendar view + queue panel + settings

import { createAdminClient }   from '@/lib/supabase/server'
import { isAdminAuthed }       from '@/lib/auth'
import { cookies }             from 'next/headers'
import { redirect }            from 'next/navigation'
import ContentEditor         from './ContentEditor'
import ContentQueue          from '@/components/admin/ContentQueue'
import ContentTopics         from '@/components/admin/ContentTopics'
import GlobalContentSettings from './ContentSettingsPanel'
import ContentCalendar       from './ContentCalendar'
import type { CalendarItem } from './ContentCalendar'

export const dynamic = 'force-dynamic'

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string; highlight?: string }>
}) {
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) redirect('/admin/login')

  const params      = await searchParams
  const activeTab   = params.tab ?? 'calendar'
  const highlightId = params.highlight ?? null

  const db = createAdminClient()

  // Fetch WordPress connections with client info
  const { data: wpConnections } = await db
    .from('client_connections')
    .select('id, external_id, external_name, client_id, connector:connectors!inner(id, type, label, auth, config)')
    .eq('status', 'active')
    .eq('connector.type', 'wordpress')

  type WpConn = {
    id: string; external_id: string; external_name: string | null; client_id: string
    connector: { id: string; type: string; label: string; auth: Record<string, unknown>; config: Record<string, unknown> }
  }
  const connections = (wpConnections ?? []) as unknown as WpConn[]
  const wpClientIds = Array.from(new Set(connections.map(c => c.client_id)))

  const [
    clientsRes,
    allClientsRes,
    settingsRes,
    postsRes,
    scheduledTopicsRes,
  ] = await Promise.all([
    // Clients with WP connections
    wpClientIds.length > 0
      ? db.from('clients').select('id, name').in('id', wpClientIds)
      : Promise.resolve({ data: [] }),
    // All clients
    db.from('clients').select('id, name').order('name'),
    db.from('agency_settings').select('ai_provider, ai_model, ai_api_key').single(),
    db.from('content_posts')
      .select('id, client_id, status, target_keyword, title, word_count, heading_count, internal_links, generated_at, generated_by, published_url, target_publish_date, wp_post_id, wp_site_url, topic_rationale')
      .order('generated_at', { ascending: false })
      .limit(300),
    // All topics for calendar + queue
    db.from('content_topics')
      .select('id, client_id, topic, target_keyword, target_publish_date, generate_by_date, status, rationale, keyword_opportunity, ranking_strategy, audience_intent, why_now, competition_level, generation_error, suggested_title, search_volume, keyword_difficulty, created_at')
      .order('target_publish_date', { ascending: true, nullsFirst: false })
      .limit(300),
  ])

  const allClientsMap = new Map(((allClientsRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const clientMap     = new Map(((clientsRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const allClients    = (allClientsRes.data ?? []) as { id: string; name: string }[]
  const aiConfigured  = !!(settingsRes.data?.ai_api_key)

  const sites = connections.map(c => ({
    connectionId: c.id,
    siteUrl:      c.external_id || (c.connector.config as Record<string, string>).site_url || '',
    siteName:     c.external_name || (() => { try { return new URL(c.external_id || '').hostname } catch { return c.external_id || 'unknown' } })(),
    clientId:     c.client_id,
    clientName:   clientMap.get(c.client_id) ?? 'Unknown',
  }))

  const postItems = (postsRes.data ?? []).map(p => ({
    type:              'post' as const,
    id:                String(p.id),
    clientId:          String(p.client_id),
    clientName:        allClientsMap.get(String(p.client_id)) ?? 'Unknown',
    status:            String(p.status),
    targetKeyword:     p.target_keyword ? String(p.target_keyword) : null,
    title:             p.title ? String(p.title) : null,
    topicText:         null,
    wordCount:         (p.word_count as number) ?? null,
    headingCount:      (p.heading_count as number) ?? null,
    internalLinks:     (p.internal_links as number) ?? null,
    generatedAt:       String(p.generated_at),
    generatedBy:       String(p.generated_by),
    publishedUrl:      p.published_url       ? String(p.published_url)           : null,
    generateByDate:    null,
    targetPublishDate: p.target_publish_date  ? String(p.target_publish_date)    : null,
    rationale:         (p as Record<string, unknown>).topic_rationale ? String((p as Record<string, unknown>).topic_rationale) : null,
    wpPostId:          p.wp_post_id           ? Number(p.wp_post_id)              : null,
    wpSiteUrl:         p.wp_site_url          ? String(p.wp_site_url)             : null,
  }))

  const scheduledTopicItems = (scheduledTopicsRes.data ?? []).map(t => ({
    type:                'topic' as const,
    id:                  String(t.id),
    clientId:            String(t.client_id),
    clientName:          allClientsMap.get(String(t.client_id)) ?? 'Unknown',
    status:              String(t.status),
    targetKeyword:       t.target_keyword ? String(t.target_keyword) : null,
    title:               null,
    topicText:           String(t.topic),
    wordCount:           null,
    headingCount:        null,
    internalLinks:       null,
    generatedAt:         String(t.created_at),
    generatedBy:         'scheduled',
    publishedUrl:        null,
    generateByDate:      t.generate_by_date    ? String(t.generate_by_date)    : null,
    targetPublishDate:   t.target_publish_date  ? String(t.target_publish_date) : null,
    rationale:           t.rationale            ? String(t.rationale)           : null,
    wpPostId:            null,
    wpSiteUrl:           null,
    keywordOpportunity:  (t as Record<string, unknown>).keyword_opportunity  ? String((t as Record<string, unknown>).keyword_opportunity)  : null,
    rankingStrategy:     (t as Record<string, unknown>).ranking_strategy     ? String((t as Record<string, unknown>).ranking_strategy)     : null,
    audienceIntent:      (t as Record<string, unknown>).audience_intent      ? String((t as Record<string, unknown>).audience_intent)      : null,
    whyNow:              (t as Record<string, unknown>).why_now              ? String((t as Record<string, unknown>).why_now)              : null,
    competitionLevel:    (t as Record<string, unknown>).competition_level    ? String((t as Record<string, unknown>).competition_level)    : null,
    generationError:     (t as Record<string, unknown>).generation_error     ? String((t as Record<string, unknown>).generation_error)     : null,
    suggestedTitle:      (t as Record<string, unknown>).suggested_title      ? String((t as Record<string, unknown>).suggested_title)      : null,
    searchVolume:        (t as Record<string, unknown>).search_volume        != null ? Number((t as Record<string, unknown>).search_volume)        : null,
    keywordDifficulty:   (t as Record<string, unknown>).keyword_difficulty   != null ? Number((t as Record<string, unknown>).keyword_difficulty)   : null,
  }))

  const posts = [...scheduledTopicItems, ...postItems]

  // Calendar items: all topics + posts with a target_publish_date
  const calendarItems: CalendarItem[] = [
    ...scheduledTopicItems.map(t => ({
      id:                 t.id,
      type:               'topic' as const,
      clientId:           t.clientId,
      clientName:         t.clientName,
      status:             t.status,
      targetPublishDate:  t.targetPublishDate,
      topicText:          t.topicText,
      title:              t.title,
      targetKeyword:      t.targetKeyword,
      wpPostId:           t.wpPostId,
      wpSiteUrl:          t.wpSiteUrl,
      rationale:          t.rationale,
      competitionLevel:   t.competitionLevel ?? null,
      generationError:    t.generationError ?? null,
      keywordOpportunity: t.keywordOpportunity ?? null,
      rankingStrategy:    t.rankingStrategy ?? null,
      audienceIntent:     t.audienceIntent ?? null,
      whyNow:             t.whyNow ?? null,
      suggestedTitle:     t.suggestedTitle ?? null,
      searchVolume:       t.searchVolume ?? null,
      keywordDifficulty:  t.keywordDifficulty ?? null,
    })),
    ...postItems.map(p => ({
      id:                 p.id,
      type:               'post' as const,
      clientId:           p.clientId,
      clientName:         p.clientName,
      status:             p.status,
      targetPublishDate:  p.targetPublishDate,
      topicText:          null,
      title:              p.title,
      targetKeyword:      p.targetKeyword,
      wpPostId:           p.wpPostId,
      wpSiteUrl:          p.wpSiteUrl,
      rationale:          p.rationale,
      competitionLevel:   null,
      generationError:    null,
      keywordOpportunity: null,
      rankingStrategy:    null,
      audienceIntent:     null,
      whyNow:             null,
      suggestedTitle:     null,
      searchVolume:       null,
      keywordDifficulty:  null,
    })),
  ]

  const tabs = [
    { id: 'calendar',  label: 'Calendar'  },
    { id: 'queue',     label: 'Queue'     },
    { id: 'manual',    label: 'Manual'    },
    { id: 'settings',  label: 'Settings'  },
  ]

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Content</h1>
        {!aiConfigured && (
          <p className="text-xs" style={{ color: '#f59e0b' }}>
            AI writing assistant disabled — add an API key in Agency Settings.
          </p>
        )}
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

      {/* Calendar tab (default) */}
      {activeTab === 'calendar' && (
        <ContentCalendar items={calendarItems} clients={allClients} />
      )}

      {/* Queue tab */}
      {activeTab === 'queue' && (
        <section>
          <h2 className="section-title mb-1">Post Queue</h2>
          <p className="section-desc mb-4">All topics and uploaded WordPress drafts.</p>
          <ContentQueue posts={posts} sites={sites} highlightId={highlightId ?? undefined} />
        </section>
      )}

      {/* Manual tab */}
      {activeTab === 'manual' && (
        <>
          <ContentTopics clients={allClients} />

          {sites.length > 0 && (
            <div className="mt-10">
              <h2 className="section-title mb-1">New Post</h2>
              <p className="section-desc mb-4">
                Manually generate or write a post and push directly to WordPress.
              </p>
              <ContentEditor sites={sites} aiConfigured={aiConfigured} />
            </div>
          )}
        </>
      )}

      {/* Settings tab */}
      {activeTab === 'settings' && (
        <GlobalContentSettings clients={allClients} allSites={sites} />
      )}
    </div>
  )
}
