// /admin/content/monthly-review
// Server component — fetches all posts in the monthly review window and
// renders the client-side MonthlyReviewSession orchestrator.

import { cookies }           from 'next/headers'
import { redirect }          from 'next/navigation'
import { isAdminAuthed }     from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import MonthlyReviewSession  from '@/components/admin/MonthlyReviewSession'
import type { MonthlyReviewPost } from '@/components/admin/MonthlyReviewPostCard'

export const dynamic = 'force-dynamic'

export default async function MonthlyReviewPage() {
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) redirect('/admin/login')

  const db  = createAdminClient()
  const now = new Date()

  const windowStart = now.toISOString().slice(0, 10)
  const nextMonth   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0))
  const windowEnd   = nextMonth.toISOString().slice(0, 10)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postsRaw } = await (db as any)
    .from('content_posts')
    .select('id, client_id, title, content, seo_title, meta_description, slug, focus_topic, target_keyword, featured_image_url, target_publish_date, status, content_type, connection_id, admin_approved_at')
    .in('status', ['for_review', 'pending', 'approved'])
    .is('wp_post_id', null)
    .is('bc_post_id', null)
    .gte('target_publish_date', windowStart)
    .lte('target_publish_date', windowEnd)
    .not('target_publish_date', 'is', null)
    .order('target_publish_date', { ascending: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postsRawArr = (postsRaw ?? []) as Record<string, any>[]
  const clientIds   = Array.from(new Set(postsRawArr.map(p => p.client_id as string)))

  const [clientsRes, connectionsRes] = clientIds.length > 0 ? await Promise.all([
    db.from('clients').select('id, name').in('id', clientIds),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).from('client_connections')
      .select('id, client_id, external_id, connectors!inner(type, config)')
      .in('client_id', clientIds)
      .eq('status', 'active'),
  ]) : [{ data: [] }, { data: [] }]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clients     = ((clientsRes.data  ?? []) as Record<string, any>[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connections = ((connectionsRes.data ?? []) as Record<string, any>[])

  const clientNameMap = new Map(clients.map(c => [c.id as string, c.name as string]))

  // Build a set of WP client IDs for BC detection
  const wpClientIds = new Set(
    connections
      .filter(c => c.connectors?.type === 'wordpress')
      .map(c => c.client_id as string)
  )

  const posts: MonthlyReviewPost[] = postsRawArr.map(p => ({
    id:                  String(p.id),
    client_id:           String(p.client_id),
    clientName:          clientNameMap.get(p.client_id as string) ?? 'Unknown',
    title:               p.title   ? String(p.title)   : null,
    content:             p.content ? String(p.content) : null,
    seo_title:           p.seo_title         ? String(p.seo_title)         : null,
    meta_description:    p.meta_description  ? String(p.meta_description)  : null,
    featured_image_url:  p.featured_image_url ? String(p.featured_image_url) : null,
    target_keyword:      p.target_keyword    ? String(p.target_keyword)    : null,
    target_publish_date: p.target_publish_date ? String(p.target_publish_date) : null,
    status:              String(p.status),
    content_type:        p.content_type ? String(p.content_type) : null,
    connection_id:       p.connection_id ? String(p.connection_id) : null,
    admin_approved_at:   p.admin_approved_at ? String(p.admin_approved_at) : null,
    isBc:                !wpClientIds.has(p.client_id as string),
  }))

  // Sort by client name then publish date
  posts.sort((a, b) =>
    a.clientName.localeCompare(b.clientName) ||
    String(a.target_publish_date ?? '').localeCompare(String(b.target_publish_date ?? ''))
  )

  // Build allSites for editor
  type ConnRow = { id: string; client_id: string; external_id: string | null; connectors: { type: string; config: Record<string, unknown> } | null }
  const allSites = (connections as unknown as ConnRow[])
    .filter(c => c.connectors?.type === 'wordpress' || c.connectors?.type === 'bigcommerce')
    .map(c => ({
      connectionId:   c.id,
      siteUrl:        c.connectors?.type === 'wordpress'
        ? String(c.connectors?.config?.site_url ?? c.external_id ?? '')
        : String(c.connectors?.config?.store_hash ?? ''),
      siteName:       clientNameMap.get(c.client_id) ?? 'Unknown',
      clientId:       c.client_id,
      clientName:     clientNameMap.get(c.client_id) ?? 'Unknown',
      connectorType:  c.connectors?.type,
    }))

  const month = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <MonthlyReviewSession
      posts={posts}
      allSites={allSites}
      month={month}
    />
  )
}
