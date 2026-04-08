// ─────────────────────────────────────────────────────────────────────────────
// Authority (Ahrefs) Page — /dashboard/seo/authority
// Placeholder — Ahrefs has no public API. Shows coming soon state.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import type { Client } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function AuthorityPage() {
  const cookieStore = await cookies()
  const db          = createAdminClient()

  const token = cookieStore.get('client_token')?.value
  if (!token) redirect('/access')

  const { data: clientData } = await db.from('clients').select('*').eq('dashboard_token', token).single()
  const client = clientData as Client | null
  if (!client) redirect('/access')

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <header className="sticky top-0 z-10 border-b" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-2">
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f26722' }} />
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>SEO — Authority</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{client.name}</span>
          <span style={{
            marginLeft: 4,
            display: 'inline-flex', alignItems: 'center',
            padding: '1px 7px', borderRadius: 9999,
            background: '#fef3c7', color: '#92400e',
            fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            Coming Soon
          </span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-16 flex flex-col items-center text-center">
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'var(--bg-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2rem', marginBottom: '1.5rem',
        }}>
          🔗
        </div>

        <h1 className="text-xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
          Authority Metrics — Coming Soon
        </h1>

        <p className="text-sm max-w-md mb-8" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Connect your Ahrefs account to track Domain Rating, referring domains, total backlinks,
          and organic keyword rankings — all in one place.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-xl mb-10">
          {[
            { icon: '🏆', label: 'Domain Rating', desc: 'Track DR over time' },
            { icon: '🔗', label: 'Backlinks',     desc: 'Monitor new & lost links' },
            { icon: '🔑', label: 'Keywords',      desc: 'Organic keyword rankings' },
          ].map(item => (
            <div key={item.label} className="card p-5 text-left" style={{ opacity: 0.6 }}>
              <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>{item.icon}</div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.label}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{item.desc}</p>
            </div>
          ))}
        </div>

        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Reach out to your account manager to get notified when this integration is available.
        </p>
      </main>
    </div>
  )
}
