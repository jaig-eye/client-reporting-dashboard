'use client'

// The Alerts inbox.
//
// Production carries ~1000 open alerts, two thirds of them the Ad Fuel cron repeating itself daily.
// The page used to be a wall of bordered cards, so it is now an inbox: quiet rows under day headings,
// repeats collapsed into one row with a ×N, and the full body only when a row is opened.
//
// Data: the server hands over the first page of full alerts plus a light index of EVERY open alert
// (id, type, severity, client, read/created). Counts, the client filter, the summary line and the
// "…all in this view" actions work off the index; full alerts load a page at a time per filter
// through GET /api/admin/alerts.
//
// Reading: alerts are marked read when opened (expanded or "View"), or with "Mark all as read" —
// not wholesale on page load, which made the unread dot meaningless.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BellSlash, CheckSquare } from '@phosphor-icons/react'
import ScrollTabs from '@/components/ui/ScrollTabs'
import ConfirmActionDialog from '@/components/admin/ConfirmActionDialog'
import AlertRow from '@/components/admin/alerts/AlertRow'
import InboxMenu from '@/components/admin/alerts/InboxMenu'
import {
  collapseRepeats, isToday, matchesFilter, sectionByDay,
  type Alert, type AlertIndexRow, type InboxFilter,
} from '@/components/admin/alerts/inbox'

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'all',         label: 'All' },
  { key: 'ad_fuel',     label: 'Ad Fuel' },
  { key: 'ad_insights', label: 'Ad Insights' },
  { key: 'content',     label: 'Content' },
  { key: 'integration', label: 'Integration' },
] as const

type TabKey = typeof TABS[number]['key']

const PAGE_SIZE        = 100
const DISMISS_PARALLEL = 6
const PATCH_CHUNK      = 100

interface AlertsPageProps {
  initialAlerts: Alert[]
  initialIndex:  AlertIndexRow[]
}

const filterKey = (f: InboxFilter) => `${f.tab}|${f.client}|${f.unreadOnly ? 1 : 0}`

interface PendingConfirm {
  ids:   string[]
  title: string
  body:  string
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlertsPage({ initialAlerts, initialIndex }: AlertsPageProps) {
  const router = useRouter()

  const [tab,        setTab]        = useState<TabKey>('all')
  const [client,     setClient]     = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const filter = useMemo<InboxFilter>(() => ({ tab, client, unreadOnly }), [tab, client, unreadOnly])
  const key    = filterKey(filter)

  const [index, setIndex] = useState<AlertIndexRow[]>(initialIndex)
  // Full alerts loaded per filter. Every mutation is applied to every list.
  const [pool, setPool]   = useState<Record<string, Alert[]>>({ [filterKey({ tab: 'all', client: '', unreadOnly: false })]: initialAlerts })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const requestRef = useRef(0)
  const inflight   = useRef(new Set<string>())

  const [expanded,   setExpanded]   = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [selected,   setSelected]   = useState<Set<string>>(new Set())
  const [busyIds,    setBusyIds]    = useState<Set<string>>(new Set())
  const [confirm,    setConfirm]    = useState<PendingConfirm | null>(null)
  const [progress,   setProgress]   = useState<{ done: number; total: number } | null>(null)
  const [notice,     setNotice]     = useState<string | null>(null)

  // Day headings and relative times depend on the viewer's clock and timezone, so they render after
  // mount rather than risk a server/client mismatch.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // ─── Derived ────────────────────────────────────────────────────────────────

  const list = useMemo(() => pool[key] ?? [], [pool, key])

  const viewRows = useMemo(() => index.filter(r => matchesFilter(r, filter)), [index, filter])
  // For "unread only", rows read during this visit stay on screen; the next page starts after the
  // ones that are still unread on the server.
  const serverOffset = unreadOnly ? list.filter(a => a.read_at == null).length : list.length
  const hasMore      = serverOffset < viewRows.length

  const sections = useMemo(
    () => (now == null ? [] : sectionByDay(collapseRepeats(list), now)),
    [list, now],
  )

  const tabCounts = useMemo(() => {
    const out: Record<string, number> = { all: 0 }
    for (const r of index) {
      if (!matchesFilter(r, { tab: 'all', client, unreadOnly })) continue
      out.all++
      out[r.type] = (out[r.type] ?? 0) + 1
    }
    return out
  }, [index, client, unreadOnly])

  const clientOptions = useMemo(() => {
    const byId = new Map<string, { name: string; count: number }>()
    for (const r of index) {
      if (!r.client_id) continue
      if (!matchesFilter(r, { tab, client: '', unreadOnly: false })) continue
      const cur = byId.get(r.client_id)
      if (cur) cur.count++
      else byId.set(r.client_id, { name: r.client_name ?? 'Unnamed client', count: 1 })
    }
    return Array.from(byId, ([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name))
  }, [index, tab])

  // The selected client can vanish from the tab's list — keep it selectable so the filter still shows.
  const selectedClientMissing = client !== '' && !clientOptions.some(c => c.id === client)
  const selectedClientName    = index.find(r => r.client_id === client)?.client_name ?? 'Selected client'

  const summary = useMemo(() => {
    const scope    = index.filter(r => matchesFilter(r, filter, true))
    const unread   = scope.filter(r => r.read_at == null)
    const newToday = now == null ? 0 : unread.filter(r => isToday(r.created_at, now)).length
    const critical = unread.filter(r => r.severity === 'critical').length
    return { open: scope.length, unread: unread.length, newToday, critical }
  }, [index, filter, now])

  // ─── Loading ────────────────────────────────────────────────────────────────

  const loadPage = useCallback(async (f: InboxFilter, offset: number) => {
    const k   = filterKey(f)
    // The effect below can fire again before the first response lands; one request per page.
    const flightKey = `${k}@${offset}`
    if (inflight.current.has(flightKey)) return
    inflight.current.add(flightKey)
    const req = ++requestRef.current
    setLoading(true)
    setLoadError(false)
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (f.tab !== 'all') qs.set('type', f.tab)
    if (f.client)        qs.set('client_id', f.client)
    if (f.unreadOnly)    qs.set('unread_only', 'true')
    try {
      const res = await fetch(`/api/admin/alerts?${qs}`)
      if (!res.ok) throw new Error(String(res.status))
      const { alerts } = await res.json() as { alerts: Alert[] }
      setPool(prev => {
        const existing = prev[k] ?? []
        const seen     = new Set(existing.map(a => a.id))
        const merged   = [...existing, ...alerts.filter(a => !seen.has(a.id))]
        merged.sort((a, b) => b.created_at.localeCompare(a.created_at))
        return { ...prev, [k]: merged }
      })
    } catch {
      if (req === requestRef.current) setLoadError(true)
      setPool(prev => (prev[k] ? prev : { ...prev, [k]: [] }))
    } finally {
      inflight.current.delete(flightKey)
      if (req === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!pool[key]) loadPage(filter, 0)
  }, [key, filter, pool, loadPage])

  // A new view starts with nothing selected or open.
  useEffect(() => { setSelected(new Set()); setExpanded(new Set()) }, [key])

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const applyRead = useCallback((ids: Set<string> | 'view', f?: InboxFilter) => {
    const nowIso = new Date().toISOString()
    const hit = (r: AlertIndexRow) => (ids === 'view' ? matchesFilter(r, f!, true) : ids.has(r.id))
    setIndex(prev => prev.map(r => (r.read_at == null && hit(r) ? { ...r, read_at: nowIso } : r)))
    setPool(prev => {
      const next: Record<string, Alert[]> = {}
      for (const [k, arr] of Object.entries(prev)) {
        next[k] = arr.map(a => (a.read_at == null && hit(a) ? { ...a, read_at: nowIso } : a))
      }
      return next
    })
  }, [])

  const removeIds = useCallback((ids: Set<string>) => {
    setIndex(prev => prev.filter(r => !ids.has(r.id)))
    setPool(prev => {
      const next: Record<string, Alert[]> = {}
      for (const [k, arr] of Object.entries(prev)) next[k] = arr.filter(a => !ids.has(a.id))
      return next
    })
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n })
  }, [])

  /** PATCH { ids } — used for opened rows, selections, and "mark all" under a client filter. */
  const markRead = useCallback(async (ids: string[]) => {
    const unread = ids.filter(id => index.find(r => r.id === id)?.read_at == null)
    if (!unread.length) return
    applyRead(new Set(unread))
    try {
      for (let i = 0; i < unread.length; i += PATCH_CHUNK) {
        await fetch('/api/admin/alerts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: unread.slice(i, i + PATCH_CHUNK) }),
          keepalive: true,
        })
      }
      router.refresh()
    } catch {/* non-fatal: the dot comes back on the next visit */}
  }, [index, applyRead, router])

  async function markAllReadInView() {
    const f = { ...filter, unreadOnly: false }
    if (f.client) {
      await markRead(index.filter(r => r.read_at == null && matchesFilter(r, f)).map(r => r.id))
      return
    }
    // No client filter: the route can do it in one statement (optionally scoped to the type).
    applyRead('view', f)
    try {
      const body: Record<string, unknown> = { mark_all_read: true }
      if (f.tab !== 'all') body.type = f.tab
      await fetch('/api/admin/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      router.refresh()
    } catch {/* non-fatal */}
  }

  /** DELETE /api/admin/alerts/[id] per alert (soft dismiss), a few at a time. */
  const dismiss = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    setBusyIds(prev => new Set(Array.from(prev).concat(ids)))
    const total = ids.length
    let done = 0
    const failed: string[] = []
    if (total > 1) setProgress({ done: 0, total })

    const queue = [...ids]
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift()!
        try {
          const res = await fetch(`/api/admin/alerts/${id}`, { method: 'DELETE' })
          if (!res.ok) throw new Error(String(res.status))
          removeIds(new Set([id]))
        } catch {
          failed.push(id)
        }
        done++
        if (total > 1) setProgress({ done, total })
      }
    }
    await Promise.all(Array.from({ length: Math.min(DISMISS_PARALLEL, total) }, worker))

    setBusyIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n })
    setProgress(null)
    setNotice(failed.length ? `${failed.length} alert${failed.length === 1 ? '' : 's'} could not be dismissed. Try again.` : null)
    router.refresh()
  }, [removeIds, router])

  function requestDismiss(ids: string[], scopeLabel?: string) {
    if (ids.length <= 1) { dismiss(ids); return }
    setConfirm({
      ids,
      title: `Dismiss ${ids.length} alerts?`,
      body: `${scopeLabel ?? 'These alerts'} will be removed from the inbox for everyone. The cron jobs will raise them again if the problem is still there.`,
    })
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function toggleRow(groupKey: string, ids: string[]) {
    const opening = !expanded.has(groupKey)
    setExpanded(prev => {
      const next = new Set(prev)
      if (opening) next.add(groupKey)
      else next.delete(groupKey)
      return next
    })
    if (opening) markRead(ids)
  }

  function selectIds(ids: string[], checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      ids.forEach(id => (checked ? next.add(id) : next.delete(id)))
      return next
    })
  }

  const loadedIds    = list.map(a => a.id)
  const allLoadedSel = loadedIds.length > 0 && loadedIds.every(id => selected.has(id))
  const tabLabel     = TABS.find(t => t.key === tab)?.label ?? 'All'
  const viewName     = [tab !== 'all' ? tabLabel : null, client ? selectedClientName : null].filter(Boolean).join(' · ')

  function onMenu(id: string) {
    if (id === 'read') markAllReadInView()
    if (id === 'select') setSelectMode(true)
    if (id === 'dismiss-view') {
      const ids = viewRows.map(r => r.id)
      requestDismiss(ids, `Every ${unreadOnly ? 'unread ' : ''}alert in ${viewName || 'the inbox'} (${ids.length}, including ones not loaded yet)`)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="inbox">
      <div className="inbox__header">
        <div className="inbox__heading">
          <h1 className="inbox__h1">Alerts</h1>
          <p className="inbox__summary" aria-live="polite">
            {now == null ? ' ' : (
              <>
                {summary.unread === 0
                  ? <span>All caught up</span>
                  : <span><strong>{summary.newToday}</strong> new today</span>}
                {summary.critical > 0 && (
                  <>
                    <span className="inbox__sep" aria-hidden>·</span>
                    <span className="inbox__summary-critical"><strong>{summary.critical}</strong> critical</span>
                  </>
                )}
                <span className="inbox__sep" aria-hidden>·</span>
                <span>{summary.unread} unread of {summary.open}</span>
              </>
            )}
          </p>
        </div>
        <div className="inbox__header-actions">
          <button
            type="button"
            className="btn btn-secondary inbox-btn"
            aria-pressed={selectMode}
            onClick={() => { setSelectMode(v => !v); setSelected(new Set()) }}
          >
            <CheckSquare size={15} aria-hidden />
            {selectMode ? 'Done' : 'Select'}
          </button>
          <InboxMenu
            onChoose={onMenu}
            items={[
              { id: 'read', label: `Mark all as read${viewName ? ` in ${viewName}` : ''}`, disabled: summary.unread === 0 },
              { id: 'select', label: 'Select alerts…', disabled: selectMode },
              { id: 'dismiss-view', label: `Dismiss all in this view (${viewRows.length})`, disabled: viewRows.length === 0, danger: true },
            ]}
          />
        </div>
      </div>

      <ScrollTabs
        items={TABS.map(t => ({ id: t.key, label: t.label, count: tabCounts[t.key] ?? 0 }))}
        activeId={tab}
        onSelect={id => setTab(id as TabKey)}
        label="Alert types"
      />

      <div className="inbox__filters">
        <label className="inbox__client">
          <span className="sr-only">Client</span>
          <select className="input inbox__select" value={client} onChange={e => setClient(e.target.value)}>
            <option value="">All clients</option>
            {selectedClientMissing && <option value={client}>{selectedClientName} (0)</option>}
            {clientOptions.map(c => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
          </select>
        </label>
        <button
          type="button"
          className="inbox-chip"
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly(v => !v)}
        >
          <span className="inbox-chip__switch" aria-hidden />
          Unread only
        </button>
      </div>

      {selectMode && (
        <div className="inbox__bulk" role="region" aria-label="Bulk actions">
          <label className="inbox__bulk-all">
            <input
              type="checkbox"
              checked={allLoadedSel}
              ref={el => { if (el) el.indeterminate = selected.size > 0 && !allLoadedSel }}
              onChange={e => setSelected(e.target.checked ? new Set(loadedIds) : new Set())}
              aria-label="Select all loaded alerts"
            />
            <span>{selected.size > 0 ? `${selected.size} selected` : 'Select all'}</span>
          </label>
          <div className="inbox__bulk-actions">
            <button type="button" className="btn btn-secondary inbox-btn" disabled={selected.size === 0} onClick={() => markRead(Array.from(selected))}>
              Mark read
            </button>
            <button
              type="button"
              className="btn btn-secondary inbox-btn inbox-btn--danger"
              disabled={selected.size === 0}
              onClick={() => requestDismiss(Array.from(selected), `The ${selected.size} selected alerts`)}
            >
              Dismiss selected
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className="inbox__notice" role="status">
          {notice}
          <button type="button" className="inbox__notice-close" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}

      {now == null || (list.length === 0 && loading) ? (
        <div className="inbox__list" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="inbox-skeleton">
              <span className="inbox-skeleton__icon" />
              <span className="inbox-skeleton__lines"><span /><span /></span>
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="inbox__empty">
          <BellSlash size={32} weight="thin" aria-hidden />
          <p>
            {loadError ? 'Alerts could not be loaded.' : unreadOnly ? 'No unread alerts here.' : `No alerts${viewName ? ` in ${viewName}` : ''}.`}
          </p>
          {loadError
            ? <button type="button" className="btn btn-secondary inbox-btn" onClick={() => loadPage(filter, 0)}>Retry</button>
            : unreadOnly && <button type="button" className="btn btn-secondary inbox-btn" onClick={() => setUnreadOnly(false)}>Show read alerts too</button>}
        </div>
      ) : (
        <div className="inbox__list">
          {sections.map(sec => (
            <section key={sec.label} className="inbox-day" aria-label={sec.label}>
              <h2 className="inbox-day__heading">
                <span>{sec.label}</span>
                <span className="inbox-day__count">{sec.alertCount}</span>
              </h2>
              <ul className="inbox-day__rows">
                {sec.groups.map(g => {
                  const ids = g.items.map(i => i.id)
                  const selCount = ids.filter(id => selected.has(id)).length
                  return (
                    <AlertRow
                      key={g.key}
                      group={g}
                      now={now}
                      expanded={expanded.has(g.key)}
                      selectMode={selectMode}
                      selection={selCount === 0 ? 'none' : selCount === ids.length ? 'all' : 'some'}
                      busy={ids.some(id => busyIds.has(id))}
                      onToggle={() => toggleRow(g.key, ids)}
                      onSelect={checked => selectIds(ids, checked)}
                      onOpenLink={() => markRead(ids)}
                      onDismiss={d => requestDismiss(d, d.length === ids.length && ids.length > 1 ? `All ${ids.length} occurrences of this alert` : undefined)}
                    />
                  )
                })}
              </ul>
            </section>
          ))}

          <div className="inbox__more">
            <span className="inbox__more-count">
              Showing {list.length} of {Math.max(viewRows.length, list.length)}
            </span>
            {hasMore && (
              <button type="button" className="btn btn-secondary inbox-btn" disabled={loading} onClick={() => loadPage(filter, serverOffset)}>
                {loading ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, viewRows.length - serverOffset)} more`}
              </button>
            )}
            {loadError && list.length > 0 && <span className="inbox__more-error">Couldn’t load more.</span>}
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmActionDialog
          title={confirm.title}
          body={progress ? `Dismissing ${progress.done} of ${progress.total}…` : confirm.body}
          busy={progress != null}
          choices={[{ id: 'dismiss', label: `Dismiss ${confirm.ids.length} alerts`, tone: 'destructive' }]}
          onCancel={() => setConfirm(null)}
          onChoose={async () => {
            await dismiss(confirm.ids)
            setConfirm(null)
            setSelectMode(false)
          }}
        />
      )}
    </div>
  )
}
