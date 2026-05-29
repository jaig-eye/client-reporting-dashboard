'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  RocketLaunch,
  ChartLineUp,
  NotePencil,
  PlugsConnected,
  X,
  ArrowRight,
  BellSlash,
} from '@phosphor-icons/react'

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
  { key: 'ad_insights', label: 'Ad Insights' },
  { key: 'content',     label: 'Content' },
  { key: 'integration', label: 'Integration' },
] as const

type TabKey = typeof TABS[number]['key']

const TYPE_ICONS: Record<string, React.ReactNode> = {
  ad_fuel:     <RocketLaunch size={15} weight="duotone" aria-hidden />,
  ad_insights: <ChartLineUp  size={15} weight="duotone" aria-hidden />,
  content:     <NotePencil   size={15} weight="duotone" aria-hidden />,
  integration: <PlugsConnected size={15} weight="duotone" aria-hidden />,
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--red)',
  warning:  'var(--amber)',
  info:     'var(--blue)',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Alert Card ───────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  index,
  onDismiss,
}: {
  alert:     Alert
  index:     number
  onDismiss: (id: string) => void
}) {
  const [expanded,   setExpanded]   = useState(false)
  const [dismissing, setDismissing] = useState(false)

  const color   = SEVERITY_COLOR[alert.severity] ?? 'var(--blue)'
  const isRead  = alert.read_at != null
  const hasBody = Boolean(alert.body?.trim())
  const bodyLines = alert.body?.split('\n').filter(Boolean) ?? []
  const bodyPreview = bodyLines.slice(0, 2).join('\n')
  const hasMore     = bodyLines.length > 2

  async function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation()
    setDismissing(true)
    try {
      await fetch(`/api/admin/alerts/${alert.id}`, { method: 'DELETE' })
      onDismiss(alert.id)
    } catch {
      setDismissing(false)
    }
  }

  return (
    <div
      role="article"
      style={{
        display:         'flex',
        gap:             0,
        borderRadius:    8,
        overflow:        'hidden',
        border:          '1px solid var(--border)',
        background:      isRead ? 'var(--bg-surface)' : 'var(--bg-subtle)',
        boxShadow:       isRead ? 'none' : '0 1px 3px rgba(0,0,0,.06)',
        cursor:          hasBody ? 'pointer' : 'default',
        transition:      'box-shadow 0.15s, border-color 0.15s',
        animation:       `alert-slide-in 0.25s ease both`,
        animationDelay:  `${index * 30}ms`,
        opacity:         dismissing ? 0.4 : 1,
        pointerEvents:   dismissing ? 'none' : undefined,
      }}
      onClick={() => hasBody && setExpanded(v => !v)}
      onMouseEnter={e => {
        if (hasBody) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-focus)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
      }}
    >
      {/* severity stripe */}
      <div style={{ width: 4, flexShrink: 0, background: color }} />

      {/* body */}
      <div style={{ flex: 1, padding: '10px 12px', minWidth: 0 }}>
        {/* row 1: icon + title + client chip + dismiss */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ color, flexShrink: 0, marginTop: 1 }}>
            {TYPE_ICONS[alert.type] ?? <RocketLaunch size={15} aria-hidden />}
          </span>

          <span
            style={{
              flex:       1,
              fontWeight: isRead ? 400 : 600,
              fontSize:   '0.8125rem',
              color:      isRead ? 'var(--text-muted)' : 'var(--text-primary)',
              lineHeight: 1.4,
            }}
          >
            {alert.title}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {alert.client_name && (
              <span
                className="badge badge-blue"
                style={{ fontSize: '0.625rem', padding: '2px 6px', lineHeight: 1.4 }}
              >
                {alert.client_name}
              </span>
            )}
            <button
              onClick={handleDismiss}
              aria-label="Dismiss alert"
              title="Dismiss"
              style={{
                background: 'transparent',
                border:     'none',
                cursor:     'pointer',
                color:      'var(--text-faint)',
                padding:    2,
                borderRadius: 4,
                display:    'flex',
                alignItems: 'center',
                transition: 'color 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        </div>

        {/* row 2: body preview / expanded */}
        {hasBody && (
          <div
            style={{
              marginTop:  5,
              marginLeft: 23,
              fontSize:   '0.75rem',
              color:      'var(--text-muted)',
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              wordBreak:  'break-word',
            }}
          >
            {expanded ? alert.body : bodyPreview}
            {!expanded && hasMore && (
              <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>…</span>
            )}
          </div>
        )}

        {/* row 3: link + timestamp */}
        <div
          style={{
            display:    'flex',
            alignItems: 'center',
            marginTop:  6,
            marginLeft: 23,
            gap:        10,
          }}
        >
          {alert.link_url && (
            <a
              href={alert.link_url}
              onClick={e => e.stopPropagation()}
              style={{
                fontSize:       '0.7rem',
                color:          'var(--blue)',
                textDecoration: 'none',
                display:        'flex',
                alignItems:     'center',
                gap:            3,
                fontWeight:     500,
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.textDecoration = 'underline')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.textDecoration = 'none')}
            >
              View <ArrowRight size={11} aria-hidden />
            </a>
          )}
          <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginLeft: 'auto' }}>
            {relativeTime(alert.created_at)}
          </span>
        </div>
      </div>
    </div>
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
      markedTabs.current = new Set(['all', 'ad_fuel', 'ad_insights', 'content', 'integration'])
      const res = await fetch('/api/admin/alerts/count')
      if (res.ok) setCounts(await res.json())
      router.refresh()
    } catch {/* non-fatal */}
    setMarking(false)
  }

  return (
    <>
      <style>{`
        @keyframes alert-slide-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes badge-pop {
          0%   { transform: scale(0.6); }
          70%  { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
      `}</style>

      <div>
        {/* Page header */}
        <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Alerts
          </h1>
          {unreadInTab > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={marking}
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '5px 12px' }}
            >
              {marking ? 'Marking…' : 'Mark all read'}
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div
          style={{
            display:      'flex',
            gap:          4,
            marginBottom: '1rem',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 0,
          }}
        >
          {TABS.map(tab => {
            const n      = tabCount(totalCounts, tab.key)
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                style={{
                  background:    'transparent',
                  border:        'none',
                  cursor:        'pointer',
                  padding:       '6px 10px',
                  fontSize:      '0.8rem',
                  fontWeight:    active ? 600 : 400,
                  color:         active ? 'var(--blue)' : 'var(--text-muted)',
                  borderBottom:  active ? '2px solid var(--blue)' : '2px solid transparent',
                  marginBottom:  -1,
                  display:       'flex',
                  alignItems:    'center',
                  gap:           5,
                  transition:    'color 0.12s, border-color 0.12s',
                  whiteSpace:    'nowrap',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
              >
                {tab.label}
                {n > 0 && (
                  <span
                    style={{
                      minWidth:       16,
                      height:         16,
                      background:     active ? 'var(--blue)' : 'var(--red)',
                      color:          '#fff',
                      borderRadius:   8,
                      fontSize:       '0.575rem',
                      fontWeight:     700,
                      display:        'flex',
                      alignItems:     'center',
                      justifyContent: 'center',
                      padding:        '0 4px',
                      animation:      'badge-pop 0.2s ease',
                    }}
                  >
                    {n > 99 ? '99+' : n}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Alert list */}
        {filteredAlerts.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding:   '4rem 2rem',
              color:     'var(--text-faint)',
            }}
          >
            <BellSlash size={36} weight="thin" style={{ marginBottom: 12, opacity: 0.5 }} />
            <p style={{ fontSize: '0.875rem', margin: 0 }}>
              No alerts
              {activeTab !== 'all' ? ` in ${TABS.find(t => t.key === activeTab)?.label ?? activeTab}` : ''}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredAlerts.map((alert, i) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                index={i}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
