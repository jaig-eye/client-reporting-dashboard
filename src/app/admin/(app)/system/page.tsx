'use client'

// System — /admin/system
// Sync logs (global + per-client), global backfill, and the activity log.

import '@/styles/admin/system.css'
import Link from 'next/link'
import { useEffect, useState, useCallback, Fragment } from 'react'
import {
  CaretLeft, CaretRight, ArrowsCounterClockwise, ArrowClockwise, CircleNotch, CheckCircle,
  ClockCounterClockwise, ListMagnifyingGlass, FunnelSimple,
} from '@phosphor-icons/react'
import ClientManualSync from '@/app/admin/(app)/clients/[id]/ClientManualSync'
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import BrandLogo, { BRAND_NAMES } from '@/components/ui/BrandLogo'
import Tile from '@/components/ui/Tile'
import EmptyState from '@/components/ui/EmptyState'
import { PillTabs } from '@/components/ui/PillTabs'
import { SkTable, SkRows } from '@/components/ui/Skeleton'

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

const STATUS: Record<string, { tone: StatusTone; label: string; live?: boolean }> = {
  success: { tone: 'success', label: 'Done' },
  error:   { tone: 'danger',  label: 'Failed' },
  running: { tone: 'warning', label: 'Running', live: true },
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

const ACTION_TONE: Record<string, StatusTone> = {
  created:    'success',
  updated:    'info',
  deleted:    'danger',
  approved:   'success',
  rejected:   'danger',
  generated:  'info',
  logged_in:  'neutral',
  paused:     'warning',
  resumed:    'success',
}

const RESOURCE_TYPES = ['client', 'topic', 'post', 'ledger_entry', 'connector', 'connection', 'content_settings', 'calendar', 'user']
const ACTIONS        = ['created', 'updated', 'deleted', 'approved', 'rejected', 'generated', 'logged_in']

const TRIGGER_LABEL: Record<string, string> = { cron: 'Schedule', admin: 'Admin', system: 'System' }

/** snake_case → "Sentence case". */
function humanize(s: string): string {
  const t = s.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function sourceName(type: string): string {
  return BRAND_NAMES[type] ?? humanize(type)
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

function fmtStarted(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fmtDuration(job: SyncJob): string {
  if (!job.completed_at) return job.status === 'running' ? 'Running…' : '—'
  const ms = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
  if (ms < 1000)  return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function Pager({ page, total, perPage, onPage, label }: { page: number; total: number; perPage: number; onPage: (p: number) => void; label: string }) {
  if (total <= perPage) return null
  const pages = Math.ceil(total / perPage)
  return (
    <nav className="sy-pager" aria-label={label}>
      <span className="sy-pager-count">{((page - 1) * perPage) + 1}–{Math.min(page * perPage, total)} of {total.toLocaleString()}</span>
      <span className="sy-pager-btns">
        <button type="button" className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => onPage(page - 1)}>
          <CaretLeft size={14} aria-hidden />Previous
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next<CaretRight size={14} aria-hidden />
        </button>
      </span>
    </nav>
  )
}

function ListSkeleton({ cols }: { cols: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="sy-sk-wide"><SkTable rows={8} cols={cols} /></div>
      <div className="sy-sk-list"><SkRows rows={6} /></div>
    </div>
  )
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
  const [clearingStuck,       setClearingStuck]       = useState(false)
  const [selectedClientId,    setSelectedClientId]    = useState<string>('')

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
    // Auto-clear stuck jobs (>8 min) silently on every fetch so they don't linger
    fetch('/api/admin/system/logs', { method: 'POST' }).catch(() => {})
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
      const res = await fetch('/api/admin/sync/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: syncDays }),
      })
      let data: { results?: GlobalSyncResult[]; error?: string } = {}
      try {
        data = await res.json()
      } catch {
        throw new Error(
          res.status === 504
            ? 'Sync timed out — data was partially saved. Try a shorter date range.'
            : `Server error (${res.status})`
        )
      }
      if (!res.ok) throw new Error(data.error || `Server error (${res.status})`)
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
  const syncFiltersOn = filter !== 'all' || statusFilter !== 'all' || !!clientFilter

  function resetSyncFilters() {
    setFilter('all')
    setStatusFilter('all')
    setClientFilter('')
    setPage(1)
  }

  // ─── sync log cells ────────────────────────────────────────────────────────

  function clientCell(job: SyncJob) {
    if (job.client_id && job.client_name) return <Link href={`/admin/clients/${job.client_id}`} className="sy-client">{job.client_name}</Link>
    if (job.client_name) return <span>{job.client_name}</span>
    return <span className="sy-faint">{job.client_id ? '—' : 'Agency-wide'}</span>
  }

  function statusBadge(status: string) {
    const s = STATUS[status] ?? { tone: 'neutral' as StatusTone, label: humanize(status) }
    return <StatusBadge tone={s.tone} live={s.live}>{s.label}</StatusBadge>
  }

  const syncResultsTotal = syncResults?.reduce((s, r) => s + r.records, 0) ?? 0
  const syncResultsFailed = syncResults?.filter(r => r.error).length ?? 0

  return (
    <div>
      <PageHeader
        title="System & logs"
        description="Every sync run with its result, manual syncs when data needs pulling again, and a record of who changed what."
      />

      <div className="sy-tabs">
        <PillTabs
          label="System sections"
          idPrefix="sy"
          activeId={activeTab}
          onSelect={id => setActiveTab(id as 'sync' | 'activity')}
          items={[
            { id: 'sync',     label: 'Sync logs', icon: <ArrowsCounterClockwise size={15} /> },
            { id: 'activity', label: 'Activity',  icon: <ClockCounterClockwise size={15} /> },
          ]}
        />
      </div>

      {activeTab === 'activity' && (
        <div className="sy-panel" role="tabpanel" id="sy-panel-activity" aria-labelledby="sy-tab-activity">
          <Section
            flush
            title="Activity"
            description="Who created, changed, approved or deleted what, newest first."
          >
            <div className="sy-toolbar">
              <div className="sy-filters">
                <select
                  aria-label="Resource"
                  value={actResType}
                  onChange={e => { setActResType(e.target.value); setActPage(1) }}
                  className={`input sy-select${actResType ? ' sy-select--on' : ''}`}
                >
                  <option value="">Any resource</option>
                  {RESOURCE_TYPES.map(r => <option key={r} value={r}>{humanize(r)}</option>)}
                </select>
                <select
                  aria-label="Action"
                  value={actAction}
                  onChange={e => { setActAction(e.target.value); setActPage(1) }}
                  className={`input sy-select${actAction ? ' sy-select--on' : ''}`}
                >
                  <option value="">Any action</option>
                  {ACTIONS.map(a => <option key={a} value={a}>{humanize(a)}</option>)}
                </select>
              </div>
            </div>

            {actLoading ? (
              <ListSkeleton cols={6} />
            ) : actLogs.length === 0 ? (
              actResType || actAction ? (
                <EmptyState
                  icon={<FunnelSimple size={20} />}
                  title="Nothing matches these filters"
                  actions={<button type="button" className="btn btn-secondary" onClick={() => { setActResType(''); setActAction(''); setActPage(1) }}>Clear filters</button>}
                />
              ) : (
                <EmptyState icon={<ClockCounterClockwise size={20} />} title="No activity recorded yet">
                  Changes to clients, content, billing and connections show up here as people make them.
                </EmptyState>
              )
            ) : (
              <>
                <div className="sy-wide ui-scroll-x">
                  <table className="ui-table sy-table">
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
                          <td className="sy-when" title={new Date(log.created_at).toLocaleString()}>{relativeTime(log.created_at)}</td>
                          <td>
                            <span className="sy-user">
                              <Tile size="sm" tone="accent" className="sy-avatar">{initials(log.user_name)}</Tile>
                              {log.user_name}
                            </span>
                          </td>
                          <td><StatusBadge tone={ACTION_TONE[log.action] ?? 'neutral'}>{humanize(log.action)}</StatusBadge></td>
                          <td className="sy-resource">
                            {humanize(log.resource_type)}
                            {log.resource_id && <span className="sy-id" title={log.resource_id}>{log.resource_id.slice(0, 8)}</span>}
                          </td>
                          <td>{log.client_name ?? <span className="sy-faint">—</span>}</td>
                          <td><span className="sy-details" title={metaSummary(log.meta)}>{metaSummary(log.meta) || <span className="sy-faint">—</span>}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="sy-list">
                  {actLogs.map(log => {
                    const details = [humanize(log.resource_type), log.client_name, metaSummary(log.meta)].filter((x): x is string => !!x)
                    return (
                      <div key={log.id} className="ui-row">
                        <Tile size="sm" tone="accent" className="sy-avatar">{initials(log.user_name)}</Tile>
                        <span className="ui-row-text">
                          <span className="ui-row-title">
                            {log.user_name}
                            <StatusBadge tone={ACTION_TONE[log.action] ?? 'neutral'}>{humanize(log.action)}</StatusBadge>
                          </span>
                          <span className="ui-row-sub sy-facts">{details.map((d, i) => <span key={i}>{d}</span>)}</span>
                        </span>
                        <span className="ui-row-actions"><span className="sy-list-time" title={new Date(log.created_at).toLocaleString()}>{relativeTime(log.created_at)}</span></span>
                      </div>
                    )
                  })}
                </div>

                <Pager page={actPage} total={actTotal} perPage={50} onPage={setActPage} label="Activity pages" />
              </>
            )}
          </Section>
        </div>
      )}

      {activeTab === 'sync' && (
        <div className="sy-panel" role="tabpanel" id="sy-panel-sync" aria-labelledby="sy-tab-sync">
          <div className="ui-grid-2 sy-run">
            {/* ── Per-client sync ─────────────────────────────────────────── */}
            <Section title="Sync one client" description="Pull one client’s data again without touching anyone else’s.">
              <div className="sy-field">
                <label className="sy-field-label" htmlFor="sy-client">Client</label>
                <select
                  id="sy-client"
                  value={selectedClientId}
                  onChange={e => setSelectedClientId(e.target.value)}
                  className="input sy-client-select"
                >
                  <option value="">Choose a client…</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {selectedClientId && <div className="sy-manual"><ClientManualSync clientId={selectedClientId} /></div>}
            </Section>

            {/* ── Global backfill ─────────────────────────────────────────── */}
            <Section title="Sync every client" description="Pulls historical ad data for all clients, one after another. It can take several minutes.">
              <div className="sy-global">
                <label className="sy-field sy-days">
                  <span className="sy-field-label">Days back <span className="sy-field-hint">7–730</span></span>
                  <input
                    type="number" min={7} max={730} step={1}
                    value={syncDays}
                    onChange={e => setSyncDays(parseInt(e.target.value) || 90)}
                    className="input"
                  />
                </label>
                <button type="button" onClick={runGlobalSync} disabled={syncing} className="btn btn-primary">
                  {syncing
                    ? <><CircleNotch size={15} className="sy-spin" aria-hidden />Syncing all clients…</>
                    : <><ArrowsCounterClockwise size={15} aria-hidden />Sync all clients</>}
                </button>
              </div>

              {syncError && <div className="ui-notice ui-notice--danger sy-notice" role="alert">{syncError}</div>}

              {syncResults && (
                <div className="sy-results" role="status">
                  <div className="sy-results-head">
                    <CheckCircle size={15} weight="fill" aria-hidden />
                    {syncResultsTotal.toLocaleString()} rows synced across {syncResults.length} client{syncResults.length === 1 ? '' : 's'}
                    {syncResultsFailed > 0 && `, ${syncResultsFailed} failed`}
                  </div>
                  <ul className="sy-results-list">
                    {syncResults.map(r => (
                      <li key={r.client_id} className="sy-result">
                        <span className="sy-result-name">
                          {r.client_name}
                          {r.error && <span className="sy-result-err">{r.error}</span>}
                        </span>
                        {r.error
                          ? <StatusBadge tone="danger" title={r.error}>Failed</StatusBadge>
                          : <StatusBadge tone="success">{r.records.toLocaleString()} rows</StatusBadge>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          </div>

          {/* ── Sync logs ─────────────────────────────────────────────────── */}
          <Section
            flush
            title="Sync logs"
            description="Every sync run, newest first. Runs stuck for over 8 minutes are cleared whenever this list loads."
            actions={<>
              {runningCount > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={clearingStuck} onClick={clearStuck}>
                  {clearingStuck ? 'Clearing…' : 'Clear stuck runs'}
                </button>
              )}
              <button type="button" onClick={() => fetchJobs(page)} className="btn btn-secondary btn-sm" disabled={syncing || loading}>
                <ArrowClockwise size={14} className={loading ? 'sy-spin' : undefined} aria-hidden />Refresh
              </button>
            </>}
          >
            <div className="sy-toolbar">
              <PillTabs
                label="Filter by result"
                activeId={statusFilter}
                onSelect={id => changeStatusFilter(id as typeof statusFilter)}
                items={[
                  { id: 'all',     label: 'All' },
                  { id: 'success', label: 'Done' },
                  { id: 'error',   label: 'Failed',  count: errorCount, alert: true },
                  { id: 'running', label: 'Running', count: runningCount },
                ]}
              />
              <div className="sy-filters">
                <select
                  aria-label="Scope"
                  className={`input sy-select${filter !== 'all' ? ' sy-select--on' : ''}`}
                  value={filter}
                  onChange={e => changeFilter(e.target.value as typeof filter)}
                >
                  <option value="all">All runs</option>
                  <option value="global">Agency-wide runs</option>
                  <option value="client">Client runs</option>
                </select>
                {clients.length > 0 && (
                  <select
                    aria-label="Client"
                    className={`input sy-select${clientFilter ? ' sy-select--on' : ''}`}
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
              <ListSkeleton cols={7} />
            ) : filtered.length === 0 ? (
              syncFiltersOn ? (
                <EmptyState
                  icon={<FunnelSimple size={20} />}
                  title="No sync runs match these filters"
                  actions={<button type="button" className="btn btn-secondary" onClick={resetSyncFilters}>Show all runs</button>}
                >
                  Filters apply to this page of runs. Try another page or clear them.
                </EmptyState>
              ) : (
                <EmptyState icon={<ListMagnifyingGlass size={20} />} title="No sync runs yet">
                  Runs show up here as soon as a scheduled or manual sync starts.
                </EmptyState>
              )
            ) : (
              <>
                <div className="sy-wide ui-scroll-x">
                  <table className="ui-table sy-table">
                    <thead>
                      <tr>
                        <th>Started</th>
                        <th>Client</th>
                        <th>Source</th>
                        <th>Trigger</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th className="ui-r">Records</th>
                        <th className="ui-r">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(job => (
                        <Fragment key={job.id}>
                        <tr className={job.status === 'error' ? `sy-tr--error${job.error_message ? ' sy-tr--has-msg' : ''}` : undefined}>
                          <td className="sy-when">{fmtStarted(job.started_at)}</td>
                          <td>{clientCell(job)}</td>
                          <td>
                            {job.connector_type
                              ? <span className="sy-source"><BrandLogo type={job.connector_type} size={16} />{sourceName(job.connector_type)}</span>
                              : <span className="sy-faint">—</span>}
                          </td>
                          <td className="sy-plain">{job.triggered_by ? (TRIGGER_LABEL[job.triggered_by] ?? humanize(job.triggered_by)) : <span className="sy-faint">—</span>}</td>
                          <td className="sy-plain">{humanize(job.job_type)}</td>
                          <td>{statusBadge(job.status)}</td>
                          <td className="ui-r sy-num">{job.records_synced != null ? job.records_synced.toLocaleString() : '—'}</td>
                          <td className="ui-r sy-num">{fmtDuration(job)}</td>
                        </tr>
                        {/* The error gets the row's full width under it instead of a clipped column. */}
                        {job.error_message && (
                          <tr className="sy-tr--error sy-tr--msg">
                            <td aria-hidden /><td colSpan={7}><span className="sy-error" title={job.error_message}>{job.error_message}</span></td>
                          </tr>
                        )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="sy-list">
                  {filtered.map(job => {
                    const what = [
                      job.connector_type ? sourceName(job.connector_type) : null,
                      humanize(job.job_type),
                      job.triggered_by ? (TRIGGER_LABEL[job.triggered_by] ?? humanize(job.triggered_by)) : null,
                    ].filter((x): x is string => !!x)
                    const facts = [
                      fmtStarted(job.started_at),
                      job.records_synced != null ? `${job.records_synced.toLocaleString()} records` : null,
                      fmtDuration(job),
                    ].filter((x): x is string => !!x)
                    return (
                      <div key={job.id} className={`ui-row${job.status === 'error' ? ' sy-row--error' : ''}`}>
                        {job.connector_type
                          ? <BrandLogo type={job.connector_type} size={16} tile tileSize="sm" />
                          : <Tile size="sm"><ArrowsCounterClockwise size={14} /></Tile>}
                        <span className="ui-row-text">
                          <span className="ui-row-title">
                            {job.client_name ?? 'Agency-wide'}
                          </span>
                          <span className="ui-row-sub sy-facts">{what.map((f, i) => <span key={i}>{f}</span>)}</span>
                          <span className="ui-row-sub sy-facts">{facts.map((f, i) => <span key={i}>{f}</span>)}</span>
                          {job.error_message && <span className="ui-row-sub sy-list-err">{job.error_message.slice(0, 200)}{job.error_message.length > 200 ? '…' : ''}</span>}
                        </span>
                        <span className="ui-row-actions">{statusBadge(job.status)}</span>
                      </div>
                    )
                  })}
                </div>

              </>
            )}
            {!loading && <Pager page={page} total={total} perPage={PER_PAGE} onPage={setPage} label="Sync log pages" />}
          </Section>
        </div>
      )}
    </div>
  )
}
