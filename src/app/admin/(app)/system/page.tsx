'use client'

// System — /admin/system
// Sync logs (global + per-client), global backfill, app diagnostics.

import { useEffect, useState, useCallback } from 'react'
import { CaretLeft, CaretRight, ArrowsCounterClockwise } from '@phosphor-icons/react'

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
  triggered_by: string | null
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

const PER_PAGE = 50

interface ActivityRow {
  id:            string
  user_name:     string
  action:        string
  resource_type: string
  resource_id:   string | null
  client_name:   string | null
  meta:          Record<string, unknown>
  created_at:    string
}

const ACTION_BADGE: Record<string, string> = {
  created:    'badge-green',
  updated:    'badge-blue',
  deleted:    'badge-red',
  approved:   'badge-green',
  rejected:   'badge-red',
  generated:  'badge-blue',
  logged_in:  'badge-gray',
  paused:     'badge-amber',
  resumed:    'badge-green',
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m    = Math.floor(diff / 60000)
  if (m < 1)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function metaSummary(meta: Record<string, unknown>): string {
  if (!meta || typeof meta !== 'object') return ''
  const parts: string[] = []
  if (meta.title)  parts.push(String(meta.title))
  if (meta.name)   parts.push(String(meta.name))
  if (meta.count)  parts.push(`Count: ${meta.count}`)
  if (meta.amount_af) parts.push(`$${meta.amount_af}`)
  return parts.join(' · ')
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2)
}

function avatarColor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h},55%,45%)`
}

export default function SystemPage() {
  const [activeTab,     setActiveTab]     = useState<'sync' | 'activity'>('sync')

  // Sync log state
  const [jobs,          setJobs]          = useState<SyncJob[]>([])
  const [total,         setTotal]         = useState(0)
  const [page,          setPage]          = useState(1)
  const [loading,       setLoading]       = useState(true)
  const [filter,        setFilter]        = useState<'all' | 'global' | 'client'>('all')
  const [statusFilter,  setStatusFilter]  = useState<'all' | 'success' | 'error' | 'running'>('all')
  const [clientFilter,  setClientFilter]  = useState<string>('')
  const [clients,       setClients]       = useState<{ id: string; name: string }[]>([])
  const [syncing,       setSyncing]       = useState(false)
  const [syncDays,      setSyncDays]      = useState(90)
  const [syncResults,   setSyncResults]   = useState<GlobalSyncResult[] | null>(null)
  const [syncError,     setSyncError]     = useState('')
  const [clearingStuck, setClearingStuck] = useState(false)

  // Activity log state
  const [actLogs,       setActLogs]       = useState<ActivityRow[]>([])
  const [actTotal,      setActTotal]      = useState(0)
  const [actPage,       setActPage]       = useState(1)
  const [actLoading,    setActLoading]    = useState(false)
  const [actResType,    setActResType]    = useState('')
  const [actAction,     setActAction]     = useState('')

  const fetchActivity = useCallback(async (p: number, resType: string, action: string) => {
    setActLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), per_page: '50' })
      if (resType) params.set('resource_type', resType)
      if (action)  params.set('action', action)
      const res  = await fetch(`/api/admin/activity?${params}`)
      const data = await res.json()
      setActLogs(data.logs ?? [])
      setActTotal(data.total ?? 0)
    } finally {
      setActLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'activity') fetchActivity(actPage, actResType, actAction)
  }, [activeTab, actPage, actResType, actAction, fetchActivity])

  // Fetch client list once for the filter dropdown
  useEffect(() => {
    fetch('/api/admin/clients')
      .then(r => r.ok ? r.json() : { clients: [] })
      .then(d => setClients((d.clients ?? d ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))))
      .catch(() => {})
  }, [])

  const fetchJobs = useCallback(async (p: number, cId?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), per_page: String(PER_PAGE) })
      const resolvedClientId = cId !== undefined ? cId : clientFilter
      if (resolvedClientId) params.set('client_id', resolvedClientId)
      const res  = await fetch(`/api/admin/system/logs?${params}`)
      const data = await res.json()
      setJobs(data.jobs ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter])

  useEffect(() => { fetchJobs(page) }, [fetchJobs, page])

  function changeFilter(f: typeof filter) {
    setFilter(f)
    setPage(1)
  }

  function changeStatusFilter(s: typeof statusFilter) {
    setStatusFilter(s)
    setPage(1)
  }

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
      setPage(1)
      await fetchJobs(1)
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  async function clearStuck() {
    setClearingStuck(true)
    try {
      await fetch('/api/admin/system/logs', { method: 'POST' })
      await fetchJobs(page)
    } finally {
      setClearingStuck(false)
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
  const totalPages   = Math.ceil(total / PER_PAGE)

  const actTotalPages = Math.ceil(actTotal / 50)

  return (
    <div>
      <div className="page-header mb-4">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>System</h1>
        <p className="section-desc mt-0.5">Sync logs, activity history, and diagnostics.</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-5" style={{ borderBottom: '2px solid var(--border)', paddingBottom: '0' }}>
        {(['sync', 'activity'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="text-sm font-medium px-4 py-2"
            style={{
              borderBottom: activeTab === tab ? '2px solid var(--blue)' : '2px solid transparent',
              marginBottom: '-2px',
              color: activeTab === tab ? 'var(--blue)' : 'var(--text-muted)',
              background: 'none',
              cursor: 'pointer', transition: 'color 0.15s',
            }}
          >
            {tab === 'sync' ? 'Sync Logs' : 'Activity Log'}
          </button>
        ))}
      </div>

      {activeTab === 'activity' && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="section-title">Activity Log</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={actResType}
                onChange={e => { setActResType(e.target.value); setActPage(1) }}
                className="input"
                style={{ fontSize: '0.8125rem', padding: '0.25rem 0.5rem', height: 'auto' }}
              >
                <option value="">All Resources</option>
                {['client','topic','post','ledger_entry','connector','connection','content_settings','calendar','user'].map(r => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <select
                value={actAction}
                onChange={e => { setActAction(e.target.value); setActPage(1) }}
                className="input"
                style={{ fontSize: '0.8125rem', padding: '0.25rem 0.5rem', height: 'auto' }}
              >
                <option value="">All Actions</option>
                {['created','updated','deleted','approved','rejected','generated','logged_in'].map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          {actLoading ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : actLogs.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No activity recorded yet.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Resource</th>
                      <th>Client</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actLogs.map(log => (
                      <tr key={log.id}>
                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }} title={new Date(log.created_at).toLocaleString()}>
                          {relativeTime(log.created_at)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{
                              width: 24, height: 24, borderRadius: '50%',
                              background: avatarColor(log.user_name),
                              color: '#fff', fontSize: '0.6875rem', fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                              {initials(log.user_name)}
                            </div>
                            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{log.user_name}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${ACTION_BADGE[log.action] ?? 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
                            {log.action}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                          {log.resource_type}
                          {log.resource_id && (
                            <span style={{ color: 'var(--text-faint)', marginLeft: 4, fontSize: '0.6875rem' }}>
                              {log.resource_id.slice(0, 8)}…
                            </span>
                          )}
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                          {log.client_name ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
                        </td>
                        <td className="text-xs max-w-[200px] truncate" style={{ color: 'var(--text-muted)' }} title={metaSummary(log.meta)}>
                          {metaSummary(log.meta)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {actTotal > 50 && (
                <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {((actPage - 1) * 50) + 1}–{Math.min(actPage * 50, actTotal)} of {actTotal.toLocaleString()}
                  </span>
                  <div className="flex gap-2">
                    <button className="btn btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.25rem 0.625rem', display: 'flex', alignItems: 'center', gap: 4 }}
                      disabled={actPage === 1} onClick={() => setActPage(p => p - 1)}>
                      <CaretLeft size={14} /> Prev
                    </button>
                    <button className="btn btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.25rem 0.625rem', display: 'flex', alignItems: 'center', gap: 4 }}
                      disabled={actPage >= actTotalPages} onClick={() => setActPage(p => p + 1)}>
                      Next <CaretRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'sync' && (
      <>
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
            {syncing ? 'Syncing all clients…' : <><ArrowsCounterClockwise size={13} style={{ marginRight: 5 }} />Sync All Clients</>}
          </button>
          {!syncing && (
            <button onClick={() => fetchJobs(page)} className="btn btn-secondary">
              Refresh Logs
            </button>
          )}
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
            {runningCount > 0 && (
              <>
                <span className="badge badge-amber">{runningCount} running</span>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                  disabled={clearingStuck}
                  onClick={clearStuck}
                >
                  {clearingStuck ? 'Clearing…' : 'Clear Stuck'}
                </button>
              </>
            )}
            {errorCount > 0 && <span className="badge badge-red">{errorCount} errors</span>}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Source filter */}
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {(['all', 'global', 'client'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => changeFilter(f)}
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
                  onClick={() => changeStatusFilter(s)}
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
            {/* Client filter */}
            {clients.length > 0 && (
              <select
                className="input"
                style={{ fontSize: '0.75rem', padding: '4px 8px', height: 32, minWidth: 160 }}
                value={clientFilter}
                onChange={e => {
                  const val = e.target.value
                  setClientFilter(val)
                  setPage(1)
                  fetchJobs(1, val)
                }}
              >
                <option value="">All clients</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No sync jobs match the current filter.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Client</th>
                    <th>Platform</th>
                    <th>Triggered By</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Records</th>
                    <th style={{ textAlign: 'right' }}>Duration</th>
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
                            ? <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                                {job.connector_type.replace(/_/g, ' ')}
                              </span>
                            : <span style={{ color: 'var(--text-faint)' }}>—</span>
                          }
                        </td>
                        <td>
                          {job.triggered_by
                            ? <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                                {job.triggered_by}
                              </span>
                            : <span style={{ color: 'var(--text-faint)' }}>—</span>
                          }
                        </td>
                        <td>
                          <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                            {job.job_type}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[job.status] ?? 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
                            {job.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {job.records_synced != null ? job.records_synced.toLocaleString() : '—'}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {durStr}
                        </td>
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

            {/* Pagination */}
            {total > PER_PAGE && (
              <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {((page - 1) * PER_PAGE) + 1}–{Math.min(page * PER_PAGE, total)} of {total.toLocaleString()}
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8125rem', padding: '0.25rem 0.625rem', display: 'flex', alignItems: 'center', gap: 4 }}
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                  >
                    <CaretLeft size={14} aria-hidden /> Prev
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8125rem', padding: '0.25rem 0.625rem', display: 'flex', alignItems: 'center', gap: 4 }}
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Next <CaretRight size={14} aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </>
      )}
    </div>
  )
}
