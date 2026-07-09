import { createAdminClient } from '@/lib/supabase/server'
import { isAdminAuthed }    from '@/lib/auth'
import { cookies }          from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import SiloDetailClient from './SiloDetailClient'

export const dynamic = 'force-dynamic'

export default async function SiloDetailPage({
  params,
  searchParams,
}: {
  params:       Promise<{ siloId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) redirect('/admin/login')

  const { siloId }  = await params
  const { tab }     = await searchParams
  const activeTab   = tab ?? 'keywords'

  const db = createAdminClient()

  const [siloRes, keywordsRes, pagesRes, linksRes] = await Promise.all([
    db.from('content_silos')
      .select('id, client_id, name, hub_page_url, hub_page_title, central_entity, description, section, status, pending_links, created_at')
      .eq('id', siloId)
      .maybeSingle(),
    db.from('content_silo_keywords')
      .select('*')
      .eq('silo_id', siloId)
      .order('keyword_type').order('created_at'),
    db.from('content_silo_pages')
      .select('*, content_post:content_posts(id, title, status, slug, published_url)')
      .eq('silo_id', siloId)
      .neq('status', 'archived')
      .order('sort_order').order('created_at'),
    db.from('content_silo_internal_links')
      .select('*')
      .eq('silo_id', siloId)
      .order('created_at', { ascending: false }),
  ])

  if (!siloRes.data) notFound()

  const silo     = siloRes.data     as Record<string, unknown>
  const keywords = keywordsRes.data ?? []
  const pages    = pagesRes.data    ?? []
  const links    = linksRes.data    ?? []

  return (
    <SiloDetailClient
      silo={silo}
      initialKeywords={keywords}
      initialPages={pages}
      initialLinks={links}
      activeTab={activeTab}
    />
  )
}
