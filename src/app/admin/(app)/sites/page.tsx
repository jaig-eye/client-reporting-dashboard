'use client'

// Sites — /admin/sites
// Uptime, SSL and SEO-audit monitoring for every site we look after. A health strip up top, a
// filter toolbar, then one row per site (down sites first) that opens into its latest audit.

import '@/styles/admin/sites.css'
import Link from 'next/link'
import { useState, useEffect, useCallback, useMemo, useRef, useId, type ReactNode, type FormEvent } from 'react'
import {
  GlobeSimple, Plus, MagnifyingGlass, ArrowClockwise, PencilSimple, TrashSimple, X, CaretDown,
  ArrowUpRight, Code, ShoppingBagOpen, Buildings, IdentificationCard, Info, Copy, Check,
  Minus, ListChecks, ArrowCircleUp, ArrowCircleDown, LockSimple, Pulse, CalendarBlank, FunnelSimple,
} from '@phosphor-icons/react'
import PageHeader from '@/components/ui/PageHeader'
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge'
import BrandLogo from '@/components/ui/BrandLogo'
import Tile from '@/components/ui/Tile'
import EmptyState from '@/components/ui/EmptyState'
import ActionMenu, { copyText, type ActionMenuItem } from '@/components/ui/ActionMenu'
import { PillTabs } from '@/components/ui/PillTabs'
import { Sk, SkRows } from '@/components/ui/Skeleton'

const PLATFORMS = ['wordpress', 'ghl', 'bigcommerce', 'shopify', 'custom', 'other'] as const
const HOSTING_TYPES = ['ours', 'client'] as const
const STATUSES = ['active', 'paused', 'archived'] as const

const PLATFORM_LABEL: Record<string, string> = {
  wordpress: 'WordPress', ghl: 'HighLevel', bigcommerce: 'BigCommerce',
  shopify: 'Shopify', custom: 'Custom build', other: 'Other',
}
const STATUS_LABEL: Record<string, string> = { active: 'Active', paused: 'Paused', archived: 'Archived' }

/** The user agent the auditor crawls as; sites behind Cloudflare have to let it through. */
const AUDIT_AGENT = 'GoLaunchLocal'

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

// ─── helpers ──────────────────────────────────────────────────────────────────

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

const bareUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

function scoreTone(score: number): 'good' | 'warn' | 'bad' {
  return score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad'
}
const TONE_BADGE: Record<'good' | 'warn' | 'bad', StatusTone> = { good: 'success', warn: 'warning', bad: 'danger' }

function siteHealth(site: Site): { tone: StatusTone; label: string; live?: boolean } {
  if (site.status !== 'active') return { tone: 'neutral', label: STATUS_LABEL[site.status] ?? site.status }
  if (site.is_up === null)      return { tone: 'neutral', label: 'Not checked' }
  if (site.is_up)               return { tone: 'success', label: 'Up' }
  return { tone: 'danger', label: 'Down', live: true }
}

/** The last check, for the status badge's tooltip. */
function checkDetail(site: Site): string | undefined {
  if (!site.last_checked_at) return undefined
  const parts = [`Checked ${timeAgo(site.last_checked_at)}`]
  if (site.last_status_code != null) parts.push(`HTTP ${site.last_status_code}`)
  if (site.last_response_ms != null) parts.push(`${site.last_response_ms} ms`)
  if (site.is_up === false && site.consecutive_failures > 0) parts.push(`${site.consecutive_failures} failed check${site.consecutive_failures === 1 ? '' : 's'} in a row`)
  return parts.join(' · ')
}

function plural(n: number, one: string, many = `${one}s`) { return `${n} ${n === 1 ? one : many}` }

/** The platform's mark: the real logo where we have one, an icon otherwise. */
function PlatformMark({ platform }: { platform: string }) {
  if (platform === 'wordpress' || platform === 'bigcommerce' || platform === 'ghl') {
    return <BrandLogo type={platform} size={18} tile title={PLATFORM_LABEL[platform]} />
  }
  const icon = platform === 'shopify' ? <ShoppingBagOpen size={17} />
    : platform === 'custom' ? <Code size={17} />
    : <GlobeSimple size={17} />
  return <Tile title={PLATFORM_LABEL[platform] ?? platform}>{icon}</Tile>
}

/** One audit check on a phone row: a tick, a cross (missing and it matters) or a dash. */
function PageFlag({ ok, label, missing = 'na' }: { ok: boolean; label: string; missing?: 'bad' | 'na' }) {
  return (
    <span className={`st-flag ${ok ? 'st-yes' : missing === 'bad' ? 'st-no' : 'st-na'}`}>
      {ok ? <Check size={12} weight="bold" aria-hidden /> : missing === 'bad' ? <X size={12} weight="bold" aria-hidden /> : <Minus size={12} aria-hidden />}
      <span>{label}</span>
      <span className="sr-only">{ok ? 'present' : 'missing'}</span>
    </span>
  )
}

/** Where a suggested URL came from, as a small logo or icon. */
function SourceMark({ source }: { source: string }) {
  if (source === 'WordPress') return <BrandLogo type="wordpress" size={13} />
  if (source === 'GSC')       return <BrandLogo type="google_search_console" size={13} />
  return <IdentificationCard size={14} aria-label="Client profile" />
}
const SOURCE_LABEL: Record<string, string> = { Profile: 'client profile', WordPress: 'WordPress connection', GSC: 'Search Console property' }

// ─── dialog shell: focus in, Tab kept inside, Escape out, focus back where it was ─────────────

function useDialogFocus(onClose: () => void, locked: boolean, returnFocus?: string) {
  const ref = useRef<HTMLDivElement>(null)
  const returnRef = useRef(returnFocus)
  returnRef.current = returnFocus
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const lockedRef = useRef(locked)
  lockedRef.current = locked

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const root = ref.current
    const first = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>('input, select, textarea, button')
    first?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (!lockedRef.current) { e.stopPropagation(); closeRef.current() } return }
      if (e.key !== 'Tab' || !ref.current) return
      const f = Array.from(ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'))
      if (!f.length) return
      const a = f[0], z = f[f.length - 1]
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      // Opened from a ⋯ menu item, the opener has gone with the menu: go back to the menu's button.
      const back = opener && opener !== document.body && opener.isConnected ? opener
        : returnRef.current ? document.querySelector<HTMLElement>(returnRef.current) : null
      back?.focus?.()
    }
  }, [])
  return ref
}

function Dialog({ title, description, onClose, locked = false, size, role = 'dialog', children, footer, onSubmit, returnFocus }: {
  title: string
  description?: ReactNode
  onClose: () => void
  /** While a save runs, Escape and the backdrop don't close it. */
  locked?: boolean
  size?: 'sm'
  role?: 'dialog' | 'alertdialog'
  children?: ReactNode
  footer: ReactNode
  /** Makes the dialog a form, so Enter in a field submits. */
  onSubmit?: () => void
  /** Where focus goes on close when the element that opened it no longer exists (a selector). */
  returnFocus?: string
}) {
  const ref = useDialogFocus(onClose, locked, returnFocus)
  const titleId = useId()
  const body = (
    <>
      <header className="st-dialog-head">
        <div className="st-dialog-titles">
          <h2 className="st-dialog-title" id={titleId}>{title}</h2>
          {description && <p className="st-dialog-desc">{description}</p>}
        </div>
        <button type="button" className="st-dialog-close" onClick={onClose} disabled={locked} aria-label="Close"><X size={16} weight="bold" /></button>
      </header>
      {children && <div className="st-dialog-body">{children}</div>}
      <footer className="st-dialog-foot">{footer}</footer>
    </>
  )
  return (
    <div className="st-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !locked) onClose() }}>
      <div ref={ref} role={role} aria-modal="true" aria-labelledby={titleId} className={`st-dialog${size ? ` st-dialog--${size}` : ''}`}>
        {onSubmit
          ? <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit() }} style={{ display: 'contents' }}>{body}</form>
          : body}
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function SitesPage() {
  const [sites,   setSites]   = useState<Site[]>([])
  // Every site, unfiltered: which clients are monitored, and the health strip.
  const [allSites, setAllSites] = useState<Site[] | null>(null)
  const [groups,  setGroups]  = useState<Group[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [wpUrlsByClient,  setWpUrlsByClient]  = useState<Record<string, string>>({})
  const [gscUrlsByClient, setGscUrlsByClient] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loaded,  setLoaded]  = useState(false)
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
  const [deleteId,    setDeleteId]    = useState<string | null>(null)
  const [deleting,    setDeleting]    = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Audit expand / data
  const [openAuditId,  setOpenAuditId]  = useState<string | null>(null)
  const [auditPages,   setAuditPages]   = useState<Record<string, AuditPageRow[]>>({})
  const [auditLoading, setAuditLoading] = useState<Set<string>>(new Set())
  const [auditError,   setAuditError]   = useState('')

  // Import all unmonitored sites at once
  const [importing, setImporting] = useState(false)
  const [agentCopied, setAgentCopied] = useState(false)

  // Typing in the search fires a fetch per keystroke; only the newest answer may land.
  const fetchSeq = useRef(0)

  const fetchSites = useCallback(async () => {
    const seq = ++fetchSeq.current
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (search)         params.set('q', search)
    if (filterStatus)   params.set('status', filterStatus)
    if (filterPlatform) params.set('platform', filterPlatform)
    if (filterUp)       params.set('is_up', filterUp)
    if (filterGroup)    params.set('group_id', filterGroup)

    try {
      const res = await fetch(`/api/admin/sites?${params.toString()}`)
      if (seq !== fetchSeq.current) return
      if (!res.ok) { setError('Sites couldn’t load.'); setLoading(false); return }
      const data = await res.json()
      if (seq !== fetchSeq.current) return
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
      setLoaded(true)
    } catch {
      if (seq === fetchSeq.current) setError('Sites couldn’t load.')
    }
    if (seq === fetchSeq.current) setLoading(false)
  }, [search, filterStatus, filterPlatform, filterUp, filterGroup])

  const fetchClients = useCallback(async () => {
    const res = await fetch('/api/admin/clients')
    if (!res.ok) return
    const data = await res.json()
    setClients(data.clients ?? [])
  }, [])

  const fetchAllSites = useCallback(async () => {
    const res = await fetch('/api/admin/sites')
    if (!res.ok) return
    const data = await res.json()
    setAllSites(data.sites ?? [])
  }, [])

  useEffect(() => { fetchSites() }, [fetchSites])
  useEffect(() => { fetchClients() }, [fetchClients])
  useEffect(() => { fetchAllSites() }, [fetchAllSites])

  /** The list and the unfiltered set together, after anything that adds, changes or removes a site. */
  const refreshAll = useCallback(() => Promise.all([fetchSites(), fetchAllSites()]), [fetchSites, fetchAllSites])

  const allMonitoredClientIds = useMemo(
    () => new Set((allSites ?? []).map(s => s.client_id).filter((id): id is string => !!id)),
    [allSites],
  )

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

  // The health strip, over every active site whatever the filters show.
  const health = useMemo(() => {
    const fleet  = allSites ?? (loaded && !search && !filterStatus && !filterPlatform && !filterUp && !filterGroup ? sites : null)
    if (!fleet) return null
    const active = fleet.filter(s => s.status === 'active')
    const down   = active.filter(s => s.is_up === false)
    const up     = active.filter(s => s.is_up === true).length
    const ssl    = active.filter(s => s.ssl_days_remaining != null && s.ssl_days_remaining <= 30)
      .sort((a, b) => (a.ssl_days_remaining ?? 0) - (b.ssl_days_remaining ?? 0))
    const uptimes = active.map(s => s.uptime_7d).filter((u): u is number => u != null).map(Number)
    const avg    = uptimes.length ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length : null
    return { total: fleet.length, active: active.length, up, down, ssl, avg, measured: uptimes.length, unchecked: active.filter(s => s.is_up === null).length }
  }, [allSites, sites, loaded, search, filterStatus, filterPlatform, filterUp, filterGroup])

  // Clients that have a known URL (profile, WordPress, or GSC) but no site record yet
  const unmonitoredClients = useMemo(() => {
    if (!loaded || !allSites) return []
    return clients.filter(c => {
      const hasUrl = !!(c.website?.trim() || wpUrlsByClient[c.id] || gscUrlsByClient[c.id])
      return hasUrl && !allMonitoredClientIds.has(c.id)
    })
  }, [clients, allMonitoredClientIds, wpUrlsByClient, gscUrlsByClient, loaded, allSites])

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

  const filtersOn = !!(search || filterStatus || filterPlatform || filterUp || filterGroup)
  function clearFilters() {
    setSearch(''); setFilterStatus(''); setFilterPlatform(''); setFilterUp(''); setFilterGroup('')
  }

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
    await refreshAll()
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

  const canSave = !!form.name.trim() && !!form.url.trim()

  async function handleSave() {
    if (!canSave || saving) return
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
    try {
      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setSaveError(data.error ?? 'Save failed'); setSaving(false); return }
    } catch {
      setSaveError('Save failed. Check your connection and try again.')
      setSaving(false)
      return
    }
    setModalOpen(false)
    // Both lists: a site added from the "not monitored yet" notice has to leave it.
    refreshAll()
    setSaving(false)
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/admin/sites/${id}`, { method: 'DELETE' })
      if (res.ok) { setDeleteId(null); refreshAll() }
      else setDeleteError('The site couldn’t be deleted. Try again.')
    } catch {
      setDeleteError('The site couldn’t be deleted. Try again.')
    }
    setDeleting(false)
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

  function toggleAudit(siteId: string) {
    const next = openAuditId === siteId ? null : siteId
    setOpenAuditId(next)
    if (next) loadAuditPages(siteId)
  }

  async function copyAgent() {
    if (!(await copyText(AUDIT_AGENT))) return
    setAgentCopied(true)
    setTimeout(() => setAgentCopied(false), 1600)
  }

  const siteToDelete = deleteId ? sites.find(s => s.id === deleteId) ?? null : null
  const initialLoading = !loaded && loading && !error

  // ─── row pieces ─────────────────────────────────────────────────────────────

  function menuItems(site: Site): ActionMenuItem[] {
    const running = auditLoading.has(site.id)
    return [
      { key: 'edit',  label: 'Edit site', sub: 'Name, URL, hosting and alerts', icon: <PencilSimple size={15} />, onSelect: () => openEdit(site) },
      { key: 'visit', label: 'Visit site', sub: bareUrl(site.url), icon: <GlobeSimple size={15} />, href: site.url, newTab: true, copy: site.url },
      site.audit_enabled
        ? { key: 'audit', label: 'Turn off weekly audit', sub: 'Stops the Monday crawl', icon: <ListChecks size={15} />, disabled: running,
            onSelect: () => handleAuditToggle(site.id, false, site.audit_scope ?? 'key') }
        : { key: 'audit', label: 'Turn on weekly audit', sub: 'Audits now, then every Monday', icon: <ListChecks size={15} />, disabled: running,
            onSelect: () => { if (openAuditId !== site.id) toggleAudit(site.id); handleAuditToggle(site.id, true, site.audit_scope ?? 'key') } },
      { key: 'delete', label: 'Delete site', sub: 'Removes it and its check history', icon: <TrashSimple size={15} />, danger: true, separated: true,
        onSelect: () => { setDeleteError(''); setDeleteId(site.id) } },
    ]
  }

  function auditCell(site: Site) {
    if (auditLoading.has(site.id)) return <StatusBadge tone="info" live>Auditing</StatusBadge>
    if (site.audit_score != null) {
      const t = scoreTone(site.audit_score)
      const detail = `Audit score ${site.audit_score} of 100 · ${plural(site.audit_errors ?? 0, 'error')}, ${plural(site.audit_warnings ?? 0, 'warning')}`
      return <StatusBadge tone={TONE_BADGE[t]} title={detail}>{site.audit_score}</StatusBadge>
    }
    if (site.audit_enabled) return <StatusBadge tone="neutral" title="Turned on; the first audit hasn't finished">Pending</StatusBadge>
    return <span className="st-muted">Off</span>
  }

  function auditPanel(site: Site) {
    const pages   = auditPages[site.id]
    const running = auditLoading.has(site.id)
    const t       = site.audit_score != null ? scoreTone(site.audit_score) : null
    const facts: string[] = []
    if (site.audit_errors != null || site.audit_warnings != null) {
      facts.push(plural(site.audit_errors ?? 0, 'error'), plural(site.audit_warnings ?? 0, 'warning'))
    }
    if (pages) facts.push(plural(pages.length, 'page'))
    if (site.last_audit_at) facts.push(`last run ${timeAgo(site.last_audit_at)}`)

    return (
      <div className="st-panel" id={`st-audit-${site.id}`} role="region" aria-label={`Audit for ${site.name}`}>
        <div className="st-audit-head">
          <span
            className={`st-dial st-dial--${t ?? 'none'}`}
            style={{ ['--st-v' as string]: site.audit_score ?? 0 }}
            role="img"
            aria-label={site.audit_score != null ? `Audit score ${site.audit_score} of 100` : 'No audit score yet'}
          >
            <span>{site.audit_score ?? '—'}</span>
          </span>
          <div className="st-audit-text">
            <p className="st-audit-title">SEO audit<span className="st-beta">Beta</span></p>
            <p className="st-audit-sub">
              {running ? 'Auditing now. This can take a minute.'
                : facts.length ? facts.join(' · ').replace(/^./, c => c.toUpperCase())
                : site.audit_enabled ? 'The first audit hasn’t finished yet.'
                : 'Checks titles, headings, schema and canonicals on the site’s pages.'}
            </p>
          </div>
          <div className="st-audit-controls">
            <label className="st-switch">
              <input
                type="checkbox"
                role="switch"
                checked={site.audit_enabled ?? false}
                disabled={running}
                onChange={e => handleAuditToggle(site.id, e.target.checked, site.audit_scope ?? 'key')}
              />
              <span className="st-switch-track" aria-hidden />
              Weekly audit
            </label>
            <label className="st-scope">
              Scope
              <select className="input" value={site.audit_scope ?? 'key'} onChange={e => handleScopeChange(site.id, e.target.value)}>
                <option value="key">Key pages</option>
                <option value="all">All pages</option>
              </select>
            </label>
          </div>
        </div>

        <div className="card st-pages">
          {pages && !running ? (
            pages.length > 0 ? (
              <>
                <div className="ui-scroll-x">
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Page</th>
                        <th className="ui-r">Score</th>
                        <th>Top issue</th>
                        <th className="st-c">Title</th>
                        <th className="st-c">H1</th>
                        <th className="st-c">Schema</th>
                        <th className="st-c">Canonical</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pages.slice(0, 15).map((page, i) => (
                        <tr key={i}>
                          <td>
                            <a className="st-page-url" href={page.url} target="_blank" rel="noopener noreferrer" title={page.url}>
                              {page.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                            </a>
                          </td>
                          <td className="ui-r">
                            {page.score != null
                              ? <span className={`st-pscore st-pscore--${scoreTone(page.score)}`}>{page.score}</span>
                              : <span className="st-na">—</span>}
                          </td>
                          <td>
                            {page.issues?.[0]?.msg
                              ? <span className="st-issue" title={page.issues[0].msg}>{page.issues[0].msg}</span>
                              : <span className="st-issue st-issue--clean">No issues</span>}
                          </td>
                          <td className="st-c">
                            {page.title
                              ? <span className="st-yes" title={page.title}><Check size={15} weight="bold" aria-label="Has a title" /></span>
                              : <span className="st-no"><X size={15} weight="bold" aria-label="Missing title" /></span>}
                          </td>
                          <td className={`st-c${page.h1_count === 1 ? '' : ' st-bad'}`} title={page.h1_count === 1 ? 'One H1' : `${page.h1_count} H1s (should be one)`}>
                            {page.h1_count}
                          </td>
                          <td className="st-c">
                            {page.has_schema
                              ? <span className="st-yes"><Check size={15} weight="bold" aria-label="Has schema" /></span>
                              : <span className="st-na"><Minus size={15} aria-label="No schema" /></span>}
                          </td>
                          <td className="st-c">
                            {page.has_canonical
                              ? <span className="st-yes"><Check size={15} weight="bold" aria-label="Has a canonical" /></span>
                              : <span className="st-na"><Minus size={15} aria-label="No canonical" /></span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Phone: the same pages as short rows instead of a seven-column table. */}
                <ul className="st-plist">
                  {pages.slice(0, 15).map((page, i) => (
                    <li key={i} className="st-plist-row">
                      <span className="st-plist-top">
                        <a className="st-page-url" href={page.url} target="_blank" rel="noopener noreferrer" title={page.url}>
                          {page.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                        </a>
                        {page.score != null && <span className={`st-pscore st-pscore--${scoreTone(page.score)}`}>{page.score}</span>}
                      </span>
                      <span className={`st-plist-issue${page.issues?.[0]?.msg ? '' : ' st-issue--clean'}`}>{page.issues?.[0]?.msg ?? 'No issues'}</span>
                      <span className="st-plist-flags">
                        <PageFlag ok={!!page.title} label="Title" missing="bad" />
                        <span className={page.h1_count === 1 ? undefined : 'st-bad'}>H1 ×{page.h1_count}</span>
                        <PageFlag ok={page.has_schema} label="Schema" />
                        <PageFlag ok={page.has_canonical} label="Canonical" />
                      </span>
                    </li>
                  ))}
                </ul>
                {pages.length > 15 && <p className="st-pages-more">Showing 15 of {pages.length} pages</p>}
              </>
            ) : (
              <p className="st-panel-empty">No pages crawled yet.</p>
            )
          ) : site.audit_enabled || running ? (
            <div className="st-pages-sk" aria-busy="true" aria-label="Loading audit">
              {[0, 1, 2].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <Sk w={`${[34, 26, 30][i]}%`} h={12} />
                  <Sk w={28} h={12} />
                  <Sk w={`${[30, 38, 24][i]}%`} h={12} />
                </div>
              ))}
            </div>
          ) : (
            <p className="st-panel-empty">Turn on the weekly audit to crawl this site.</p>
          )}
        </div>

        {site.audit_enabled && (
          <p className="st-panel-foot"><CalendarBlank size={13} aria-hidden />Runs every Monday at 3 AM UTC.</p>
        )}
      </div>
    )
  }

  function siteRow(site: Site) {
    const open   = openAuditId === site.id
    const h      = siteHealth(site)
    const ssl    = site.ssl_days_remaining
    const uptime = site.uptime_7d != null ? Number(site.uptime_7d) : null
    const sslCls = ssl == null ? 'st-muted' : ssl <= 7 ? 'st-bad' : ssl <= 30 ? 'st-warn' : ''
    const upCls  = uptime == null ? 'st-muted' : uptime < 95 ? 'st-bad' : uptime < 99 ? 'st-warn' : ''
    const down   = site.status === 'active' && site.is_up === false

    return (
      <div key={site.id} className={`st-site${open ? ' is-open' : ''}${down ? ' st-site--down' : ''}${site.status !== 'active' ? ' st-site--off' : ''}`}>
        <div className="st-row" onClick={() => toggleAudit(site.id)}>
          <div className="st-c-site">
            <PlatformMark platform={site.platform} />
            <span className="ui-row-text">
              <span className="ui-row-title"><span className="st-name">{site.name}</span></span>
              <span className="ui-row-sub st-sub">
                <a className="st-domain" href={site.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={`Open ${bareUrl(site.url)} in a new tab`}>
                  <span>{bareUrl(site.url)}</span><ArrowUpRight size={11} weight="bold" aria-hidden />
                </a>
                <span className="st-dot-sep" aria-hidden>·</span>
                <span className="st-platform">{PLATFORM_LABEL[site.platform] ?? site.platform}</span>
              </span>
            </span>
          </div>

          <div className="st-meta">
            <div className="st-c-status">
              <StatusBadge tone={h.tone} live={h.live} dot={site.status === 'active'} title={checkDetail(site)}>{h.label}</StatusBadge>
              {site.status === 'active' && site.last_checked_at && <span className="st-checked">{timeAgo(site.last_checked_at)}</span>}
            </div>
            <div className="st-c-client">
              {site.clients
                ? <Link href={`/admin/clients/${site.clients.id}`} className="st-client" onClick={e => e.stopPropagation()}>
                    <Buildings size={13} aria-hidden /><span>{site.clients.name}</span>
                  </Link>
                : <span className="st-muted">No client</span>}
            </div>
            <div className="st-c-num">
              <span className="st-label">Uptime</span>
              <span className={upCls}>{uptime != null ? `${uptime.toFixed(1)}%` : '—'}</span>
            </div>
            <div className="st-c-num" title={site.ssl_expires_at ? `Certificate expires ${new Date(site.ssl_expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : undefined}>
              <span className="st-label">SSL</span>
              <span className={sslCls}>{ssl != null ? plural(ssl, 'day') : '—'}</span>
            </div>
            <div className="st-c-audit">
              <span className="st-label">Audit</span>
              {auditCell(site)}
            </div>
          </div>

          <div className="st-c-actions" data-site={site.id} onClick={e => e.stopPropagation()}>
            <ActionMenu items={menuItems(site)} label={`Actions for ${site.name}`} width={260} />
            <button
              type="button"
              className="st-expand"
              aria-expanded={open}
              aria-controls={open ? `st-audit-${site.id}` : undefined}
              aria-label={`${open ? 'Hide' : 'Show'} audit for ${site.name}`}
              onClick={() => toggleAudit(site.id)}
            >
              <CaretDown size={15} weight="bold" aria-hidden />
            </button>
          </div>
        </div>
        {open && auditPanel(site)}
      </div>
    )
  }

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Sites"
        description="Uptime, SSL certificates and SEO audits for every site we monitor. Down sites come first."
        actions={<>
          <button type="button" className="btn btn-secondary" onClick={() => refreshAll()} disabled={loading && loaded}>
            <ArrowClockwise size={15} className={loading && loaded ? 'st-spin' : undefined} aria-hidden />Refresh
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openAdd()}>
            <Plus size={15} weight="bold" aria-hidden />Add site
          </button>
        </>}
      />

      {/* Clients with a website we don't monitor yet */}
      {!importDismissed && unmonitoredClients.length > 0 && (
        <div className="ui-notice ui-notice--info st-import" role="region" aria-label="Websites not monitored yet">
          <div className="st-import-main">
            <Tile size="sm" tone="accent"><GlobeSimple size={15} /></Tile>
            <div className="st-import-text">
              <p className="st-import-title">
                {unmonitoredClients.length} client{unmonitoredClients.length !== 1 ? 's have' : ' has'} a website we don’t monitor yet
              </p>
              <p className="st-import-desc">Add one to check its details first, or import them all as they are.</p>
              <div className="st-chips">
                {unmonitoredClients.map(c => {
                  const url    = c.website?.trim() || wpUrlsByClient[c.id] || gscUrlsByClient[c.id] || ''
                  const source = c.website?.trim() ? 'Profile' : wpUrlsByClient[c.id] ? 'WordPress' : 'GSC'
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="st-chip"
                      title={`Add ${c.name}'s site, from their ${SOURCE_LABEL[source]}`}
                      onClick={() => openAdd({
                        name:      c.name,
                        url,
                        client_id: c.id,
                        platform:  detectPlatform(url),
                      })}
                    >
                      <Plus size={12} weight="bold" className="st-chip-add" aria-hidden />
                      <span className="st-chip-name">{c.name}</span>
                      <span className="st-chip-url">{bareUrl(url)}</span>
                      <span className="st-chip-src"><SourceMark source={source} /></span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="st-import-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImportDismissed(true)}>Dismiss</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleImportAll} disabled={importing}>
              {importing ? 'Importing…' : `Import all ${unmonitoredClients.length}`}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="ui-notice ui-notice--danger" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchSites()}>Retry</button>
        </div>
      )}

      {auditError && (
        <div className="ui-notice ui-notice--danger" role="alert">
          <span>{auditError}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAuditError('')} aria-label="Dismiss audit error">
            <X size={14} weight="bold" aria-hidden />Dismiss
          </button>
        </div>
      )}

      {/* Health at a glance, across every active site */}
      <section className="card st-stats" aria-label="Site health">
        {!health ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="st-stat" aria-hidden><Sk w={96} h={11} /><Sk w={64} h={24} r={6} style={{ marginTop: 6 }} /><Sk w={120} h={10} style={{ marginTop: 4 }} /></div>
          ))
        ) : (
          <>
            <div className="st-stat">
              <span className="st-stat-label"><ArrowCircleUp size={14} aria-hidden />Up now</span>
              <span className="st-stat-value">{health.up}<span className="st-stat-of">of {health.active}</span></span>
              <span className="st-stat-sub">
                {health.unchecked > 0 ? `${health.unchecked} not checked yet`
                  : health.total > health.active ? `${plural(health.total - health.active, 'site')} paused or archived`
                  : 'Checked every 2 minutes'}
              </span>
            </div>
            <div className={`st-stat${health.down.length ? ' st-stat--bad' : ''}`}>
              <span className="st-stat-label"><ArrowCircleDown size={14} aria-hidden />Down</span>
              <span className="st-stat-value">{health.down.length}</span>
              <span className="st-stat-sub" title={health.down.map(s => s.name).join(', ') || undefined}>
                {health.down.length === 0 ? 'Nothing down' : health.down.map(s => s.name).join(', ')}
              </span>
            </div>
            <div className={`st-stat${health.ssl.length ? ' st-stat--warn' : ''}`}>
              <span className="st-stat-label" title="Certificates that expire within 30 days"><LockSimple size={14} aria-hidden />SSL expiring soon</span>
              <span className="st-stat-value">{health.ssl.length}</span>
              <span className="st-stat-sub">
                {health.ssl.length === 0 ? 'None in the next 30 days'
                  : `${health.ssl.length > 1 ? 'Soonest: ' : ''}${health.ssl[0].name} in ${plural(health.ssl[0].ssl_days_remaining ?? 0, 'day')}`}
              </span>
            </div>
            <div className={`st-stat${health.avg != null && health.avg < 99 ? ' st-stat--warn' : ''}`}>
              <span className="st-stat-label"><Pulse size={14} aria-hidden />7-day uptime</span>
              <span className="st-stat-value">{health.avg != null ? `${health.avg.toFixed(1)}%` : '—'}</span>
              <span className="st-stat-sub">{health.measured ? `Average of ${plural(health.measured, 'active site')}` : 'No checks yet'}</span>
            </div>
          </>
        )}
      </section>

      {/* Filters */}
      <div className="st-toolbar" role="group" aria-label="Filter sites">
        <PillTabs
          label="Show sites"
          activeId={filterUp || 'all'}
          onSelect={id => setFilterUp(id === 'all' ? '' : id)}
          items={[
            { id: 'all',   label: 'All' },
            { id: 'false', label: 'Down', count: health?.down.length ?? null, alert: true },
            { id: 'true',  label: 'Up' },
          ]}
        />
        <div className="st-search">
          <MagnifyingGlass size={15} aria-hidden />
          <input
            className="input"
            type="search"
            placeholder="Search by name or URL"
            aria-label="Search sites by name or URL"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="st-filters">
          <select className={`input st-select${filterStatus ? ' st-select--on' : ''}`} aria-label="Status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Any status</option>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className={`input st-select${filterPlatform ? ' st-select--on' : ''}`} aria-label="Platform" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
            <option value="">Any platform</option>
            {PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
          </select>
          {groups.length > 0 && (
            <select className={`input st-select${filterGroup ? ' st-select--on' : ''}`} aria-label="Group" value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
              <option value="">Any group</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* The sites */}
      <div className="card st-list" aria-busy={loading && loaded ? true : undefined}>
        {initialLoading ? (
          <div aria-busy="true" aria-label="Loading sites"><SkRows rows={5} /></div>
        ) : error && !loaded ? (
          <EmptyState icon={<GlobeSimple size={20} />} title="Sites couldn’t load">Retry above, or refresh the page.</EmptyState>
        ) : sites.length === 0 ? (
          filtersOn ? (
            <EmptyState
              icon={<FunnelSimple size={20} />}
              title="No sites match these filters"
              actions={<button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>}
            >
              Try a different search, or clear the filters to see every site.
            </EmptyState>
          ) : (
            <EmptyState
              icon={<GlobeSimple size={20} />}
              title="No sites yet"
              actions={<button type="button" className="btn btn-primary" onClick={() => openAdd()}><Plus size={15} weight="bold" aria-hidden />Add site</button>}
            >
              Add a site to check its uptime every 2 minutes and its SSL certificate every week.
            </EmptyState>
          )
        ) : (
          <>
            <div className="st-head" aria-hidden>
              <span>Site</span>
              <span>Status</span>
              <span>Client</span>
              <span className="st-r">7-day uptime</span>
              <span className="st-r">SSL</span>
              <span className="st-r">Audit<span className="st-beta">Beta</span></span>
              <span />
            </div>
            {sortedSites.map(siteRow)}
          </>
        )}
        <p className="st-help">
          <Info size={14} aria-hidden />
          <span>
            Audits blocked by Cloudflare? Add a WAF custom rule that skips the WAF and Bot Fight Mode for the user agent{' '}
            <span className="st-code">
              {AUDIT_AGENT}
              <button type="button" className={`st-copy${agentCopied ? ' st-copy--done' : ''}`} onClick={copyAgent} aria-label={agentCopied ? 'Copied' : `Copy ${AUDIT_AGENT}`} title={agentCopied ? 'Copied' : 'Copy'}>
                {agentCopied ? <Check size={12} weight="bold" aria-hidden /> : <Copy size={12} aria-hidden />}
              </button>
            </span>.
          </span>
          <span className="sr-only" aria-live="polite">{agentCopied ? 'User agent copied' : ''}</span>
        </p>
      </div>

      {/* Add / Edit */}
      {modalOpen && (
        <Dialog
          title={editSite ? 'Edit site' : 'Add site'}
          returnFocus={editSite ? `[data-site="${editSite.id}"] .ui-menu-trigger` : undefined}
          description={editSite ? bareUrl(editSite.url) : 'Once it’s added, we check its uptime every 2 minutes and its SSL certificate weekly.'}
          onClose={() => setModalOpen(false)}
          locked={saving}
          onSubmit={handleSave}
          footer={<>
            {saveError && <p className="st-form-error" role="alert">{saveError}</p>}
            <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !canSave}>
              {saving ? 'Saving…' : editSite ? 'Save changes' : 'Add site'}
            </button>
          </>}
        >
          <div className="st-field">
            <label className="st-field-label" htmlFor="st-f-name">Name</label>
            <input id="st-f-name" data-autofocus className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Harbor Dental Studio" />
          </div>
          <div className="st-field">
            <label className="st-field-label" htmlFor="st-f-client">Client <span className="st-field-opt">Optional</span></label>
            <select id="st-f-client" className="input" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
              <option value="">No client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="st-field">
            <label className="st-field-label" htmlFor="st-f-url">URL</label>
            <input id="st-f-url" className="input" inputMode="url" required value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://example.com" />
            {/* Suggest URL from client's profile, WordPress connection, or GSC property */}
            {suggestedUrl && suggestedUrl.url !== form.url && (
              <button
                type="button"
                className="st-suggest"
                onClick={() => setForm(f => ({
                  ...f,
                  url:      suggestedUrl.url,
                  platform: f.platform === 'custom' ? detectPlatform(suggestedUrl.url) : f.platform,
                }))}
              >
                <SourceMark source={suggestedUrl.source} />
                <span>Use</span>
                <span className="st-suggest-url">{bareUrl(suggestedUrl.url)}</span>
                <span className="st-suggest-src">from the {SOURCE_LABEL[suggestedUrl.source]}</span>
              </button>
            )}
          </div>
          <div className="st-fieldrow">
            <div className="st-field">
              <label className="st-field-label" htmlFor="st-f-platform">Platform</label>
              <select id="st-f-platform" className="input" value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>
                {PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
              </select>
            </div>
            <div className="st-field">
              <label className="st-field-label" htmlFor="st-f-status">Status</label>
              <select id="st-f-status" className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
          </div>

          <p className="st-fieldset-title">Hosting</p>
          <div className="st-fieldrow">
            <div className="st-field">
              <label className="st-field-label" htmlFor="st-f-hosting">Hosted by</label>
              <select id="st-f-hosting" className="input" value={form.hosting_type} onChange={e => setForm(f => ({ ...f, hosting_type: e.target.value }))}>
                {HOSTING_TYPES.map(h => <option key={h} value={h}>{h === 'ours' ? 'Us' : 'The client'}</option>)}
              </select>
            </div>
            <div className="st-field">
              <label className="st-field-label" htmlFor="st-f-provider">Provider <span className="st-field-opt">Optional</span></label>
              <input id="st-f-provider" className="input" value={form.hosting_provider} onChange={e => setForm(f => ({ ...f, hosting_provider: e.target.value }))} placeholder="Kinsta, WP Engine…" />
            </div>
          </div>
          <div className="st-fieldrow">
            <div className="st-field">
              <label className="st-field-label" htmlFor="st-f-account">Server account <span className="st-field-opt">Optional</span></label>
              <input id="st-f-account" className="input" value={form.server_account} onChange={e => setForm(f => ({ ...f, server_account: e.target.value }))} placeholder="cPanel user or account" />
            </div>
            {groups.length > 0 && (
              <div className="st-field">
                <label className="st-field-label" htmlFor="st-f-group">Group <span className="st-field-opt">Optional</span></label>
                <select id="st-f-group" className="input" value={form.group_id} onChange={e => setForm(f => ({ ...f, group_id: e.target.value }))}>
                  <option value="">No group</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <p className="st-fieldset-title">Alerts and notes</p>
          <div className="st-field">
            <label className="st-field-label" htmlFor="st-f-discord">Discord channel ID <span className="st-field-opt">Optional</span></label>
            <input
              id="st-f-discord"
              className="input st-mono"
              inputMode="numeric"
              value={form.discord_channel_id}
              onChange={e => setForm(f => ({ ...f, discord_channel_id: e.target.value }))}
              placeholder="1234567890123456789"
              aria-describedby="st-f-discord-hint"
            />
            <p className="st-field-hint" id="st-f-discord-hint">Down alerts for this site post to this channel.</p>
          </div>
          <div className="st-field">
            <label className="st-field-label" htmlFor="st-f-notes">Notes <span className="st-field-opt">Optional</span></label>
            <textarea id="st-f-notes" className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
          </div>
        </Dialog>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <Dialog
          size="sm"
          role="alertdialog"
          title={siteToDelete ? `Delete ${siteToDelete.name}?` : 'Delete this site?'}
          description="This permanently deletes the site and all its check history. It can’t be undone."
          onClose={() => setDeleteId(null)}
          returnFocus={`[data-site="${deleteId}"] .ui-menu-trigger`}
          locked={deleting}
          footer={<>
            {deleteError && <p className="st-form-error" role="alert">{deleteError}</p>}
            <button type="button" className="btn btn-secondary" data-autofocus onClick={() => setDeleteId(null)} disabled={deleting}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={() => handleDelete(deleteId)} disabled={deleting}>
              <TrashSimple size={15} aria-hidden />{deleting ? 'Deleting…' : 'Delete site'}
            </button>
          </>}
        />
      )}
    </div>
  )
}
