'use client'

// Sites — /admin/sites
// Uptime, SSL and SEO-audit monitoring for every site. Summary first (status headline + figures),
// then one compact row per site with a 30-day uptime bar, and a recent-incidents rail.

import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent } from 'react'
import {
  GlobeSimple, Plus, MagnifyingGlass, ArrowClockwise, PencilSimple, TrashSimple, DownloadSimple,
  ArrowSquareOut, MagnifyingGlassPlus, CalendarCheck, CalendarX, X,
} from '@phosphor-icons/react'
import ScrollTabs from '@/components/ui/ScrollTabs'
import SitesOverview from './SitesOverview'
import SiteRow from './SiteRow'
import IncidentsRail from './IncidentsRail'
import {
  type AuditPageRow, type Client, type DailyRow, type Group, type IncidentRow, type Site,
  HISTORY_DAYS, PLATFORM_LABELS, STATE_RANK, detectPlatform, fmtPct, lastNDates, plural, scoreTone, siteState, timeAgo,
} from './siteData'

const PLATFORMS = ['wordpress', 'ghl', 'bigcommerce', 'shopify', 'custom', 'other'] as const
const HOSTING_TYPES = ['ours', 'client'] as const
const STATUSES = ['active', 'paused', 'archived'] as const

const EMPTY_FORM = {
  name: '', url: '', client_id: '', platform: 'custom', hosting_type: 'client',
  hosting_provider: '', server_account: '', group_id: '', status: 'active', notes: '',
  discord_channel_id: '',
}

const toneColor = (tone: string) => tone === 'muted' ? 'var(--text-faint)' : `var(--${tone})`

interface MenuState { site: Site; top: number; right: number }

export default function SitesPage() {
  const [sites,    setSites]    = useState<Site[]>([])
  // Unfiltered list: drives the summary, the filter counts, the incidents rail and "unmonitored".
  const [allSites, setAllSites] = useState<Site[]>([])
  const [daily,     setDaily]     = useState<DailyRow[]>([])
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [allLoaded, setAllLoaded] = useState(false)
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

  // Row actions menu
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const fetchAllSites = useCallback(async () => {
    const res = await fetch('/api/admin/sites')
    if (!res.ok) { setAllLoaded(true); return }
    const data = await res.json()
    setAllSites(data.sites ?? [])
    setDaily(data.daily ?? [])
    setIncidents(data.incidents ?? [])
    setAllLoaded(true)
  }, [])

  const refreshAll = useCallback(() => { fetchSites(); fetchAllSites() }, [fetchSites, fetchAllSites])

  useEffect(() => { fetchSites() }, [fetchSites])
  useEffect(() => { fetchClients() }, [fetchClients])
  useEffect(() => { fetchAllSites() }, [fetchAllSites])

  // Close the row menu on outside click, Escape, scroll or resize; focus its first item on open.
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const close = () => setMenu(null)
    const onDown = (e: globalThis.MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) close() }
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  // Down first, then degraded, unchecked, up, paused/archived; alphabetical within each.
  const sortedSites = useMemo(
    () => [...sites].sort((a, b) => STATE_RANK[siteState(a)] - STATE_RANK[siteState(b)] || a.name.localeCompare(b.name)),
    [sites],
  )

  const dates = useMemo(() => lastNDates(HISTORY_DAYS), [])
  const historyBySite = useMemo(() => {
    const m = new Map<string, Map<string, DailyRow>>()
    for (const row of daily) {
      if (!m.has(row.site_id)) m.set(row.site_id, new Map())
      m.get(row.site_id)!.set(row.date, row)
    }
    return m
  }, [daily])
  const anyHistory = historyBySite.size > 0

  const allMonitoredClientIds = useMemo(
    () => new Set(allSites.map(s => s.client_id).filter((v): v is string => !!v)),
    [allSites],
  )

  // Clients that have a known URL (profile, WordPress, or GSC) but no site record yet
  const unmonitoredClients = useMemo(() => {
    if (loading || !allLoaded) return []
    return clients.filter(c => {
      const hasUrl = !!(c.website?.trim() || wpUrlsByClient[c.id] || gscUrlsByClient[c.id])
      return hasUrl && !allMonitoredClientIds.has(c.id)
    })
  }, [clients, allMonitoredClientIds, wpUrlsByClient, gscUrlsByClient, loading, allLoaded])

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
    await Promise.all([fetchSites(), fetchAllSites()])
  }

  function openAdd(prefill?: { name: string; url: string; client_id: string; platform: string }) {
    setEditSite(null)
    setForm(prefill ? { ...EMPTY_FORM, ...prefill } : EMPTY_FORM)
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
    refreshAll()
    setSaving(false)
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/sites/${id}`, { method: 'DELETE' })
    if (res.ok) { setDeleteId(null); if (openAuditId === id) setOpenAuditId(null); refreshAll() }
  }

  const patchSite = (siteId: string, patch: Partial<Site>) => {
    const apply = (list: Site[]) => list.map(s => s.id === siteId ? { ...s, ...patch } : s)
    setSites(apply)
    setAllSites(apply)
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
      patchSite(siteId, {
        audit_enabled: enabled,
        audit_scope:   scope,
        ...(data.audit?.score != null && {
          audit_score:    data.audit.score,
          audit_errors:   data.audit.errors,
          audit_warnings: data.audit.warnings,
          last_audit_at:  new Date().toISOString(),
        }),
      })
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
    patchSite(siteId, { audit_scope: scope })
  }

  function toggleAudit(siteId: string, forceOpen = false) {
    const next = !forceOpen && openAuditId === siteId ? null : siteId
    setOpenAuditId(next)
    if (next) loadAuditPages(siteId)
  }

  function openSiteFromRail(siteId: string) {
    toggleAudit(siteId, true)
    requestAnimationFrame(() => {
      document.getElementById(`site-audit-${siteId}`)?.closest('li')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  function toggleMenu(e: MouseEvent<HTMLButtonElement>, site: Site) {
    if (menu?.site.id === site.id) { setMenu(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    const MENU_H = 232
    const top = r.bottom + 4 + MENU_H > window.innerHeight ? Math.max(8, r.top - 4 - MENU_H) : r.bottom + 4
    setMenu({ site, top, right: Math.max(8, window.innerWidth - r.right) })
  }

  const clearFilters = () => { setSearch(''); setFilterStatus(''); setFilterPlatform(''); setFilterUp(''); setFilterGroup('') }
  const hasFilters = !!(search || filterStatus || filterPlatform || filterUp || filterGroup)

  const labelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }

  // Header summary line — leads with what needs attention.
  const downCount    = allSites.filter(x => x.status === 'active' && x.is_up === false).length
  const expiringSoon = allSites.filter(x => x.ssl_days_remaining != null && x.ssl_days_remaining <= 30).length
  const upCount      = allSites.filter(x => x.is_up === true).length
  const siteSummary  = [
    plural(allSites.length, 'site'),
    downCount > 0 ? `${downCount} down` : null,
    expiringSoon > 0 ? `${plural(expiringSoon, 'certificate')} expiring` : null,
  ].filter(Boolean).join(' · ')

  const renderAuditPanel = (site: Site) => {
    const pages   = auditPages[site.id]
    const running = auditLoading.has(site.id)
    return (
      <div className="site-audit">
        <div className="site-audit__bar">
          <div className="site-audit__heading">
            <span className="site-audit__title">SEO audit</span>
            <span className="site-beta">Beta</span>
          </div>
          <div className="site-audit__controls">
            <label className="site-audit__scope">
              <span>Scope</span>
              <select className="input" value={site.audit_scope ?? 'key'} onChange={e => handleScopeChange(site.id, e.target.value)}>
                <option value="key">Key pages</option>
                <option value="all">All pages</option>
              </select>
            </label>
            <label className="site-switch">
              <span>{running ? 'Running…' : 'Weekly audit'}</span>
              <input
                type="checkbox"
                role="switch"
                checked={site.audit_enabled ?? false}
                disabled={running}
                onChange={e => handleAuditToggle(site.id, e.target.checked, site.audit_scope ?? 'key')}
              />
              <span className="site-switch__track" aria-hidden><span className="site-switch__knob" /></span>
            </label>
          </div>
        </div>

        {(site.audit_score != null || site.audit_errors != null || site.audit_warnings != null || site.last_audit_at) && (
          <div className="site-audit__summary">
          {site.audit_score != null && (
            <span className="site-audit__score" style={{ color: toneColor(scoreTone(site.audit_score)) }}>{site.audit_score}</span>
          )}
          <span className="site-audit__facts">
            {(site.audit_errors != null || site.audit_warnings != null) && (
              <span>{site.audit_errors ?? 0} errors · {site.audit_warnings ?? 0} warnings{pages && ` · ${pages.length} pages`}</span>
            )}
            {site.last_audit_at && <span className="site-audit__faint">Last audited {timeAgo(site.last_audit_at)}</span>}
          </span>
        </div>
        )}

        {pages ? (
          pages.length > 0 ? (
            <div className="table-scroll site-audit__table">
              <table>
                <thead>
                  <tr>
                    {['URL', 'Score', 'Top issue', 'Title', 'H1', 'Schema', 'Canonical'].map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {pages.slice(0, 15).map((page, i) => (
                    <tr key={i}>
                      <td className="site-audit__url">
                        <a href={page.url} target="_blank" rel="noopener noreferrer">{page.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</a>
                      </td>
                      <td style={{ fontWeight: 700, color: toneColor(scoreTone(page.score ?? 0)) }}>{page.score ?? '—'}</td>
                      <td className="site-audit__issue"><span>{page.issues?.[0]?.msg ?? 'Clean'}</span></td>
                      <td className="site-audit__c" style={{ color: page.title ? 'var(--text-primary)' : 'var(--red)' }}>{page.title ? '✓' : '✗'}</td>
                      <td className="site-audit__c" style={{ color: page.h1_count === 1 ? 'var(--text-primary)' : 'var(--red)' }}>{page.h1_count}</td>
                      <td className="site-audit__c" style={{ color: page.has_schema ? 'var(--green)' : 'var(--text-faint)' }}>{page.has_schema ? '✓' : '—'}</td>
                      <td className="site-audit__c" style={{ color: page.has_canonical ? 'var(--green)' : 'var(--text-faint)' }}>{page.has_canonical ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pages.length > 15 && <p className="site-audit__faint site-audit__more">Showing 15 of {pages.length} pages</p>}
            </div>
          ) : (
            <p className="site-audit__note">No pages crawled yet.</p>
          )
        ) : (
          <p className="site-audit__note">{site.audit_enabled ? 'Loading audit data…' : 'Turn on the weekly audit to start crawling this site.'}</p>
        )}

        <p className="site-audit__foot">
          Cloudflare users: whitelist User-Agent <code>GoLaunchLocal</code> in a WAF custom rule (Skip WAF + Bot Fight Mode).
          {site.audit_enabled && ' Runs weekly (Mon 3 AM UTC).'}
        </p>
      </div>
    )
  }

  const noSitesAtAll = allLoaded && allSites.length === 0 && !error

  return (
    <div className="site-page">
      {/* Header */}
      <header className="site-head">
        <div className="site-head__text">
          <h1 className="page-title">Sites</h1>
          <p className="site-head__line">{allLoaded ? siteSummary : 'Uptime, SSL and SEO monitoring'}</p>
        </div>
        <div className="site-head__actions">
          <button type="button" className="btn btn-secondary" onClick={refreshAll} aria-label="Refresh sites">
            <ArrowClockwise size={15} aria-hidden /> <span className="site-hide-xs">Refresh</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openAdd()}>
            <Plus size={15} weight="bold" aria-hidden /> Add site
          </button>
        </div>
      </header>

      {/* Unmonitored clients banner */}
      {!importDismissed && unmonitoredClients.length > 0 && (
        <div className="card site-import">
          <DownloadSimple size={18} className="site-import__icon" aria-hidden />
          <div className="site-import__body">
            <p className="site-import__title">
              {unmonitoredClients.length} client{unmonitoredClients.length !== 1 ? 's have' : ' has'} a website not yet monitored
            </p>
            <div className="site-import__chips">
              {unmonitoredClients.map(c => {
                const url    = c.website?.trim() || wpUrlsByClient[c.id] || gscUrlsByClient[c.id] || ''
                const source = c.website?.trim() ? 'Profile' : wpUrlsByClient[c.id] ? 'WP' : 'GSC'
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="site-import__chip"
                    onClick={() => openAdd({ name: c.name, url, client_id: c.id, platform: detectPlatform(url) })}
                  >
                    <Plus size={11} aria-hidden /> {c.name}
                    <span className="site-import__url">{url.replace(/^https?:\/\//, '')}</span>
                    <span className="site-import__src">{source}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="site-import__actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={handleImportAll} disabled={importing}>
              {importing ? 'Importing…' : `Import all ${unmonitoredClients.length}`}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImportDismissed(true)}>Dismiss</button>
          </div>
        </div>
      )}

      {noSitesAtAll ? (
        <div className="card site-empty">
          <span className="site-empty__icon" aria-hidden><GlobeSimple size={28} /></span>
          <h2 className="site-empty__title">No sites yet</h2>
          <p className="site-empty__desc">Add your first site to start monitoring uptime and SSL.</p>
          <button type="button" className="btn btn-primary" onClick={() => openAdd()}>
            <Plus size={15} weight="bold" aria-hidden /> Add site
          </button>
        </div>
      ) : (
        <>
          <SitesOverview sites={allSites} incidents={incidents} loading={!allLoaded} />

          <div className="site-layout">
            <div className="site-main">
              {/* Toolbar: search, up/down pills, compact selects — wraps on a phone */}
              <div className="site-toolbar">
                <label className="site-search">
                  <MagnifyingGlass size={16} className="site-search__icon" aria-hidden />
                  <span className="sr-only">Search sites</span>
                  <input
                    className="input site-search__input"
                    placeholder="Search name or URL…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </label>
                <ScrollTabs
                  className="site-tabs"
                  label="Filter by uptime"
                  activeId={filterUp || 'all'}
                  onSelect={id => setFilterUp(id === 'all' ? '' : id)}
                  items={[
                    { id: 'all',   label: 'All',  count: allSites.length },
                    { id: 'false', label: 'Down', count: downCount },
                    { id: 'true',  label: 'Up',   count: upCount },
                  ]}
                />
                <div className="site-selects">
                  <label className="sr-only" htmlFor="site-f-status">Status</label>
                  <select id="site-f-status" className="input site-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="">Status</option>
                    {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                  <label className="sr-only" htmlFor="site-f-platform">Platform</label>
                  <select id="site-f-platform" className="input site-select" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
                    <option value="">Platform</option>
                    {PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
                  </select>
                  {groups.length > 0 && (
                    <>
                      <label className="sr-only" htmlFor="site-f-group">Group</label>
                      <select id="site-f-group" className="input site-select" value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
                        <option value="">Group</option>
                        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </>
                  )}
                </div>
              </div>

              {auditError && (
                <div className="site-alert" role="alert">
                  <span>{auditError}</span>
                  <button type="button" className="site-alert__close" onClick={() => setAuditError('')} aria-label="Dismiss"><X size={14} /></button>
                </div>
              )}

              <section className="card site-list" aria-label="Monitored sites">
                <div className="site-list__head">
                  <span>{loading ? 'Loading…' : hasFilters ? `${plural(sites.length, 'site')} match` : plural(sites.length, 'site')}</span>
                  <span className="site-list__legend hide-sm">
                    {anyHistory ? `Uptime, last ${HISTORY_DAYS} days` : 'Uptime, 7 days'}
                  </span>
                </div>

                {error ? (
                  <p className="site-list__empty" style={{ color: 'var(--red)' }}>{error}</p>
                ) : loading && sites.length === 0 ? (
                  <p className="site-list__empty">Loading sites…</p>
                ) : sortedSites.length === 0 ? (
                  <div className="site-list__empty">
                    <p>No sites match these filters.</p>
                    {hasFilters && <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>}
                  </div>
                ) : (
                  <ul className="site-rows">
                    {sortedSites.map(site => (
                      <SiteRow
                        key={site.id}
                        site={site}
                        state={siteState(site)}
                        dates={dates}
                        history={historyBySite.get(site.id)}
                        open={openAuditId === site.id}
                        menuOpen={menu?.site.id === site.id}
                        onToggle={() => toggleAudit(site.id)}
                        onMenu={e => toggleMenu(e, site)}
                      >
                        {renderAuditPanel(site)}
                      </SiteRow>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <aside className="site-aside">
              <IncidentsRail sites={allSites} incidents={incidents} loading={!allLoaded} onOpenSite={openSiteFromRail} />
            </aside>
          </div>
        </>
      )}

      {/* Row actions menu */}
      {menu && (
        <div ref={menuRef} role="menu" aria-label={`Actions for ${menu.site.name}`} className="site-menu" style={{ top: menu.top, right: menu.right }}>
          <button type="button" role="menuitem" className="site-menu__item" onClick={() => { const s = menu.site; setMenu(null); openEdit(s) }}>
            <PencilSimple size={16} aria-hidden /> Edit site
          </button>
          <button type="button" role="menuitem" className="site-menu__item" onClick={() => { const s = menu.site; setMenu(null); toggleAudit(s.id) }}>
            <MagnifyingGlassPlus size={16} aria-hidden /> {openAuditId === menu.site.id ? 'Hide SEO audit' : 'Open SEO audit'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="site-menu__item"
            disabled={auditLoading.has(menu.site.id)}
            onClick={() => {
              const s = menu.site
              setMenu(null)
              toggleAudit(s.id, true)
              handleAuditToggle(s.id, !s.audit_enabled, s.audit_scope ?? 'key')
            }}
          >
            {menu.site.audit_enabled
              ? <><CalendarX size={16} aria-hidden /> Turn off weekly audit</>
              : <><CalendarCheck size={16} aria-hidden /> Run audit weekly</>}
          </button>
          <a role="menuitem" className="site-menu__item" href={menu.site.url} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(null)}>
            <ArrowSquareOut size={16} aria-hidden /> Visit site
          </a>
          <div className="site-menu__sep" role="separator" />
          <button type="button" role="menuitem" className="site-menu__item site-menu__item--danger" onClick={() => { const id = menu.site.id; setMenu(null); setDeleteId(id) }}>
            <TrashSimple size={16} aria-hidden /> Delete site
          </button>
        </div>
      )}

      {/* Add / Edit modal */}
      {modalOpen && (
        <div className="site-overlay" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div className="site-modal" role="dialog" aria-modal="true" aria-labelledby="site-modal-title">
            <div className="site-modal__head">
              <h2 id="site-modal-title" className="site-modal__title">{editSite ? 'Edit site' : 'Add site'}</h2>
              <button type="button" className="site-icon-btn" onClick={() => setModalOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="site-modal__body">
              <div>
                <label style={labelStyle} htmlFor="site-name">Name *</label>
                <input id="site-name" className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Client Site" />
              </div>
              <div>
                <label style={labelStyle} htmlFor="site-client">Client</label>
                <select id="site-client" className="input" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                  <option value="">— None —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="site-url">URL *</label>
                <input id="site-url" className="input" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://example.com" />
                {/* Suggest URL from client's profile, WordPress connection, or GSC property */}
                {suggestedUrl && suggestedUrl.url !== form.url && (
                  <button
                    type="button"
                    className="site-import__chip site-suggest"
                    onClick={() => setForm(f => ({
                      ...f,
                      url:      suggestedUrl.url,
                      platform: f.platform === 'custom' ? detectPlatform(suggestedUrl.url) : f.platform,
                    }))}
                  >
                    <span className="site-import__src">{suggestedUrl.source}</span>
                    Use: {suggestedUrl.url.replace(/^https?:\/\//, '')}
                  </button>
                )}
              </div>
              <div className="site-modal__pair">
                <div>
                  <label style={labelStyle} htmlFor="site-platform">Platform</label>
                  <select id="site-platform" className="input" value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>
                    {PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle} htmlFor="site-hosting">Hosting</label>
                  <select id="site-hosting" className="input" value={form.hosting_type} onChange={e => setForm(f => ({ ...f, hosting_type: e.target.value }))}>
                    {HOSTING_TYPES.map(h => <option key={h} value={h}>{h === 'ours' ? 'Ours' : 'Client'}</option>)}
                  </select>
                </div>
              </div>
              <div className="site-modal__pair">
                <div>
                  <label style={labelStyle} htmlFor="site-provider">Hosting provider</label>
                  <input id="site-provider" className="input" value={form.hosting_provider} onChange={e => setForm(f => ({ ...f, hosting_provider: e.target.value }))} placeholder="Kinsta, WP Engine…" />
                </div>
                <div>
                  <label style={labelStyle} htmlFor="site-account">Server account</label>
                  <input id="site-account" className="input" value={form.server_account} onChange={e => setForm(f => ({ ...f, server_account: e.target.value }))} placeholder="cPanel user / account" />
                </div>
              </div>
              {groups.length > 0 && (
                <div>
                  <label style={labelStyle} htmlFor="site-group">Group</label>
                  <select id="site-group" className="input" value={form.group_id} onChange={e => setForm(f => ({ ...f, group_id: e.target.value }))}>
                    <option value="">— None —</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={labelStyle} htmlFor="site-status">Status</label>
                <select id="site-status" className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="site-notes">Notes</label>
                <textarea id="site-notes" className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} style={{ resize: 'vertical' }} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="site-discord">
                  Discord channel ID <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional — DOWN alerts post here)</span>
                </label>
                <input
                  id="site-discord"
                  className="input"
                  value={form.discord_channel_id}
                  onChange={e => setForm(f => ({ ...f, discord_channel_id: e.target.value }))}
                  placeholder="e.g. 1234567890123456789"
                  style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}
                />
              </div>
              {saveError && <p style={{ color: 'var(--red)', fontSize: '0.8125rem', margin: 0 }}>{saveError}</p>}
              <div className="site-modal__foot">
                <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name.trim() || !form.url.trim()}>
                  {saving ? 'Saving…' : editSite ? 'Save changes' : 'Add site'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="site-overlay site-overlay--top">
          <div className="site-modal site-modal--sm" role="alertdialog" aria-modal="true" aria-labelledby="site-del-title">
            <div className="site-modal__body">
              <h3 id="site-del-title" className="site-modal__title">Delete site?</h3>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                This will permanently delete the site and all its check history. This cannot be undone.
              </p>
              <div className="site-modal__foot">
                <button type="button" className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
                <button type="button" className="btn site-btn-danger" onClick={() => handleDelete(deleteId)}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
