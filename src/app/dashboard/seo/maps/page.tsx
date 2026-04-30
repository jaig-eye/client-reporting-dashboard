// Google Maps Ranking — /dashboard/seo/maps
// Full-screen embed of the client's Local Dominator share link.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import type { Client } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function GoogleMapsRankingPage() {
  const cookieStore = await cookies()
  const db          = createAdminClient()

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const { data: clientData } = await db.from('clients').select('*').eq('dashboard_token', token).single()
  const client = clientData as Client | null
  if (!client) redirect('/access')

  const url = (client as unknown as { local_dominator_url?: string | null }).local_dominator_url

  if (!url) {
    return (
      <div style={{ padding: '2rem' }}>
        <div className="card p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Google Maps Ranking is not configured for this account.
          </p>
        </div>
      </div>
    )
  }

  return (
    <iframe
      src={url}
      title="Google Maps Ranking"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      style={{ display: 'block', width: '100%', height: '100vh', border: 'none' }}
    />
  )
}
