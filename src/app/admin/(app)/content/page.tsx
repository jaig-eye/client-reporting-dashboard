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
import TopicQueueTable         from './TopicQueueTable'
import type { TopicQueueItem } from './TopicQueueTable'

export const dynamic = 'force-dynamic'

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

  // Fetch all WordPress connections with client info
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

  const [clientsRes, allClientsRes, settingsRes, postsRes, topicQueueRes] = await Promise.all([
    // Clients with WP connections (for Queue/New Post tabs)
    wpClientIds.length > 0
      ? db.from('clients').select('id, name').in('id', wpClientIds)
      : Promise.resolve({ data: [] }),
    // All clients (for Manual tab — any client can have topic ideas)
    db.from('clients').select('id, name').order('name'),
    db.from('agency_settings').select('ai_provider, ai_model, ai_api_key').single(),
    db.from('content_posts')
      .select('id, client_id, status, target_keyword, title, word_count, heading_count, internal_links, generated_at, generated_by, published_url')
      .order('generated_at', { ascending: false })
      .limit(200),
    // Topic queue: pending + approved topics awaiting generation
    db.from('content_topics')
      .select('id, client_id, topic, target_keyword, target_publish_date, status, rationale')
      .in('status', ['pending', 'approved'])
      .order('target_publish_date', { ascending: true })
      .limit(100),
  ])

  const allClientsMap = new Map(((allClientsRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const clientMap     = new Map(((clientsRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const allClients    = (allClientsRes.data ?? []) as { id: string; name: string }[]
  const aiConfigured  = !!(settingsRes.data?.ai_api_key)

  const topicQueue: TopicQueueItem[] = (topicQueueRes.data ?? []).map(t => ({
    id:                String(t.id),
    clientId:          String(t.client_id),
    clientName:        allClientsMap.get(String(t.client_id)) ?? 'Unknown',
    topic:             String(t.topic),
    targetKeyword:     t.target_keyword     ? String(t.target_keyword)     : null,
    targetPublishDate: t.target_publish_date ? String(t.target_publish_date) : null,
    status:            String(t.status),
    rationale:         t.rationale          ? String(t.rationale)          : null,
  }))

  const sites = connections.map(c => ({
    connectionId: c.id,
    siteUrl:      c.external_id || (c.connector.config as Record<string, string>).site_url || '',
    siteName:     c.external_name || (() => { try { return new URL(c.external_id || '').hostname } catch { return c.external_id || 'unknown' } })(),
    clientId:     c.client_id,
    clientName:   clientMap.get(c.client_id) ?? 'Unknown',
  }))

  const posts = (postsRes.data ?? []).map(p => ({
    id:            String(p.id),
    clientId:      String(p.client_id),
    clientName:    clientMap.get(String(p.client_id)) ?? 'Unknown',
    status:        String(p.status),
    targetKeyword: p.target_keyword ? String(p.target_keyword) : null,
    title:         p.title ? String(p.title) : null,
    wordCount:     (p.word_count as number) ?? null,
    headingCount:  (p.heading_count as number) ?? null,
    internalLinks: (p.internal_links as number) ?? null,
    generatedAt:   String(p.generated_at),
    generatedBy:   String(p.generated_by),
    publishedUrl:  p.published_url ? String(p.published_url) : null,
  }))

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

      {/* Queue tab: Topic Queue + Page Queue */}
      {activeTab === 'queue' && (
        <>
          {/* Topic Queue */}
          <section>
            <h2 className="section-title mb-1">Topic Queue</h2>
            <p className="section-desc mb-4">
              Topics awaiting approval before post generation. Approve the required number to trigger
              auto-generation 7 days before publish.
            </p>
            {topicQueue.length === 0 ? (
              <div className="card p-6 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No pending topics. Generate topics in the Manual tab.
                </p>
              </div>
            ) : (
              <TopicQueueTable topics={topicQueue} />
            )}
          </section>

          {/* Page Queue */}
          <section className="mt-8">
            <h2 className="section-title mb-1">Page Queue</h2>
            <p className="section-desc mb-4">Generated posts awaiting review and publishing.</p>
            <ContentQueue posts={posts} sites={sites} />
          </section>
        </>
      )}

      {/* Manual tab: Topics generator + New Post editor */}
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
