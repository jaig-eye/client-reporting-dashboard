// New connection — /admin/connections/new?type=google|meta_ads
// First-time agency sign-in for Google (all four services at once) or Meta. Other services connect
// from their dialogs on the Integrations page.

import { createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { getConnectorDef, isConnectorImplemented } from '@/lib/connectors/registry'
import type { ConnectorType } from '@/lib/types'
import PageHeader from '@/components/ui/PageHeader'
import BrandLogo from '@/components/ui/BrandLogo'
import NewConnectorForm from './NewConnectorForm'

export const dynamic = 'force-dynamic'

export default async function NewConnectorPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const sp = await searchParams
  const type = sp.type as ConnectorType | 'google' | undefined

  // 'google' is not a ConnectorType — it's the one sign-in that creates all four Google rows.
  if (type !== 'google') {
    if (!type || !isConnectorImplemented(type)) notFound()
    // Already connected: manage it instead.
    const db = createAdminClient()
    const { data: existing } = await db.from('connectors').select('id').eq('type', type).maybeSingle()
    if (existing) redirect(`/admin/connections/${existing.id}`)
  }

  const label = type === 'google' ? 'Google' : getConnectorDef(type as ConnectorType).label
  const description = type === 'google'
    ? 'One sign-in connects Ads, Analytics, Search Console and Business Profile.'
    : getConnectorDef(type as ConnectorType).description

  return (
    <div style={{ maxWidth: 620 }}>
      <PageHeader
        back={{ href: '/admin/connections', label: 'Integrations' }}
        leading={<BrandLogo type={type === 'google' ? 'google' : type!} size={24} tile tileSize="xl" />}
        title={`Connect ${label}`}
        description={description}
      />
      <div className="card" style={{ padding: 20 }}>
        <NewConnectorForm type={type!} />
      </div>
    </div>
  )
}
