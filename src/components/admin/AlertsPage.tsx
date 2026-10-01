'use client'

import '@/styles/admin/alerts.css'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  RocketLaunch,
  ChartLineUp,
  NotePencil,
  PlugsConnected,
  X,
  ArrowRight,
  BellSlash,
  Buildings,
  Checks,
  CaretDown,
  CaretUp,
  AddressBook,
  GearSix,
  Bell,
} from '@phosphor-icons/react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import StatusBadge from '@/components/ui/StatusBadge'
import Tile, { type TileTone } from '@/components/ui/Tile'
import { PillTabs } from '@/components/ui/PillTabs'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Alert {
  id:          string
  type:        string
  severity:    string
  client_id:   string | null
  client_name: string | null
  title:       string
  body:        string | null
  meta:        Record<string, unknown>
  link_url:    string | null
  read_at:     string | null
  created_at:  string
}

interface CountData {
  total:  number
  byType: Record<string, number>
}

interface AlertsPageProps {
  initialAlerts:       Alert[]
  initialCounts:       CountData
  initialTotalCounts?: CountData
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'all',         label: 'All' },
  { key: 'ad_fuel',     label: 'Ad Fuel' },
  { key: 'ad_insights', label: 'Ad insights' },
  { key: 'content',     label: 'Content' },
  { key: 'integration', label: 'Integrations' },
] as const

type TabKey = typeof TABS[number]['key']

const TYPE_ICONS: Record<string, ReactNode> = {
  ad_fuel:     <RocketLaunch   size={16} weight="duotone" aria-hidden />,
  ad_insights: <ChartLineUp    size={16} weight="duotone" aria-hidden />,
  content:     <NotePencil     size={16} weight="duotone" aria-hidden />,
  integration: <PlugsConnected size={16} weight="duotone" aria-hidden />,
  crm:         <AddressBook    size={16} weight="duotone" aria-hidden />,
  system:      <GearSix        size={16} weight="duotone" aria-hidden />,
}

// crm and system alerts have no tab of their own; they show under All.
const TYPE_LABEL: Record<string, string> = {
  ad_fuel:     'Ad Fuel',
  ad_insights: 'Ad insights',
  content:     'Content',
  integration: 'Integration',
  crm:         'CRM',
  system:      'System',
}

function typeLabel(type: string): string {
  if (TYPE_LABEL[type]) return TYPE_LABEL[type]
  const words = type.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const SEVERITY: Record<string, { tone: TileTone; label: string }> = {
  critical: { tone: 'red',    label: 'Critical' },
  warning:  { tone: 'amber',  label: 'Warning' },
  info:     { tone: 'accent', label: 'Info' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** **bold** and _italic_ only. The text is escaped first: alert bodies carry campaign and ad
 *  names from the ad platforms, and those must never be read as HTML. */
function renderMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
}

function relativeTime(iso: string): string {
  const ms   = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 2)    return 'just now'
  if (mins < 60)   return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)    return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)    return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function tabCount(counts: CountData, tab: TabKey): number {
  if (tab === 'all') return counts.total
  return counts.byType[tab] ?? 0
}

// ─── Alert row ────────────────────────────────────────────────────────────────

function AlertRow({
  alert,
  isNew,
  onDismiss,
}: {
  alert:     Alert
  /** Unread when the page opened. Opening the page marks alerts read, so this is what says
   *  which ones arrived since the last visit. */
  isNew:     boolean
  onDismiss: (id: string) => void
}) {
  const [expanded,   setExpanded]   = useState(false)
  const [dismissing, setDismissing] = useState(false)

  const severity  = SEVERITY[alert.severity] ?? SEVERITY.info
  const kind      = typeLabel(alert.type)
  const hasBody   = Boolean(alert.body?.trim())
  const bodyLines = alert.body?.split('\n').filter(Boolean) ?? []
  const bodyPreview = bodyLines.slice(0, 2).join('\n')
  const hasMore     = bodyLines.length > 2
  const bodyId      = `al-body-${alert.id}`

  async function handleDismiss() {
    setDismissing(true)
    try {
      await fetch(`/api/admin/alerts/${alert.id}`, { method: 'DELETE' })
      onDismiss(alert.id)
    } catch {
      setDismissing(false)
    }
  }

  const link = alert.link_url
  const viewInner = <>View<ArrowRight size={13} weight="bold" aria-hidden /></>

  return (
    <article
      className={`ui-row al-row${isNew ? ' al-row--new' : ''}${dismissing ? ' al-row--busy' : ''}`}
      aria-busy={dismissing || undefined}
      aria-labelledby={`al-title-${alert.id}`}
    >
      <Tile tone={severity.tone} title={`${severity.label}: ${kind}`}>
        {TYPE_ICONS[alert.type] ?? <Bell size={16} weight="duotone" aria-hidden />}
      </Tile>

      <div className="ui-row-text">
        <h2 className="ui-row-title" id={`al-title-${alert.id}`} style={{ margin: 0 }}>
          {alert.title}
          {isNew && <StatusBadge tone="info">New</StatusBadge>}
        </h2>

        {hasBody && (
          <p
            id={bodyId}
            className="al-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(expanded ? (alert.body ?? '') : bodyPreview) + (!expanded && hasMore ? '…' : '') }}
          />
        )}
        {hasMore && (
          <button type="button" className="al-more" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} aria-controls={bodyId}>
            {expanded ? 'Show less' : 'Show more'}
            {expanded ? <CaretUp size={11} weight="bold" aria-hidden /> : <CaretDown size={11} weight="bold" aria-hidden />}
          </button>
        )}

        <span className="ui-row-sub al-meta">
          {alert.client_name && (alert.client_id ? (
            <Link href={`/admin/clients/${alert.client_id}`} className="al-client" title={`Open ${alert.client_name}`}>
              <Buildings size={12} aria-hidden />{alert.client_name}
            </Link>
          ) : (
            <span className="al-client"><Buildings size={12} aria-hidden />{alert.client_name}</span>
          ))}
          <span className="al-when">
            {kind}
            <span className="al-dot" aria-hidden>·</span>
            {/* Server and browser can sit in different time zones, so the title may differ. */}
            <time dateTime={alert.created_at} title={new Date(alert.created_at).toLocaleString('en-US')} suppressHydrationWarning>{relativeTime(alert.created_at)}</time>
          </span>
        </span>
      </div>

      {link && (
        <div className="ui-row-actions al-actions">
          {link.startsWith('/')
            ? <Link href={link} className="btn btn-secondary btn-sm">{viewInner}</Link>
            : <a href={link} className="btn btn-secondary btn-sm">{viewInner}</a>}
        </div>
      )}
      <button
        type="button"
        className="al-dismiss"
        onClick={handleDismiss}
        aria-label={`Dismiss “${alert.title}”`}
        title="Dismiss"
      >
        <X size={16} aria-hidden />
      </button>
    </article>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AlertsPage({ initialAlerts, initialCounts, initialTotalCounts }: AlertsPageProps) {
  const router     = useRouter()
  const [activeTab,    setActiveTab]    = useState<TabKey>('all')
  const [alerts,       setAlerts]       = useState<Alert[]>(initialAlerts)
  const [counts,       setCounts]       = useState<CountData>(initialCounts)
  const [totalCounts,  setTotalCounts]  = useState<CountData>(initialTotalCounts ?? initialCounts)
  const [marking,   setMarking]   = useState(false)
  const markedTabs  = useRef(new Set<string>())
  // Unread when the page loaded — they keep a "New" mark for this visit after being marked read.
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set(initialAlerts.filter(a => a.read_at == null).map(a => a.id)))

  const filteredAlerts = activeTab === 'all'
    ? alerts
    : alerts.filter(a => a.type === activeTab)

  const unreadInTab = filteredAlerts.filter(a => a.read_at == null).length

  // Mark current tab's unread as read on mount / tab switch
  const markTabRead = useCallback(async (tab: TabKey) => {
    if (markedTabs.current.has(tab)) return
    markedTabs.current.add(tab)

    const body: Record<string, unknown> = { mark_all_read: true }
    if (tab !== 'all') body.type = tab

    try {
      await fetch('/api/admin/alerts', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      // Optimistically mark all matching alerts as read
      const now = new Date().toISOString()
      setAlerts(prev => prev.map(a =>
        (tab === 'all' || a.type === tab) && a.read_at == null
          ? { ...a, read_at: now }
          : a
      ))
      // Refresh counts
      const res = await fetch('/api/admin/alerts/count')
      if (res.ok) setCounts(await res.json())
      // Refresh sidebar pill via router refresh
      router.refresh()
    } catch {/* non-fatal */}
  }, [router])

  useEffect(() => { markTabRead('all') }, [markTabRead])

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab)
    markTabRead(tab)
  }

  function handleDismiss(id: string) {
    setAlerts(prev => {
      const next = prev.filter(a => a.id !== id)
      // Recompute total counts from remaining alerts
      const byType: Record<string, number> = { ad_insights: 0, ad_fuel: 0, content: 0, integration: 0 }
      for (const a of next) { if (a.type in byType) byType[a.type]++ }
      setTotalCounts({ total: next.length, byType })
      return next
    })
    // Refresh unread counts (sidebar pill)
    fetch('/api/admin/alerts/count')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setCounts(d))
      .catch(() => {})
    router.refresh()
  }

  async function handleMarkAllRead() {
    setMarking(true)
    try {
      await fetch('/api/admin/alerts', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mark_all_read: true }),
      })
      const now = new Date().toISOString()
      setAlerts(prev => prev.map(a => ({ ...a, read_at: a.read_at ?? now })))
      setNewIds(new Set())
      markedTabs.current = new Set(['all', 'ad_fuel', 'ad_insights', 'content', 'integration'])
      const res = await fetch('/api/admin/alerts/count')
      if (res.ok) setCounts(await res.json())
      router.refresh()
    } catch {/* non-fatal */}
    setMarking(false)
  }

  const activeLabel = TABS.find(t => t.key === activeTab)?.label ?? activeTab

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Low Ad Fuel balances, performance swings, content waiting on you and broken connections, newest first. Opening a tab marks its alerts as read."
        actions={unreadInTab > 0 ? (
          <button type="button" onClick={handleMarkAllRead} disabled={marking} className="btn btn-secondary">
            <Checks size={15} weight="bold" aria-hidden />
            {marking ? 'Marking…' : 'Mark all as read'}
          </button>
        ) : undefined}
      />

      <div className="al-tabs">
        <PillTabs
          label="Alert types"
          idPrefix="al"
          activeId={activeTab}
          onSelect={id => handleTabChange(id as TabKey)}
          items={TABS.map(t => ({
            id:    t.key,
            label: t.label,
            count: tabCount(totalCounts, t.key),
            // Red while some are still unread; neutral once they've been seen.
            alert: tabCount(counts, t.key) > 0,
          }))}
        />
      </div>

      <div role="tabpanel" id={`al-panel-${activeTab}`} aria-labelledby={`al-tab-${activeTab}`}>
        {filteredAlerts.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<BellSlash size={20} />}
              title={activeTab === 'all' ? 'No alerts' : `No ${activeLabel} alerts`}
            >
              You&apos;re all caught up. New alerts show up here as the scheduled checks find something.
            </EmptyState>
          </div>
        ) : (
          <div className="card al-list">
            {filteredAlerts.map(alert => (
              <AlertRow
                key={alert.id}
                alert={alert}
                isNew={newIds.has(alert.id)}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
