// Google Maps Ranking — /dashboard/seo/maps
// Full-screen embed of the client's Local Dominator share link.

import { cookies } from 'next/headers'
import { isDashboardV2 } from '@/lib/dashboardVersion'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import type { Client } from '@/lib/types'
import PageHeader from '@/components/dashboard/PageHeader'
import EmptyState from '@/components/dashboard/EmptyState'
import { MapTrifold } from '@phosphor-icons/react/dist/ssr'

export const dynamic = 'force-dynamic'

export default async function GoogleMapsRankingPage() {
  const cookieStore = await cookies()
  const db          = createAdminClient()

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const { data: clientData } = await db.from('clients').select('*').eq('dashboard_token', token).maybeSingle()
  const client = clientData as Client | null
  if (!client) redirect('/access')

  // This page's content moved into the combined report on the rebuilt dashboard.
  if (isDashboardV2(client, cookieStore)) redirect('/dashboard/seo')

  const url = (client as unknown as { local_dominator_url?: string | null }).local_dominator_url

  if (!url) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <PageHeader title="Google Maps Ranking" showDateRange={false} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <EmptyState
            title="Map rankings aren't switched on yet"
            description="Once this is set up you'll see a grid of where your business ranks on Google Maps across your service area, for each of your target search terms, and how those positions move over time. Ask your account manager to switch it on."
            icon={<MapTrifold size={22} />}
          />
        </main>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0, background: 'var(--bg-base)' }}>
      <PageHeader title="Google Maps Ranking" showDateRange={false} />
      <iframe
        src={url}
        title="Google Maps Ranking"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        style={{ display: 'block', flex: 1, minHeight: 0, width: '100%', border: 'none' }}
      />
    </div>
  )
}
