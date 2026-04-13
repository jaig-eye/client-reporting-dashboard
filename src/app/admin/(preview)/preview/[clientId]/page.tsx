// Admin Preview — /admin/preview/[clientId]
// The client_token cookie is set by GET /api/admin/preview/[clientId] before navigating here.
// This page just verifies the client exists and renders the iframe shell.

import { notFound }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import PreviewIframe         from '@/components/admin/PreviewIframe'

export const dynamic = 'force-dynamic'

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const { clientId }     = await params
  const db               = createAdminClient()
  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .single()

  if (!client) notFound()

  return <PreviewIframe />
}
