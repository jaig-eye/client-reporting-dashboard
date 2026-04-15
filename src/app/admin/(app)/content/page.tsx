// Content Tool — /admin/content
// Four-tab interface: Queue + Topics + New Post + Settings

import { createAdminClient }   from '@/lib/supabase/server'
import { isAdminAuthed }       from '@/lib/auth'
import { cookies }             from 'next/headers'
import { redirect }            from 'next/navigation'
import ContentEditor           from './ContentEditor'
import ContentQueue            from '@/components/admin/ContentQueue'
import ContentTopics           from '@/components/admin/ContentTopics'
import GlobalContentSettings   from './ContentSettingsPanel'

export const dynamic = 'force-dynamic'

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>
}) {
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) redirect('/admin/login')

  const params     = await searchParams
  const activeTab  = params.tab ?? 'queue'

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

  const [clientsRes, allClientsRes, settingsRes, postsRes, scheduledTopicsRes] = await Promise.all([
    // Clients with WP connections (for Queue/New Post tabs)
    wpClientIds.length > 0
      ? db.from('clients').select('id, name').in('id', wpClientIds)
      : Promise.resolve({ data: [] }),
    // All clients (for Topics tab — any client can have topic ideas)
    db.from('clients').select('id, name').order('name'),
    db.from('agency_settings').select('ai_provider, ai_model, ai_api_key').single(),
    db.from('content_posts')
      .select('id, client_id, status, target_keyword, title, word_count, heading_count, internal_links, generated_at, generated_by, published_url')
      .order('generated_at', { ascending: false })
      .limit(200),
    // Scheduled topics — topics whose post has been auto-generated and are awaiting publish
    db.from('content_topics')
      .select('id, client_id, topic, target_keyword, target_publish_date, status')
      .eq('status', 'scheduled')
      .order('target_publish_date', { ascending: true })
      .limit(50),
  ])

  const allClientsMap = new Map(((allClientsRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const clientMap    = new Map(((clientsRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
  const allClients   = (allClientsRes.data ?? []) as { id: string; name: string }[]
  const aiConfigured = !!(settingsRes.data?.ai_api_key)

  const scheduledTopics = (scheduledTopicsRes.data ?? []).map(t => ({
    id:               String(t.id),
    clientId:         String(t.client_id),
    clientName:       allClientsMap.get(String(t.client_id)) ?? 'Unknown',
    topic:            String(t.topic),
    targetKeyword:    t.target_keyword ? String(t.target_keyword) : null,
    targetPublishDate: t.target_publish_date ? String(t.target_publish_date) : null,
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

  const pendingCount = posts.filter(p => p.status === 'pending').length

  const tabs = [
    { id: 'queue',    label: `Queue (${pendingCount})` },
    { id: 'topics',   label: 'Topics'                  },
    { id: 'new-post', label: 'New Post'                },
    { id: 'settings', label: 'Settings'                },
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

      {activeTab === 'queue' && (
        <>
          <ContentQueue posts={posts} sites={sites} />

          {/* Scheduled topics — auto-generated, awaiting publish date */}
          {scheduledTopics.length > 0 && (
            <div className="mt-6">
              <h2 className="section-title mb-3">Scheduled</h2>
              <p className="section-desc mb-4">Topics that have been auto-generated and are scheduled for publishing.</p>
              <div className="card overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Topic</th>
                      <th>Keyword</th>
                      <th>Publish Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduledTopics.map(t => (
                      <tr key={t.id}>
                        <td>
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t.clientName}
                          </span>
                        </td>
                        <td style={{ maxWidth: 280 }}>
                          <span className="text-sm" style={{ color: 'var(--text-primary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.topic}
                          </span>
                        </td>
                        <td>
                          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                            {t.targetKeyword ?? '—'}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-blue" style={{ fontSize: '0.6875rem' }}>
                            {t.targetPublishDate
                              ? new Date(t.targetPublishDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'topics' && (
        <ContentTopics clients={allClients} />
      )}

      {activeTab === 'new-post' && (
        sites.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>No WordPress sites connected yet.</p>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Add a WordPress connection under Data Connections to get started.</p>
          </div>
        ) : (
          <ContentEditor sites={sites} aiConfigured={aiConfigured} />
        )
      )}

      {activeTab === 'settings' && (
        <GlobalContentSettings clients={allClients} allSites={sites} />
      )}
    </div>
  )
}
