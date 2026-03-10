// System — /admin/system
// Diagnostic information: app version, environment, sync status, and cron health.

import { createAdminClient } from '@/lib/supabase/server'
import type { SyncJob } from '@/lib/types'
import { ALL_CONNECTOR_TYPES, getConnectorDef } from '@/lib/connectors/registry'

export const dynamic = 'force-dynamic'

export default async function SystemPage() {
  const db = createAdminClient()

  const [settingsRes, recentJobsRes, clientCountRes, connectorCountRes] = await Promise.all([
    db.from('agency_settings').select('app_version, cron_enabled, updated_at').single(),
    db.from('sync_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20),
    db.from('clients').select('id', { count: 'exact', head: true }),
    db.from('connectors').select('id', { count: 'exact', head: true }),
  ])

  const settings      = settingsRes.data
  const recentJobs    = (recentJobsRes.data ?? []) as SyncJob[]
  const clientCount   = clientCountRes.count ?? 0
  const connectorCount = connectorCountRes.count ?? 0

  const successJobs = recentJobs.filter(j => j.status === 'success').length
  const errorJobs   = recentJobs.filter(j => j.status === 'error').length
  const runningJobs = recentJobs.filter(j => j.status === 'running').length

  return (
    <div>
      <div className="page-header mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>System</h1>
        <p className="section-desc mt-0.5">Diagnostics, sync history, and environment status.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── App info ── */}
        <div className="card p-5">
          <h2 className="section-title mb-4">Application</h2>
          <div className="space-y-3 text-sm">
            <InfoRow label="Version"      value={settings?.app_version ? `v${settings.app_version}` : '—'} />
            <InfoRow label="Environment"  value={process.env.NODE_ENV ?? '—'} />
            <InfoRow label="Clients"      value={String(clientCount)} />
            <InfoRow label="Connectors"   value={String(connectorCount)} />
            <InfoRow label="Cron Sync"    value={settings?.cron_enabled === false ? 'Disabled' : 'Enabled'} />
          </div>
        </div>

        {/* ── Connector types ── */}
        <div className="card p-5">
          <h2 className="section-title mb-4">Connector Registry</h2>
          <div className="space-y-2">
            {ALL_CONNECTOR_TYPES.map(type => {
              const def = getConnectorDef(type)
              const implemented = ['google_ads', 'meta_ads'].includes(type)
              return (
                <div key={type} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-6 w-6 rounded flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ background: implemented ? def.color : '#d1d5db' }}
                    >
                      {def.icon}
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>{def.label}</span>
                  </div>
                  <span className={`badge ${implemented ? 'badge-green' : 'badge-gray'}`}>
                    {implemented ? 'Implemented' : 'Planned'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Recent sync jobs ── */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Recent Sync Jobs</h2>
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              {runningJobs > 0 && <span className="badge badge-amber">{runningJobs} running</span>}
              <span>{successJobs} succeeded</span>
              {errorJobs > 0 && <span className="badge badge-red">{errorJobs} errors</span>}
            </div>
          </div>

          {recentJobs.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No sync jobs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Records</th>
                    <th>Duration</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map(job => {
                    const started  = new Date(job.started_at)
                    const finished = job.completed_at ? new Date(job.completed_at) : null
                    const durMs    = finished ? finished.getTime() - started.getTime() : null
                    const durStr   = durMs != null
                      ? durMs < 1000 ? `${durMs}ms` : `${(durMs / 1000).toFixed(1)}s`
                      : '—'

                    return (
                      <tr key={job.id}>
                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {started.toLocaleString('en-US', {
                            month: 'short', day: 'numeric',
                            hour: 'numeric', minute: '2-digit',
                          })}
                        </td>
                        <td>
                          <span className="badge badge-gray">{job.job_type}</span>
                        </td>
                        <td>
                          <span className={`badge ${
                            job.status === 'success' ? 'badge-green' :
                            job.status === 'error'   ? 'badge-red'   :
                            job.status === 'running' ? 'badge-amber'  : 'badge-gray'
                          }`}>
                            {job.status}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>
                          {job.records_synced != null ? job.records_synced.toLocaleString() : '—'}
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>{durStr}</td>
                        <td
                          className="text-xs max-w-[220px] truncate"
                          style={{ color: 'var(--red)' }}
                          title={job.error_message ?? undefined}
                        >
                          {job.error_message ?? ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  )
}
