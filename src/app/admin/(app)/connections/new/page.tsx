// New Connector — /admin/connections/new?type=google_ads|meta_ads
// Simple form to manually register a connector with auth credentials.
// OAuth flows are handled by dedicated OAuth routes (/api/oauth/...) and redirect back here.

import { createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getConnectorDef, isConnectorImplemented } from '@/lib/connectors/registry'
import type { ConnectorType } from '@/lib/types'
import NewConnectorForm from './NewConnectorForm'

export const dynamic = 'force-dynamic'

export default async function NewConnectorPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const sp = await searchParams
  const type = sp.type as ConnectorType | 'google' | undefined

  // ── Virtual Google group setup ──────────────────────────────────────────────
  // 'google' is not a real ConnectorType — it's a UI grouping that triggers
  // a unified OAuth flow creating all 4 Google connector rows at once.
  if (type === 'google') {
    return (
      <div className="max-w-lg">
        <div className="flex items-center gap-2 mb-6 text-sm">
          <Link href="/admin/connections" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
            Data Connections
          </Link>
          <span style={{ color: 'var(--border)' }}>/</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Connect Google</span>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
              style={{ background: '#4285F4' }}
            >
              G
            </div>
            <div>
              <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                Connect Google
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                One sign-in connects Ads, Analytics, Search Console &amp; Business Profile.
              </p>
            </div>
          </div>
          <NewConnectorForm type="google" />
        </div>
      </div>
    )
  }

  if (!type || !isConnectorImplemented(type)) notFound()

  const def = getConnectorDef(type)

  // Check if a connector of this type already exists
  const db = createAdminClient()
  const { data: existing } = await db
    .from('connectors')
    .select('id')
    .eq('type', type)
    .single()

  if (existing) {
    redirect(`/admin/connections/${existing.id}`)
  }

  return (
    <div className="max-w-lg">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/admin/connections" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Data Connections
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Connect {def.label}</span>
      </div>

      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
            style={{ background: def.color }}
          >
            {def.icon}
          </div>
          <div>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Connect {def.label}
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{def.description}</p>
          </div>
        </div>

        <NewConnectorForm type={type} />
      </div>
    </div>
  )
}
