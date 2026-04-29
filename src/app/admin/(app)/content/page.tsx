// Content Tool — /admin/content
// Three-tab interface: Queue / Manual / Settings

import { createAdminClient }   from '@/lib/supabase/server'
import { isAdminAuthed }       from '@/lib/auth'
import { cookies }             from 'next/headers'
import { redirect }            from 'next/navigation'
import ContentEditor           from './ContentEditor'
import ContentQueue            from '@/components/admin/ContentQueue'
import ContentTopics           from '@/components/admin/ContentTopics'
import GlobalContentSettings   from './ContentSettingsPanel'
import ClientCycleQueue        from './ClientCycleQueue'
import type { ContentCycle }   from './ClientCycleQueue'

export const dynamic = 'force-dynamic'

function calcNextPublishDate(
  frequency: string,
  dayOfWeek: number,
  lastPublishedAt: string | null
): Date {
  const now = new Date()
  const y   = now.getUTCFullYear()
  const m   = now.getUTCMonth()
  const daysSinceLast = lastPublishedAt
    ? (Date.now() - new Date(lastPublishedAt).getTime()) / 86_400_000
    : Infinity

  switch (frequency) {
    case 'monthly_first': {
      const d = new Date(Date.UTC(y, m, 1))
      return d <= now ? new Date(Date.UTC(y, m + 1, 1)) : d
    }
    case 'monthly_mid': {
      const d = new Date(Date.UTC(y, m, 15))
      return d <= now ? new Date(Date.UTC(y, m + 1, 15)) : d
    }
    case 'monthly_end': {
      const d = new Date(Date.UTC(y, m, 28))
      return d <= now ? new Date(Date.UTC(y, m + 1, 28)) : d
    }
    case 'monthly':
      return new Date(Date.now() + (28 - Math.min(daysSinceLast, 28)) * 86_400_000)
    case 'biweekly':
      return new Date(Date.now() + (14 - Math.min(daysSinceLast, 14)) * 86_400_000)
    case 'weekly': {
      const daysUntil = ((dayOfWeek - now.getUTCDay()) + 7) % 7 || 7
      return new Date(Date.now() + daysUntil * 86_400_000)
    }
    default:
      return new Date(Date.now() + 86_400_000)
  }
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>
}) {
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) redirect('/admin/login')

  const params    = await searchParams
  const activeTab = params.tab ?? 'queue'

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
    topicsRes,
    autoSettingsRes,
    lastPublishedRes,
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
      .select('id, client_id, status, target_keyword, title, word_count, heading_count, internal_links, generated_at, generated_by, published_url')
      .order('generated_at', { ascending: false })
      .limit(200),
    // All non-rejected topics (for queue / cycle cards)
    db.from('content_topics')
      .select('id, client_id, topic, target_keyword, target_publish_date, status, rationale, keyword_opportunity, ranking_strategy, audience_intent, why_now, competition_level, generation_error, created_at')
      .not('status', 'eq', 'rejected')
      .order('target_publish_date', { ascending: true, nullsFirst: false })
      .limit(200),
    // Content settings for auto_generate clients
    db.from('content_settings')
      .select('client_id, schedule_frequency, schedule_day_of_week, topics_per_run, posts_per_run, auto_generate')
      .eq('auto_generate', true)
      .not('client_id', 'is', null),
    // Last published post per client (for cycle calculation)
    db.from('content_posts')
      .select('client_id, generated_at')
      .in('status', ['published', 'approved'])
      .order('generated_at', { ascending: false })
      .limit(500),
    // Topics in the generation pipeline (approved / generating / scheduled) — shown in Posts to Review
    db.from('content_topics')
      .select('id, client_id, topic, target_keyword, target_publish_date, generate_by_date, status, rationale, created_at')
      .in('status', ['approved', 'generating', 'scheduled'])
      .order('target_publish_date', { ascending: true, nullsFirst: false })
      .limit(200),
  ])

  const allClientsMap = new Map(((allClientsRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const clientMap     = new Map(((clientsRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const allClients    = (allClientsRes.data ?? []) as { id: string; name: string }[]
  const aiConfigured  = !!(settingsRes.data?.ai_api_key)

  // Build last-published-at map per client
  const lastPublishedMap = new Map<string, string>()
  for (const p of ((lastPublishedRes.data ?? []) as { client_id: string; generated_at: string }[])) {
    if (!lastPublishedMap.has(p.client_id)) {
      lastPublishedMap.set(p.client_id, p.generated_at)
    }
  }

  // Group topics by client_id
  const topicsByClient = new Map<string, typeof topicsRes.data>()
  for (const t of (topicsRes.data ?? [])) {
    const cid = String(t.client_id)
    const arr = topicsByClient.get(cid) ?? []
    arr.push(t)
    topicsByClient.set(cid, arr)
  }

  // Load global fallback schedule
  const { data: globalSettings } = await db
    .from('content_settings')
    .select('schedule_frequency, schedule_day_of_week')
    .is('client_id', null)
    .maybeSingle()
  const globalFreq = (globalSettings as { schedule_frequency?: string } | null)?.schedule_frequency ?? 'weekly'
  const globalDay  = (globalSettings as { schedule_day_of_week?: number } | null)?.schedule_day_of_week ?? 1

  // Build ContentCycle[] for auto_generate clients
  const contentCycles: ContentCycle[] = ((autoSettingsRes.data ?? []) as {
    client_id: string
    schedule_frequency: string | null
    schedule_day_of_week: number | null
    topics_per_run: number
    posts_per_run: number
    auto_generate: boolean
  }[]).map(cs => {
    const clientId   = cs.client_id
    const clientName = allClientsMap.get(clientId) ?? 'Unknown'
    const frequency  = cs.schedule_frequency ?? globalFreq
    const dayOfWeek  = cs.schedule_day_of_week ?? globalDay

    const lastPublishedAt = lastPublishedMap.get(clientId) ?? null
    const nextPublish     = calcNextPublishDate(frequency, dayOfWeek, lastPublishedAt)
    const nextPublishStr  = nextPublish.toISOString().split('T')[0]

    // Deadline = 7 days before publish
    const deadlineDate = new Date(nextPublish.getTime() - 7 * 86_400_000)
    const deadlineStr  = deadlineDate.toISOString().split('T')[0]

    const mapTopic = (t: Record<string, unknown>) => ({
      id:                 String(t.id),
      topic:              String(t.topic),
      targetKeyword:      t.target_keyword ? String(t.target_keyword) : null,
      targetPublishDate:  t.target_publish_date ? String(t.target_publish_date) : null,
      status:             String(t.status),
      rationale:          t.rationale ? String(t.rationale) : null,
      keywordOpportunity: t.keyword_opportunity ? String(t.keyword_opportunity) : null,
      rankingStrategy:    t.ranking_strategy ? String(t.ranking_strategy) : null,
      audienceIntent:     t.audience_intent ? String(t.audience_intent) : null,
      whyNow:             t.why_now ? String(t.why_now) : null,
      competitionLevel:   t.competition_level ? String(t.competition_level) : null,
      generationError:    t.generation_error ? String(t.generation_error) : null,
    })

    const clientTopics = (topicsByClient.get(clientId) ?? []).map(t => mapTopic(t as Record<string, unknown>))

    // Pending topics for the current publish cycle
    const cycleTopics = clientTopics.filter(
      t => (!t.targetPublishDate || t.targetPublishDate === nextPublishStr) && t.status === 'pending'
    )

    // All approved/generating topics for this client (back-queue)
    const queuedTopics = clientTopics.filter(t => ['approved', 'generating'].includes(t.status))

    const approved = queuedTopics.length

    return {
      clientId,
      clientName,
      frequency:       cs.schedule_frequency ?? null,
      postsNeeded:     cs.posts_per_run ?? 1,
      topicsGenerated: cycleTopics.length,
      topicsApproved:  approved,
      nextPublishDate: nextPublishStr,
      topicDeadline:   deadlineStr,
      topics:          cycleTopics,
      queuedTopics,
    }
  }).sort((a, b) => a.nextPublishDate.localeCompare(b.nextPublishDate))

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
    publishedUrl:      p.published_url ? String(p.published_url) : null,
    generateByDate:    null,
    targetPublishDate: null,
    rationale:         null,
  }))

  const scheduledTopicItems = (scheduledTopicsRes.data ?? []).map(t => ({
    type:              'topic' as const,
    id:                String(t.id),
    clientId:          String(t.client_id),
    clientName:        allClientsMap.get(String(t.client_id)) ?? 'Unknown',
    status:            String(t.status),
    targetKeyword:     t.target_keyword ? String(t.target_keyword) : null,
    title:             null,
    topicText:         String(t.topic),
    wordCount:         null,
    headingCount:      null,
    internalLinks:     null,
    generatedAt:       String(t.created_at),
    generatedBy:       'scheduled',
    publishedUrl:      null,
    generateByDate:    t.generate_by_date ? String(t.generate_by_date) : null,
    targetPublishDate: t.target_publish_date ? String(t.target_publish_date) : null,
    rationale:         t.rationale ? String(t.rationale) : null,
  }))

  const posts = [...scheduledTopicItems, ...postItems]

  const tabs = [
    { id: 'queue',    label: 'Queue'    },
    { id: 'manual',   label: 'Manual'   },
    { id: 'settings', label: 'Settings' },
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

      {/* Queue tab */}
      {activeTab === 'queue' && (
        <>
          {/* Active cycles */}
          <section>
            <h2 className="section-title mb-1">Active Cycles</h2>
            <p className="section-desc mb-4">
              Clients with auto-generation enabled, grouped by their next publish date. Approve topics before the
              deadline — approved topics auto-generate posts 7 days before publish.
            </p>
            {contentCycles.length === 0 ? (
              <div className="card p-6 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No clients with auto-generation enabled. Enable it in Client Settings → Content.
                </p>
              </div>
            ) : (
              <ClientCycleQueue cycles={contentCycles} />
            )}
          </section>

          {/* Posts to review */}
          <section className="mt-8">
            <h2 className="section-title mb-1">Posts to Review</h2>
            <p className="section-desc mb-4">Generated posts awaiting review and publishing.</p>
            <ContentQueue posts={posts} sites={sites} />
          </section>
        </>
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
