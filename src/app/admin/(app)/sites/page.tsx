'use client'

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { GlobeSimple, Plus, MagnifyingGlass, ArrowClockwise, PencilSimple, TrashSimple, DownloadSimple, X } from '@phosphor-icons/react'

const PLATFORMS = ['wordpress', 'ghl', 'bigcommerce', 'shopify', 'custom', 'other'] as const
const HOSTING_TYPES = ['ours', 'client'] as const
const STATUSES = ['active', 'paused', 'archived'] as const

interface Site {
  id:               string
  name:             string
  url:              string
  platform:         string
  hosting_type:     string
  hosting_provider: string | null
  server_account:   string | null
  status:           string
  notes:            string | null
  is_up:            boolean | null
  last_checked_at:  string | null
  last_status_code: number | null
  last_response_ms: number | null
  uptime_7d:        number | null
  ssl_days_remaining: number | null
  ssl_expires_at:   string | null
  consecutive_failures: number
  client_id:        string | null
  group_id:         string | null
  discord_channel_id: string | null
  clients:          { id: string; name: string } | null
  site_groups:      { id: string; name: string } | null
  audit_enabled:    boolean
  audit_scope:      string
  last_audit_at:    string | null
  audit_score:      number | null
  audit_errors:     number | null
  audit_warnings:   number | null
}

interface Group  { id: string; name: string }
interface Client { id: string; name: string; website: string | null }

interface AuditPageRow {
  url: string; score: number | null
  errors: number; warnings: number; title: string | null
  h1_count: number; has_schema: boolean; has_canonical: boolean
  issues: { type: string; sev: string; msg: string }[]
}

const EMPTY_FORM = {
  name: '', url: '', client_id: '', platform: 'custom', hosting_type: 'client',
  hosting_provider: '', server_account: '', group_id: '', status: 'active', notes: '',
  discord_channel_id: '',
}

function StatusDot({ isUp, status }: { isUp: boolean | null; status: string }) {
  if (status !== 'active') return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d1d5db', display: 'inline-block' }} title="Paused / archived" />
  if (isUp === null)  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9ca3af', display: 'inline-block' }} title="Not yet checked" />
  if (isUp)           return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} title="Up" />
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 0 3px rgba(239,68,68,0.20)', display: 'inline-block' }} title="Down" />
}

function SslBadge({ days }: { days: number | null }) {
  if (days === null) return <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</span>
  const color = days <= 7 ? '#ef4444' : days <= 30 ? '#f59e0b' : '#10b981'
  return <span style={{ fontSize: '0.75rem', fontWeight: 600, color }}>{days}d</span>
}

function PlatformBadge({ p }: { p: string }) {
  const colors: Record<string, string> = {
    wordpress: '#21759b', ghl: '#0ea5e9', bigcommerce: '#121118',
    shopify: '#5cb85c', custom: '#6b7280', other: '#9ca3af',
  }
  return (
    <span style={{
      fontSize: '0.625rem', fontWeight: 700, padding: '2px 6px', borderRadius: 999,
      background: colors[p] ?? '#6b7280', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{p}</span>
  )
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function detectPlatform(url: string): string {
  const lower = url.toLowerCase()
  if (lower.includes('gohighlevel') || lower.includes('.ghl.'))  return 'ghl'
  if (lower.includes('bigcommerce'))                              return 'bigcommerce'
  if (lower.includes('myshopify'))                               return 'shopify'
  return 'custom'
}

export default function SitesPage() {
  const [sites,   setSites]   = useState<Site[]>([])
  const [allMonitoredClientIds, setAllMonitoredClientIds] = useState<Set<string>>(new Set())
  const [groups,  setGroups]  = useState<Group[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [wpUrlsByClient,  setWpUrlsByClient]  = useState<Record<string, string>>({})
  const [gscUrlsByClient, setGscUrlsByClient] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [importDismissed, setImportDismissed] = useState(false)

  // Filters
  const [search,          setSearch]          = useState('')
  const [filterStatus,    setFilterStatus]    = useState('')
  const [filterPlatform,  setFilterPlatform]  = useState('')
  const [filterUp,        setFilterUp]        = useState('')
  const [filterGroup,     setFilterGroup]     = useState('')

  // Modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editSite,  setEditSite]  = useState<Site | null>(null)
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState('')

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Audit expand / data
  const [openAuditId,  setOpenAuditId]  = useState<string | null>(null)
  const [auditPages,   setAuditPages]   = useState<Record<string, AuditPageRow[]>>({})
  const [auditLoading, setAuditLoading] = useState<Set<string>>(new Set())
  const [auditError,   setAuditError]   = useState('')

  // Import all unmonitored sites at once
  const [importing, setImporting] = useState(false)

  const fetchSites = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (search)         params.set('q', search)
    if (filterStatus)   params.set('status', filterStatus)
    if (filterPlatform) params.set('platform', filterPlatform)
    if (filterUp)       params.set('is_up', filterUp)
    if (filterGroup)    params.set('group_id', filterGroup)

    const res = await fetch(`/api/admin/sites?${params.toString()}`)
    if (!res.ok) { setError('Failed to load sites'); setLoading(false); return }
    const data = await res.json()
    setSites(data.sites ?? [])
    setGroups(data.groups ?? [])
    // Build client_id → first known URL maps from wp_sites and GSC connections
    const wpMap:  Record<string, string> = {}
    const gscMap: Record<string, string> = {}
    for (const row of (data.wpSites ?? []) as { client_id: string; site_url: string }[]) {
      if (!wpMap[row.client_id]) wpMap[row.client_id] = row.site_url
    }
    for (const row of (data.gscUrls ?? []) as { client_id: string; url: string }[]) {
      if (!gscMap[row.client_id]) gscMap[row.client_id] = row.url
    }
    setWpUrlsByClient(wpMap)
    setGscUrlsByClient(gscMap)
    setLoading(false)
  }, [search, filterStatus, filterPlatform, filterUp, filterGroup])

  const fetchClients = useCallback(async () => {
    const res = await fetch('/api/admin/clients')
    if (!res.ok) return
    const data = await res.json()
    setClients(data.clients ?? [])
  }, [])

  const fetchAllMonitoredClientIds = useCallback(async () => {
    const res = await fetch('/api/admin/sites')
    if (!res.ok) return
    const data = await res.json()
    setAllMonitoredClientIds(new Set((data.sites ?? []).map((s: Site) => s.client_id).filter(Boolean)))
  }, [])

  useEffect(() => { fetchSites() }, [fetchSites])
  useEffect(() => { fetchClients() }, [fetchClients])
  useEffect(() => { fetchAllMonitoredClientIds() }, [fetchAllMonitoredClientIds])

  // DOWN-first sort: down → active/unchecked → active/up → paused/archived, then alpha
  const sortedSites = useMemo(() => {
    const rank = (s: Site) => {
      if (s.status !== 'active') return 4
      if (s.is_up === false)     return 1
      if (s.is_up === null)      return 2
      return 3
    }
    return [...sites].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [sites])

  // Clients that have a known URL (profile, WordPress, or GSC) but no site record yet
  const unmonitoredClients = useMemo(() => {
    if (loading) return []
    return clients.filter(c => {
      const hasUrl = !!(c.website?.trim() || wpUrlsByClient[c.id] || gscUrlsByClient[c.id])
      return hasUrl && !allMonitoredClientIds.has(c.id)
    })
  }, [clients, allMonitoredClientIds, wpUrlsByClient, gscUrlsByClient, loading])

  // URL suggestion + source label for the selected client in the modal
  // Priority: profile website > WordPress connection > GSC property
  // Trim client.website to guard against whitespace-only values saved via the profile form.
  const suggestedUrl = useMemo((): { url: string; source: string } | null => {
    if (!form.client_id) return null
    const client = clients.find(c => c.id === form.client_id)
    const profileUrl = client?.website?.trim() ?? ''
    if (profileUrl)                      return { url: profileUrl,                      source: 'Profile' }
    if (wpUrlsByClient[form.client_id])  return { url: wpUrlsByClient[form.client_id],  source: 'WordPress' }
    if (gscUrlsByClient[form.client_id]) return { url: gscUrlsByClient[form.client_id], source: 'GSC' }
    return null
  }, [form.client_id, clients, wpUrlsByClient, gscUrlsByClient])

  async function handleImportAll() {
    if (!unmonitoredClients.length || importing) return
    setImporting(true)
    await Promise.allSettled(
      unmonitoredClients.map(c => {
        const url = c.website?.trim() || wpUrlsByClient[c.id] || gscUrlsByClient[c.id] || ''
        if (!url) return Promise.resolve()
        return fetch('/api/admin/sites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: c.name, url, client_id: c.id, platform: detectPlatform(url) }),
        })
      })
    )
    setImporting(false)
    setImportDismissed(true)
    await Promise.all([fetchSites(), fetchAllMonitoredClientIds()])
  }

  function openAdd(prefill?: { name: string; url: string; client_id: string; platform: string }) {
    setEditSite(null)
    setForm(prefill
      ? { ...EMPTY_FORM, ...prefill }
      : EMPTY_FORM
    )
    setSaveError('')
    setModalOpen(true)
  }

  function openEdit(site: Site) {
    setEditSite(site)
    setForm({
      name:               site.name,
      url:                site.url,
      client_id:          site.client_id          ?? '',
      platform:           site.platform,
      hosting_type:       site.hosting_type,
      hosting_provider:   site.hosting_provider   ?? '',
      server_account:     site.server_account     ?? '',
      group_id:           site.group_id            ?? '',
      status:             site.status,
      notes:              site.notes               ?? '',
      discord_channel_id: site.discord_channel_id ?? '',
    })
    setSaveError('')
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    const body = {
      name:               form.name.trim(),
      url:                form.url.trim(),
      client_id:          form.client_id          || null,
      platform:           form.platform,
      hosting_type:       form.hosting_type,
      hosting_provider:   form.hosting_provider   || null,
      server_account:     form.server_account     || null,
      group_id:           form.group_id           || null,
      status:             form.status,
      notes:              form.notes              || null,
      discord_channel_id: form.discord_channel_id || null,
    }
    const url    = editSite ? `/api/admin/sites/${editSite.id}` : '/api/admin/sites'
    const method = editSite ? 'PATCH' : 'POST'
    const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { setSaveError(data.error ?? 'Save failed'); setSaving(false); return }
    setModalOpen(false)
    fetchSites()
    setSaving(false)
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/sites/${id}`, { method: 'DELETE' })
    if (res.ok) { setDeleteId(null); fetchSites() }
  }

  async function handleAuditToggle(siteId: string, enabled: boolean, scope: string) {
    setAuditError('')
    setAuditLoading(prev => new Set(prev).add(siteId))
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, scope }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        setAuditError(errData.error ?? 'Audit failed. Please try again.')
        return
      }
      const data = await res.json()
      setSites(prev => prev.map(s => s.id === siteId ? {
        ...s,
        audit_enabled:  enabled,
        audit_scope:    scope,
        ...(data.audit?.score != null && {
          audit_score:    data.audit.score,
          audit_errors:   data.audit.errors,
          audit_warnings: data.audit.warnings,
          last_audit_at:  new Date().toISOString(),
        }),
      } : s))
      if (!data.disabled) loadAuditPages(siteId, true)
    } finally {
      setAuditLoading(prev => { const n = new Set(prev); n.delete(siteId); return n })
    }
  }

  async function loadAuditPages(siteId: string, force = false) {
    if (!force && auditPages[siteId]) return
    const res = await fetch(`/api/admin/sites/${siteId}/audit`)
    if (!res.ok) return
    const data = await res.json()
    if (data.pages) setAuditPages(prev => ({ ...prev, [siteId]: data.pages }))
  }

  async function handleScopeChange(siteId: string, scope: string) {
    const res = await fetch(`/api/admin/sites/${siteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audit_scope: scope }),
    })
    if (!res.ok) return
    setSites(prev => prev.map(s => s.id === siteId ? { ...s, audit_scope: scope } : s))
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--bg-subtle)',
    color: 'var(--text-primary)', fontSize: '0.875rem',
  }
  const labelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <GlobeSimple size={22} style={{ color: 'var(--text-faint)' }} />
          <div>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Sites</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', margin: 0 }}>{sites.length} site{sites.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={fetchSites} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.4375rem 0.875rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', cursor: 'pointer', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            <ArrowClockwise size={14} /> Refresh
          </button>
          <button onClick={() => openAdd()} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.4375rem 0.875rem', borderRadius: 8, border: 'none', background: 'var(--blue)', cursor: 'pointer', fontSize: '0.8125rem', color: '#fff', fontWeight: 600 }}>
            <Plus size={14} /> Add Site
          </button>
        </div>
      </div>

      {/* Unmonitored clients banner */}
      {!importDismissed && !loading && unmonitoredClients.length > 0 && (
        <div style={{
          marginBottom: '1rem', padding: '0.875rem 1rem',
          borderRadius: 10, border: '1px solid #bfdbfe',
          background: '#eff6ff', display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
        }}>
          <DownloadSimple size={16} style={{ color: '#3b82f6', marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#1d4ed8', margin: '0 0 0.5rem' }}>
              {unmonitoredClients.length} client{unmonitoredClients.length !== 1 ? 's have' : ' has'} a website not yet monitored
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {unmonitoredClients.map(c => {
                const url    = c.website?.trim() || wpUrlsByClient[c.id] || gscUrlsByClient[c.id] || ''
                const source = c.website?.trim() ? 'Profile' : wpUrlsByClient[c.id] ? 'WP' : 'GSC'
                return (
                  <button
                    key={c.id}
                    onClick={() => openAdd({
                      name:      c.name,
                      url,
                      client_id: c.id,
                      platform:  detectPlatform(url),
                    })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.375rem',
                      padding: '0.25rem 0.625rem', borderRadius: 999,
                      border: '1px solid #93c5fd', background: '#dbeafe',
                      cursor: 'pointer', fontSize: '0.75rem', color: '#1d4ed8', fontWeight: 500,
                    }}
                  >
                    <Plus size={11} /> {c.name}
                    <span style={{ color: '#60a5fa', fontWeight: 400, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {url.replace(/^https?:\/\//, '')}
                    </span>
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 4px', borderRadius: 4, background: '#bfdbfe', color: '#1d4ed8' }}>
                      {source}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flexShrink: 0, alignItems: 'flex-end' }}>
            <button
              onClick={handleImportAll}
              disabled={importing}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0.3125rem 0.75rem', borderRadius: 7, border: 'none', background: '#3b82f6', color: '#fff', cursor: importing ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600, opacity: importing ? 0.7 : 1, whiteSpace: 'nowrap' }}
            >
              {importing ? 'Importing…' : `Import all ${unmonitoredClients.length}`}
            </button>
            <button onClick={() => setImportDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93c5fd', padding: '0.125rem', fontSize: '0.7rem' }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
          <MagnifyingGlass size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} />
          <input
            placeholder="Search name or URL…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: '2rem' }}
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="">All platforms</option>
          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterUp} onChange={e => setFilterUp(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="">Up / Down</option>
          <option value="true">Up only</option>
          <option value="false">Down only</option>
        </select>
        {groups.length > 0 && (
          <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
            <option value="">All groups</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>

      {/* Audit error banner */}
      {auditError && (
        <div style={{ padding: '0.625rem 0.875rem', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--red)', fontSize: '0.8125rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <span>{auditError}</span>
          <button onClick={() => setAuditError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: '1rem', lineHeight: 1, padding: 0, opacity: 0.6 }}>✕</button>
        </div>
      )}

      {/* Table */}
      {error ? (
        <p style={{ color: 'var(--red)' }}>{error}</p>
      ) : loading ? (
        <p style={{ color: 'var(--text-faint)', padding: '3rem 0', textAlign: 'center' }}>Loading…</p>
      ) : sites.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-faint)' }}>
          <GlobeSimple size={40} style={{ marginBottom: '0.75rem', opacity: 0.3 }} />
          <p style={{ margin: 0 }}>No sites yet — add one to start monitoring</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.8125rem' }}>
            <thead>
              <tr>
                {(['', 'Name', 'Client', '7d Uptime', 'SSL', 'AUDIT_COL', 'Score', ''] as const).map((h, i) => (
                  <th key={i} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>
                    {h === 'AUDIT_COL' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        Audit
                        <span style={{ fontSize: '0.45rem', fontWeight: 700, letterSpacing: '0.05em', background: 'var(--blue)', color: '#fff', padding: '1px 4px', borderRadius: 3, textTransform: 'uppercase' }}>BETA</span>
                      </span>
                    ) : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedSites.map(site => (
                <Fragment key={site.id}>
                  <tr
                    onClick={() => {
                      const next = openAuditId === site.id ? null : site.id
                      setOpenAuditId(next)
                      if (next) loadAuditPages(site.id)
                    }}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                    onMouseLeave={e => { if (openAuditId !== site.id) e.currentTarget.style.background = '' }}
                  >
                    <td style={{ padding: '0.625rem 0.75rem', paddingRight: 4 }}>
                      <StatusDot isUp={site.is_up} status={site.status} />
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {site.name}
                        {site.status !== 'active' && (
                          <span style={{ fontSize: '0.625rem', fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: 'var(--bg-subtle)', color: 'var(--text-faint)', border: '1px solid var(--border)', textTransform: 'uppercase' }}>
                            {site.status}
                          </span>
                        )}
                        <PlatformBadge p={site.platform} />
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
                        <a href={site.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>
                          {site.url.replace(/^https?:\/\//, '')}
                        </a>
                      </div>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {site.clients?.name ?? '—'}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                      {site.uptime_7d != null ? (
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: site.uptime_7d >= 99 ? '#10b981' : site.uptime_7d >= 95 ? '#f59e0b' : '#ef4444' }}>
                          {Number(site.uptime_7d).toFixed(1)}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem' }}>
                      <SslBadge days={site.ssl_days_remaining} />
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem' }} onClick={e => e.stopPropagation()}>
                      {auditLoading.has(site.id) ? (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>Running…</span>
                      ) : (
                        <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, cursor: 'pointer', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={site.audit_enabled ?? false}
                            onChange={e => handleAuditToggle(site.id, e.target.checked, site.audit_scope ?? 'key')}
                            style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                          />
                          <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: site.audit_enabled ? 'var(--blue)' : 'var(--border)', transition: 'background 0.2s' }} />
                          <span style={{ position: 'absolute', top: 2, left: site.audit_enabled ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                        </label>
                      )}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                      {site.audit_score != null ? (
                        <>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: site.audit_score >= 80 ? '#10b981' : site.audit_score >= 60 ? '#f59e0b' : '#ef4444' }}>
                            {site.audit_score}
                          </span>
                          {(site.audit_errors != null || site.audit_warnings != null) && (
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-faint)', marginTop: 1 }}>
                              {site.audit_errors ?? 0}E · {site.audit_warnings ?? 0}W
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.375rem' }}>
                        <button onClick={() => openEdit(site)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', cursor: 'pointer', color: 'var(--text-faint)' }}>
                          <PencilSimple size={13} />
                        </button>
                        <button onClick={() => setDeleteId(site.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', cursor: 'pointer', color: 'var(--red)' }}>
                          <TrashSimple size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {openAuditId === site.id && (
                    <tr>
                      <td colSpan={8} style={{ padding: 0, background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ padding: '1rem 1.25rem' }}>
                          {/* Summary bar */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                            {site.audit_score != null && (
                              <span style={{ fontSize: '1.5rem', fontWeight: 800, color: site.audit_score >= 80 ? '#10b981' : site.audit_score >= 60 ? '#f59e0b' : '#ef4444', lineHeight: 1 }}>
                                {site.audit_score}
                              </span>
                            )}
                            {(site.audit_errors != null || site.audit_warnings != null) && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {site.audit_errors ?? 0} errors · {site.audit_warnings ?? 0} warnings
                                {auditPages[site.id] && ` · ${auditPages[site.id].length} pages`}
                              </span>
                            )}
                            {site.last_audit_at && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                                Last audited {timeAgo(site.last_audit_at)}
                              </span>
                            )}
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>Scope:</span>
                              <select
                                value={site.audit_scope ?? 'key'}
                                onChange={e => handleScopeChange(site.id, e.target.value)}
                                style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer' }}
                              >
                                <option value="key">Key pages</option>
                                <option value="all">All pages</option>
                              </select>
                            </div>
                          </div>

                          {/* Per-page table */}
                          {auditPages[site.id] ? (
                            auditPages[site.id].length > 0 ? (
                              <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.75rem' }}>
                                  <thead>
                                    <tr>
                                      {['URL', 'Score', 'Top Issue', 'Title', 'H1', 'Schema', 'Canonical'].map((h, i) => (
                                        <th key={i} style={{ padding: '0.375rem 0.625rem', textAlign: 'left', fontSize: '0.625rem', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                                          {h}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {auditPages[site.id].slice(0, 15).map((page, i) => (
                                      <tr key={i}>
                                        <td style={{ padding: '0.375rem 0.625rem', maxWidth: 280 }}>
                                          <a href={page.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                                            {page.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                                          </a>
                                        </td>
                                        <td style={{ padding: '0.375rem 0.625rem', fontWeight: 700, color: (page.score ?? 0) >= 80 ? '#10b981' : (page.score ?? 0) >= 60 ? '#f59e0b' : '#ef4444', whiteSpace: 'nowrap' }}>
                                          {page.score ?? '—'}
                                        </td>
                                        <td style={{ padding: '0.375rem 0.625rem', color: 'var(--text-muted)', maxWidth: 280 }}>
                                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                                            {page.issues?.[0]?.msg ?? 'Clean'}
                                          </span>
                                        </td>
                                        <td style={{ padding: '0.375rem 0.625rem', color: page.title ? 'var(--text-primary)' : 'var(--red)', textAlign: 'center' }}>
                                          {page.title ? '✓' : '✗'}
                                        </td>
                                        <td style={{ padding: '0.375rem 0.625rem', color: page.h1_count === 1 ? 'var(--text-primary)' : 'var(--red)', textAlign: 'center' }}>
                                          {page.h1_count}
                                        </td>
                                        <td style={{ padding: '0.375rem 0.625rem', color: page.has_schema ? '#10b981' : 'var(--text-faint)', textAlign: 'center' }}>
                                          {page.has_schema ? '✓' : '—'}
                                        </td>
                                        <td style={{ padding: '0.375rem 0.625rem', color: page.has_canonical ? '#10b981' : 'var(--text-faint)', textAlign: 'center' }}>
                                          {page.has_canonical ? '✓' : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {auditPages[site.id].length > 15 && (
                                  <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', margin: '0.5rem 0 0', paddingLeft: '0.625rem' }}>
                                    Showing 15 of {auditPages[site.id].length} pages
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', margin: 0 }}>No pages crawled yet.</p>
                            )
                          ) : (
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', margin: 0 }}>
                              {site.audit_enabled ? 'Loading audit data…' : 'Enable weekly audit to start crawling.'}
                            </p>
                          )}

                          {/* Footer */}
                          <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', margin: '0.75rem 0 0', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                            Cloudflare users: whitelist User-Agent <code style={{ fontSize: '0.65rem', background: 'var(--bg-surface)', padding: '1px 4px', borderRadius: 4, border: '1px solid var(--border)' }}>GoLaunchLocal</code> in a WAF custom rule (Skip WAF + Bot Fight Mode).
                            {site.audit_enabled && ' Runs weekly (Mon 3 AM UTC).'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit modal */}
      {modalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}
        >
          <div style={{ background: 'var(--bg-surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{editSite ? 'Edit Site' : 'Add Site'}</h2>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '1.1rem' }}>✕</button>
            </div>
            <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Client Site" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Client</label>
                <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))} style={inputStyle}>
                  <option value="">— None —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>URL *</label>
                <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://example.com" style={inputStyle} />
                {/* Suggest URL from client's profile, WordPress connection, or GSC property */}
                {suggestedUrl && suggestedUrl.url !== form.url && (
                  <button
                    type="button"
                    onClick={() => setForm(f => ({
                      ...f,
                      url:      suggestedUrl.url,
                      platform: f.platform === 'custom' ? detectPlatform(suggestedUrl.url) : f.platform,
                    }))}
                    style={{
                      marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '0.2rem 0.625rem', borderRadius: 999,
                      border: '1px solid #bfdbfe', background: '#eff6ff',
                      cursor: 'pointer', fontSize: '0.7rem', color: '#2563eb', fontWeight: 500,
                    }}
                  >
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#dbeafe', color: '#1d4ed8' }}>{suggestedUrl.source}</span>
                    Use: {suggestedUrl.url.replace(/^https?:\/\//, '')}
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Platform</label>
                  <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} style={inputStyle}>
                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Hosting</label>
                  <select value={form.hosting_type} onChange={e => setForm(f => ({ ...f, hosting_type: e.target.value }))} style={inputStyle}>
                    {HOSTING_TYPES.map(h => <option key={h} value={h}>{h === 'ours' ? 'Ours' : 'Client'}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Hosting Provider</label>
                  <input value={form.hosting_provider} onChange={e => setForm(f => ({ ...f, hosting_provider: e.target.value }))} placeholder="Kinsta, WP Engine…" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Server Account</label>
                  <input value={form.server_account} onChange={e => setForm(f => ({ ...f, server_account: e.target.value }))} placeholder="cPanel user / account" style={inputStyle} />
                </div>
              </div>
              {groups.length > 0 && (
                <div>
                  <label style={labelStyle}>Group</label>
                  <select value={form.group_id} onChange={e => setForm(f => ({ ...f, group_id: e.target.value }))} style={inputStyle}>
                    <option value="">— None —</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={labelStyle}>Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={inputStyle}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
              <div>
                <label style={labelStyle}>Discord Channel ID <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional — DOWN alerts post here)</span></label>
                <input
                  value={form.discord_channel_id}
                  onChange={e => setForm(f => ({ ...f, discord_channel_id: e.target.value }))}
                  placeholder="e.g. 1234567890123456789"
                  style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.8125rem' }}
                />
              </div>
              {saveError && <p style={{ color: 'var(--red)', fontSize: '0.8125rem', margin: 0 }}>{saveError}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
                <button onClick={() => setModalOpen(false)} style={{ padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-subtle)', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.url.trim()} style={{ padding: '0.5rem 1.25rem', borderRadius: 8, border: 'none', background: 'var(--blue)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.875rem', color: '#fff', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Saving…' : editSite ? 'Save Changes' : 'Add Site'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: '1.5rem', maxWidth: 360, width: '100%' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>Delete site?</h3>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>This will permanently delete the site and all its check history. This cannot be undone.</p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteId(null)} style={{ padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-subtle)', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-muted)' }}>Cancel</button>
              <button onClick={() => handleDelete(deleteId)} style={{ padding: '0.5rem 1rem', borderRadius: 8, border: 'none', background: 'var(--red)', cursor: 'pointer', fontSize: '0.875rem', color: '#fff', fontWeight: 600 }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
