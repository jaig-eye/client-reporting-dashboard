'use client'

// System — /admin/system
// Sync logs (global + per-client), global backfill, app diagnostics.

import { useEffect, useState, useCallback } from 'react'

interface SyncJob {
  id: string
  connection_id: string | null
  client_id: string | null
  job_type: string
  status: string
  records_synced: number | null
  error_message: string | null
  date_from: string | null
  date_to: string | null
  started_at: string
  completed_at: string | null
  client_name?: string
  connector_type?: string
}

interface GlobalSyncResult {
  client_id: string
  client_name: string
  records: number
  error?: string
}

const STATUS_BADGE: Record<string, string> = {
  success: 'badge-green',
  error:   'badge-red',
  running: 'badge-amber',
}

export default function SystemPage() {
  const [jobs,       setJobs]       = useState<SyncJob[]>([])
  const [loading,    setLoading]    = useState(true)
  const [filter,     setFilter]     = useState<'all' | 'global' | 'client'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error' | 'running'>('all')
  const [syncing,    setSyncing]    = useState(false)
  const [syncDays,   setSyncDays]   = useState(90)
  const [syncResults, setSyncResults] = useState<GlobalSyncResult[] | null>(null)
  const [syncError,  setSyncError]  = useState('')

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/system/logs')
      const data = await res.json()
      setJobs(data.jobs ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  async function runGlobalSync() {
    setSyncing(true)
    setSyncResults(null)
    setSyncError('')
    try {
      const res  = await fetch('/api/admin/sync/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: syncDays }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSyncResults(data.results ?? [])
      await fetchJobs()
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  const filtered = jobs.filter(j => {
    if (filter === 'global' && j.client_id !== null) return false
    if (filter === 'client' && j.client_id === null)  return false
    if (statusFilter !== 'all' && j.status !== statusFilter) return false
    return true
  })

  const errorCount   = jobs.filter(j => j.status === 'error').length
  const runningCount = jobs.filter(j => j.status === 'running').length

  return (
    <div>
      <div className="page-header mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>System</h1>
        <p className="section-desc mt-0.5">Sync logs, global backfill, and diagnostics.</p>
      </div>

      {/* ── Global Backfill ────────────────────────────────────────────── */}
      <div className="card p-5 mb-5">
        <h2 className="section-title mb-1">Global Historical Sync</h2>
        <p className="section-desc mb-4">
          Pulls historical ad data for all clients. Runs sequentially — may take several minutes.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Days back</label>
            <input
              type="number" min={7} max={730} step={1}
              value={syncDays}
              onChange={e => setSyncDays(parseInt(e.target.value) || 90)}
              className="input"
              style={{ width: '80px' }}
            />
          </div>
          <button
            onClick={runGlobalSync}
            disabled={syncing}
            className="btn btn-primary"
          >
            {syncing ? 'Syncing all clients…' : 'Sync All Clients'}
          </button>
          {!syncing && <button onClick={fetchJobs} className="btn btn-secondary">Refresh Logs</button>}
        </div>

        {syncError && (
          <p className="text-sm mt-3" style={{ color: 'var(--red)' }}>{syncError}</p>
        )}

        {syncResults && (
          <div className="mt-4 space-y-1">
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
              Results — {syncResults.reduce((s, r) => s + r.records, 0).toLocaleString()} total rows synced
            </p>
            {syncResults.map(r => (
              <div key={r.client_id} className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>{r.client_name}</span>
                {r.error
                  ? <span className="badge badge-red text-xs truncate max-w-[240px]" title={r.error}>Error: {r.error}</span>
                  : <span className="badge badge-green">{r.records.toLocaleString()} rows</span>
                }
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Sync Logs ─────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h2 className="section-title">Sync Logs</h2>
            {runningCount > 0 && <span className="badge badge-amber">{runningCount} running</span>}
            {errorCount   > 0 && <span className="badge badge-red">{errorCount} errors</span>}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Source filter */}
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {(['all', 'global', 'client'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="text-xs px-3 py-1.5 font-medium transition-colors"
                  style={{
                    background: filter === f ? 'var(--blue)' : 'var(--bg-base)',
                    color: filter === f ? '#fff' : 'var(--text-muted)',
                    borderRight: f !== 'client' ? '1px solid var(--border)' : undefined,
                  }}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            {/* Status filter */}
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {(['all', 'success', 'error', 'running'] as const).map((s, i, arr) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className="text-xs px-3 py-1.5 font-medium transition-colors"
                  style={{
                    background: statusFilter === s ? 'var(--blue)' : 'var(--bg-base)',
                    color: statusFilter === s ? '#fff' : 'var(--text-muted)',
                    borderRight: i < arr.length - 1 ? '1px solid var(--border)' : undefined,
                  }}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No sync jobs match the current filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Client</th>
                  <th>Platform</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Records</th>
                  <th>Duration</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(job => {
                  const started  = new Date(job.started_at)
                  const finished = job.completed_at ? new Date(job.completed_at) : null
                  const durMs    = finished ? finished.getTime() - started.getTime() : null
                  const durStr   = durMs != null
                    ? durMs < 1000 ? `${durMs}ms` : `${(durMs / 1000).toFixed(1)}s`
                    : job.status === 'running' ? 'running…' : '—'

                  return (
                    <tr key={job.id}>
                      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {started.toLocaleString('en-US', {
                          month: 'short', day: 'numeric',
                          hour: 'numeric', minute: '2-digit',
                        })}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {job.client_name ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
                      </td>
                      <td>
                        {job.connector_type
                          ? <span className="badge badge-gray">{job.connector_type.replace('_', ' ')}</span>
                          : <span style={{ color: 'var(--text-faint)' }}>—</span>
                        }
                      </td>
                      <td>
                        <span className="badge badge-gray">{job.job_type}</span>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[job.status] ?? 'badge-gray'}`}>
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
  )
}
