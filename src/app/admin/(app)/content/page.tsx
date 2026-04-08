// Content Publishing — /admin/content
//
// Bare bones content management tool backed by WordPress connections.
// Allows admins to draft and publish posts to connected WordPress sites.

import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import ContentEditor from './ContentEditor'

export const dynamic = 'force-dynamic'

export default async function ContentPage() {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) redirect('/admin/login')

  const db = createAdminClient()

  // Fetch all WordPress connections with client info
  const { data: wpConnections } = await db
    .from('client_connections')
    .select('id, external_id, external_name, client_id, connector:connectors!inner(id, type, label, auth, config)')
    .eq('status', 'active')
    .eq('connector.type', 'wordpress')

  type WpConnection = {
    id: string
    external_id: string
    external_name: string | null
    client_id: string
    connector: { id: string; type: string; label: string; auth: Record<string, unknown>; config: Record<string, unknown> }
  }

  const connections = (wpConnections ?? []) as unknown as WpConnection[]

  // Also get client names for display
  const clientIds = [...new Set(connections.map(c => c.client_id))]
  const { data: clients } = clientIds.length > 0
    ? await db.from('clients').select('id, name').in('id', clientIds)
    : { data: [] }
  const clientMap = new Map((clients ?? []).map(c => [c.id, c.name as string]))

  // Get agency AI settings
  const { data: settingsData } = await db.from('agency_settings').select('ai_provider, ai_model, ai_api_key').single()
  const aiConfigured = !!(settingsData?.ai_api_key)

  const sites = connections.map(c => ({
    connectionId: c.id,
    siteUrl:      c.external_id || (c.connector.config as Record<string, string>).site_url || '',
    siteName:     c.external_name || new URL(c.external_id || (c.connector.config as Record<string, string>).site_url || 'https://unknown').hostname,
    clientId:     c.client_id,
    clientName:   clientMap.get(c.client_id) ?? 'Unknown',
  }))

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Content Publishing</h1>
        <p className="section-desc">
          Draft and publish blog posts to connected WordPress sites.
          {!aiConfigured && (
            <span style={{ color: 'var(--amber)' }}>
              {' '}AI writing assistant is disabled — add an API key in Agency Settings to enable.
            </span>
          )}
        </p>
      </div>

      {sites.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
            No WordPress sites connected yet.
          </p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            Add a WordPress connection under Data Connections to get started.
          </p>
        </div>
      ) : (
        <ContentEditor sites={sites} aiConfigured={aiConfigured} />
      )}
    </div>
  )
}
