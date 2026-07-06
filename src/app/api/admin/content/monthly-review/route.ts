// GET /api/admin/content/monthly-review
// Returns all posts in the monthly review window (today → end of next calendar month)
// across every client. Used by the Monthly Review page to populate the review session.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed } from '@/lib/auth'

export async function GET(request: NextRequest) {
  void request
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db  = createAdminClient()
  const now = new Date()

  // Window: today → end of next calendar month (~60 days of runway)
  const windowStart = now.toISOString().slice(0, 10)
  const nextMonth   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)) // last day of next month
  const windowEnd   = nextMonth.toISOString().slice(0, 10)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postsRaw, error: postsErr } = await (db as any)
    .from('content_posts')
    .select('id, client_id, title, content, seo_title, meta_description, slug, focus_topic, target_keyword, featured_image_url, target_publish_date, status, content_type, connection_id, wp_post_id, bc_post_id, admin_approved_at, admin_approved_by')
    .in('status', ['for_review', 'pending', 'approved'])
    .is('wp_post_id', null)
    .is('bc_post_id', null)
    .gte('target_publish_date', windowStart)
    .lte('target_publish_date', windowEnd)
    .not('target_publish_date', 'is', null)
    .order('target_publish_date', { ascending: true })
    .limit(80)

  if (postsErr) {
    return NextResponse.json({ error: postsErr.message }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const posts = (postsRaw ?? []) as Record<string, any>[]

  if (posts.length === 0) {
    return NextResponse.json({ posts: [], clients: [], connections: [] })
  }

  const clientIds = Array.from(new Set(posts.map(p => p.client_id as string)))

  const [clientsRes, connectionsRes] = await Promise.all([
    db.from('clients').select('id, name').in('id', clientIds),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).from('client_connections')
      .select('id, client_id, external_id, connectors!inner(type, config)')
      .in('client_id', clientIds)
      .eq('status', 'active'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clients     = ((clientsRes.data ?? []) as Record<string, any>[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connections = ((connectionsRes.data ?? []) as Record<string, any>[])

  // Sort posts by client name then publish date
  const clientNameMap = new Map(clients.map(c => [c.id as string, c.name as string]))
  posts.sort((a, b) => {
    const nameA = clientNameMap.get(a.client_id as string) ?? ''
    const nameB = clientNameMap.get(b.client_id as string) ?? ''
    return nameA.localeCompare(nameB) || String(a.target_publish_date).localeCompare(String(b.target_publish_date))
  })

  return NextResponse.json({ posts, clients, connections })
}
