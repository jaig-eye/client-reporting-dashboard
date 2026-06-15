'use client'

import { useState, useEffect, useCallback } from 'react'
import { GlobeSimple, Plus, MagnifyingGlass, ArrowClockwise, PencilSimple, TrashSimple } from '@phosphor-icons/react'

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
  clients:          { id: string; name: string } | null
  site_groups:      { id: string; name: string } | null
}

interface Group { id: string; name: string }
interface Client { id: string; name: string }

const EMPTY_FORM = {
  name: '', url: '', client_id: '', platform: 'custom', hosting_type: 'client',
  hosting_provider: '', server_account: '', group_id: '', status: 'active', notes: '',
}

function StatusDot({ isUp, status }: { isUp: boolean | null; status: string }) {
  if (status !== 'active') return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d1d5db', display: 'inline-block' }} title="Paused / archived" />
  if (isUp === null) return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9ca3af', display: 'inline-block' }} title="Not yet checked" />
  if (isUp) return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} title="Up" />
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
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function SitesPage() {
  const [sites,   setSites]   = useState<Site[]>([])
  const [groups,  setGroups]  = useState<Group[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  // Filters
  const [search,      setSearch]      = useState('')
  const [filterStatus,setFilterStatus]= useState('')
  const [filterPlatform,setFilterPlatform] = useState('')
  const [filterUp,    setFilterUp]    = useState('')
  const [filterGroup, setFilterGroup] = useState('')

  // Modal
  const [modalOpen,    setModalOpen]    = useState(false)
  const [editSite,     setEditSite]     = useState<Site | null>(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState('')

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)

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
    setLoading(false)
  }, [search, filterStatus, filterPlatform, filterUp, filterGroup])

  const fetchClients = useCallback(async () => {
    const res = await fetch('/api/admin/clients')
    if (!res.ok) return
    const data = await res.json()
    setClients(data.clients ?? [])
  }, [])

  useEffect(() => { fetchSites() }, [fetchSites])
  useEffect(() => { fetchClients() }, [fetchClients])

  function openAdd() {
    setEditSite(null)
    setForm(EMPTY_FORM)
    setSaveError('')
    setModalOpen(true)
  }

  function openEdit(site: Site) {
    setEditSite(site)
    setForm({
      name:             site.name,
      url:              site.url,
      client_id:        site.client_id ?? '',
      platform:         site.platform,
      hosting_type:     site.hosting_type,
      hosting_provider: site.hosting_provider ?? '',
      server_account:   site.server_account   ?? '',
      group_id:         site.group_id          ?? '',
      status:           site.status,
      notes:            site.notes             ?? '',
    })
    setSaveError('')
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    const body = {
      name:             form.name.trim(),
      url:              form.url.trim(),
      client_id:        form.client_id        || null,
      platform:         form.platform,
      hosting_type:     form.hosting_type,
      hosting_provider: form.hosting_provider || null,
      server_account:   form.server_account   || null,
      group_id:         form.group_id         || null,
      status:           form.status,
      notes:            form.notes            || null,
    }
    const url    = editSite ? `/api/admin/sites/${editSite.id}` : '/api/admin/sites'
    const method = editSite ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--bg-subtle)',
    color: 'var(--text-primary)', fontSize: '0.875rem',
  }
  const labelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 1400, margin: '0 auto' }}>
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
          <button onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.4375rem 0.875rem', borderRadius: 8, border: 'none', background: 'var(--blue)', cursor: 'pointer', fontSize: '0.8125rem', color: '#fff', fontWeight: 600 }}>
            <Plus size={14} /> Add Site
          </button>
        </div>
      </div>

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
                {['', 'Name', 'Client', 'URL', 'Platform', 'Hosting', '7d Uptime', 'SSL', 'Last Check', ''].map((h, i) => (
                  <th key={i} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sites.map(site => (
                <tr
                  key={site.id}
                  style={{ cursor: 'default' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td style={{ padding: '0.625rem 0.75rem', paddingRight: 4 }}>
                    <StatusDot isUp={site.is_up} status={site.status} />
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    {site.name}
                    {site.status !== 'active' && (
                      <span style={{ marginLeft: 6, fontSize: '0.625rem', fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: 'var(--bg-subtle)', color: 'var(--text-faint)', border: '1px solid var(--border)', textTransform: 'uppercase' }}>
                        {site.status}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {site.clients?.name ?? '—'}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', maxWidth: 220 }}>
                    <a href={site.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 220 }}>
                      {site.url.replace(/^https?:\/\//, '')}
                    </a>
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem' }}>
                    <PlatformBadge p={site.platform} />
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: '0.75rem' }}>
                      {site.hosting_type === 'ours' ? 'Ours' : 'Client'}
                      {site.hosting_provider ? ` · ${site.hosting_provider}` : ''}
                    </span>
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
                  <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-faint)', whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                    {timeAgo(site.last_checked_at)}
                    {site.last_status_code && (
                      <span style={{ marginLeft: 4, color: site.last_status_code < 400 ? 'var(--text-faint)' : 'var(--red)' }}>
                        ({site.last_status_code})
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem' }}>
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
                <label style={labelStyle}>URL *</label>
                <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://example.com" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Client</label>
                <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))} style={inputStyle}>
                  <option value="">— None —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
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
