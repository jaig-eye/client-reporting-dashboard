import { createAdminClient } from '@/lib/supabase/server'
import { fetchClientAds }     from '@/lib/ads-library'
import { AdLibraryView }      from '@/components/public/AdLibraryView'

export const dynamic = 'force-dynamic'

export default async function ShareAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  if (!token) return <InvalidLink />

  const db = createAdminClient()

  const { data: client, error: clientError } = await db
    .from('clients')
    .select('id, name')
    .eq('dashboard_token', token)
    .maybeSingle()

  if (clientError) {
    console.error('[share/ads] token lookup error:', clientError.message)
    return <InvalidLink />
  }
  if (!client) return <InvalidLink />

  const { meta, google, error } = await fetchClientAds(db, client.id)
  if (error) {
    console.error('[share/ads] fetch error:', error)
    return <InvalidLink />
  }

  const total = meta.length + google.length

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fb' }}>
      <style>{`
        .adlib-page { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }
        @media (max-width: 600px) { .adlib-page { padding: 1.25rem 1rem; } }
      `}</style>
      <div className="adlib-page">
        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#111827', margin: 0 }}>
            {client.name}
          </h1>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Ad Library · Last 30 days · {total} {total === 1 ? 'ad' : 'ads'}
          </p>
        </div>
        <AdLibraryView meta={meta} google={google} clientId={client.id} />
      </div>
    </div>
  )
}

function InvalidLink() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f8f9fb',
    }}>
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#111827', marginBottom: '0.5rem' }}>
          Link invalid or expired
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>
          Ask your account manager for a new link.
        </p>
      </div>
    </div>
  )
}
