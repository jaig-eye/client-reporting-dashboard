// Admin Overview — /admin
// Quick-glance stats and shortcuts for the agency admin.

import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import PreviewButton from '@/components/admin/PreviewButton'

export const dynamic = 'force-dynamic'

export default async function AdminOverviewPage() {
  const db = createAdminClient()

  const [clientsRes, connectorsRes, jobsRes] = await Promise.all([
    db.from('clients').select('id, name, created_at').order('created_at', { ascending: false }),
    db.from('connectors').select('id, type, label, status'),
    db.from('sync_jobs').select('id, status').order('started_at', { ascending: false }).limit(50),
  ])

  const clients        = clientsRes.data    ?? []
  const connectors     = connectorsRes.data ?? []
  const recentJobs     = jobsRes.data       ?? []
  const activeConns    = connectors.filter(c => c.status === 'active').length
  const errorConns     = connectors.filter(c => c.status === 'error').length
  const recentErrors   = recentJobs.filter(j => j.status === 'error').length

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <Link href="/admin/clients/new" className="btn btn-primary">+ Add Client</Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Clients" value={clients.length} href="/admin/clients" color="blue" />
        <StatCard label="Active Connectors" value={activeConns} href="/admin/connections" color="green"
          sub={errorConns > 0 ? `${errorConns} with errors` : undefined} subColor={errorConns > 0 ? 'red' : undefined} />
        <StatCard label="Total Connectors" value={connectors.length} href="/admin/connections" />
        <StatCard label="Recent Sync Errors" value={recentErrors} href="/admin/connections"
          color={recentErrors > 0 ? 'red' : 'default'} />
      </div>

      {/* Two columns: recent clients + connector status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Recent Clients</h2>
            <Link href="/admin/clients" className="text-xs" style={{ color: 'var(--blue)' }}>View all →</Link>
          </div>
          {clients.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No clients yet. <Link href="/admin/clients/new" style={{ color: 'var(--blue)' }}>Add your first →</Link>
            </p>
          ) : (
            <div className="space-y-1">
              {clients.slice(0, 8).map(c => (
                <div key={c.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--bg-subtle)]">
                  <Link href={`/admin/clients/${c.id}`} style={{ textDecoration: 'none', flex: 1 }}>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                  </Link>
                  <PreviewButton clientId={c.id} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Data Connections</h2>
            <Link href="/admin/connections" className="text-xs" style={{ color: 'var(--blue)' }}>Manage →</Link>
          </div>
          {connectors.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No connectors configured. <Link href="/admin/connections" style={{ color: 'var(--blue)' }}>Set one up →</Link>
            </p>
          ) : (
            <div className="space-y-2">
              {connectors.map(c => (
                <div key={c.id} className="flex items-center justify-between py-2 px-3 rounded-lg"
                  style={{ background: 'var(--bg-subtle)' }}>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {c.label || c.type.replace(/_/g, ' ')}
                  </span>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, href, color = 'default', sub, subColor }: {
  label: string; value: number; href: string
  color?: 'blue' | 'green' | 'red' | 'default'
  sub?: string; subColor?: 'red' | 'green'
}) {
  const colors = { blue: 'var(--blue)', green: 'var(--green)', red: 'var(--red)', default: 'var(--text-primary)' }
  return (
    <Link href={href} className="card p-5 card-hover block" style={{ textDecoration: 'none' }}>
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-3xl font-bold" style={{ color: colors[color] }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: subColor === 'red' ? 'var(--red)' : 'var(--text-faint)' }}>{sub}</p>}
    </Link>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { active: 'badge-green', error: 'badge-red', disconnected: 'badge-gray', pending: 'badge-amber' }
  const labels: Record<string, string> = { active: 'Active', error: 'Error', disconnected: 'Disconnected', pending: 'Pending' }
  return <span className={`badge ${map[status] ?? 'badge-gray'}`}>{labels[status] ?? status}</span>
}
