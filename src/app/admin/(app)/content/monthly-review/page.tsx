// /admin/content/monthly-review
// Server component — fetches all posts in the monthly review window and
// renders the client-side MonthlyReviewSession orchestrator.
//
// Optional query param: ?month=YYYY-MM  → review a specific calendar month.
// When omitted, defaults to the current calendar month.
// Navigation is capped: can go back to last month, forward up to 2 months ahead.

import { cookies }           from 'next/headers'
import { redirect }          from 'next/navigation'
import { isAdminAuthed }     from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import MonthlyReviewSession  from '@/components/admin/MonthlyReviewSession'
import type { MonthlyReviewPost } from '@/components/admin/MonthlyReviewPostCard'

export const dynamic = 'force-dynamic'

function monthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

export default async function MonthlyReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const cookieStore = await cookies()
  const session     = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) redirect('/admin/login')

  const sp  = await searchParams
  const now = new Date()

  // Parse ?month=YYYY-MM; default to current month
  let targetYear  = now.getUTCFullYear()
  let targetMonth = now.getUTCMonth() // 0-based

  const monthStr = typeof sp.month === 'string' ? sp.month : null
  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    const [y, m] = monthStr.split('-').map(Number)
    targetYear  = y
    targetMonth = m - 1 // convert to 0-based
  }

  // Clamp: no further back than last month, no more than 2 months ahead
  const minYear  = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
  const minMonth = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1
  const maxYear  = now.getUTCMonth() >= 10 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
  const maxMonth = (now.getUTCMonth() + 2) % 12

  const targetOrd = targetYear * 12 + targetMonth
  const minOrd    = minYear   * 12 + minMonth
  const maxOrd    = maxYear   * 12 + maxMonth

  if (targetOrd < minOrd) { targetYear = minYear; targetMonth = minMonth }
  if (targetOrd > maxOrd) { targetYear = maxYear; targetMonth = maxMonth }

  const windowStart = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01`
  const lastDay     = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const windowEnd   = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Prev / next params for navigation links
  const prevYear  = targetMonth === 0  ? targetYear - 1 : targetYear
  const prevMon   = targetMonth === 0  ? 11 : targetMonth - 1
  const nextYear  = targetMonth === 11 ? targetYear + 1 : targetYear
  const nextMon   = targetMonth === 11 ? 0  : targetMonth + 1

  const currentOrd = targetYear * 12 + targetMonth
  const prevUrl  = currentOrd > minOrd ? `/admin/content/monthly-review?month=${monthParam(prevYear, prevMon)}` : null
  const nextUrl  = currentOrd < maxOrd ? `/admin/content/monthly-review?month=${monthParam(nextYear, nextMon)}` : null

  const db = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postsRaw } = await (db as any)
    .from('content_posts')
    .select('id, client_id, title, content, seo_title, meta_description, slug, focus_topic, target_keyword, featured_image_url, target_publish_date, status, content_type, connection_id, admin_approved_at')
    .in('status', ['for_review', 'pending', 'approved', 'draft_saved', 'generating'])
    .or('admin_approved_at.not.is.null,wp_post_id.is.null')
    .or('admin_approved_at.not.is.null,bc_post_id.is.null')
    .is('archived_at', null)
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

  const month = new Date(Date.UTC(targetYear, targetMonth, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <MonthlyReviewSession
      posts={posts}
      allSites={allSites}
      month={month}
      prevUrl={prevUrl}
      nextUrl={nextUrl}
    />
  )
}
