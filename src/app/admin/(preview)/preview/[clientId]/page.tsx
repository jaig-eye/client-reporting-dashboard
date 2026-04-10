// Admin Preview — /admin/preview/[clientId]
// Sets the client_token cookie then renders the full client dashboard in an iframe.
// This replaces all the duplicated sub-route pages — the iframe IS the dashboard.

import { cookies }           from 'next/headers'
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
    .select('dashboard_token')
    .eq('id', clientId)
    .single()

  if (!client?.dashboard_token) notFound()

  // Set the client_token cookie so the iframe (/dashboard) authenticates correctly
  const cookieStore = await cookies()
  cookieStore.set('client_token', client.dashboard_token, {
    httpOnly: true,
    path:     '/',
    sameSite: 'lax',
    maxAge:   60 * 60 * 8,  // 8 hours
  })

  return <PreviewIframe />
}
