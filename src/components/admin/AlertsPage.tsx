'use client'

// The Alerts inbox (the idea and the data handling come from feat/ui-overhaul).
//
// Production carries ~1000 open alerts, most of them the Ad Fuel cron repeating itself daily. So it
// is an inbox: quiet rows under day headings, repeats collapsed into one row with a ×N, and the full
// body only when a row is opened.
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
import { BellSlash, CheckSquare, Checks, CheckCircle, Trash, WarningCircle } from '@phosphor-icons/react'
import '@/styles/admin/alerts.css'
import PageHeader from '@/components/ui/PageHeader'
import { PillTabs } from '@/components/ui/PillTabs'
import Switch from '@/components/ui/Switch'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { SkRows } from '@/components/ui/Skeleton'
import AlertRow from '@/components/admin/alerts/AlertRow'
import {
  collapseRepeats, isToday, matchesFilter, sectionByDay,
  type Alert, type AlertIndexRow, type InboxFilter,
} from '@/components/admin/alerts/inbox'

const TABS = [
  { key: 'all',         label: 'All' },
  { key: 'ad_fuel',     label: 'Ad Fuel' },
  { key: 'ad_insights', label: 'Ad insights' },
  { key: 'content',     label: 'Content' },
  { key: 'integration', label: 'Integrations' },
] as const
type TabKey = typeof TABS[number]['key']

const PAGE_SIZE        = 100
const DISMISS_PARALLEL = 6
const PATCH_CHUNK      = 100

const filterKey = (f: InboxFilter) => `${f.tab}|${f.client}|${f.unreadOnly ? 1 : 0}`

interface PendingConfirm { ids: string[]; title: string; body: string }

export default function AlertsPage({ initialAlerts, initialIndex }: {
  initialAlerts: Alert[]
  initialIndex:  AlertIndexRow[]
}) {
  const router = useRouter()

  const [tab,        setTab]        = useState<TabKey>('all')
  const [client,     setClient]     = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const filter = useMemo<InboxFilter>(() => ({ tab, client, unreadOnly }), [tab, client, unreadOnly])
  const key    = filterKey(filter)

  const [index, setIndex] = useState<AlertIndexRow[]>(initialIndex)
  // Full alerts loaded per filter. Every change is applied to every list.
  const [pool, setPool]   = useState<Record<string, Alert[]>>({ [filterKey({ tab: 'all', client: '', unreadOnly: false })]: initialAlerts })
  const [loading, setLoading]     = useState(false)
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

  // Day headings and times depend on the viewer's clock and timezone, so they render after mount
  // rather than risk a server/client mismatch.
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

  const sections = useMemo(() => (now == null ? [] : sectionByDay(collapseRepeats(list), now)), [list, now])

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
      if (!r.client_id || !matchesFilter(r, { tab, client: '', unreadOnly: false })) continue
      const cur = byId.get(r.client_id)
      if (cur) cur.count++
      else byId.set(r.client_id, { name: r.client_name ?? 'Unnamed client', count: 1 })
    }
    return Array.from(byId, ([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name))
  }, [index, tab])

  // The selected client can vanish from the tab's list; keep it selectable so the filter still shows.
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
    const k = filterKey(f)
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

  useEffect(() => { if (!pool[key]) loadPage(filter, 0) }, [key, filter, pool, loadPage])

  // A new view starts with nothing selected or open.
  useEffect(() => { setSelected(new Set()); setExpanded(new Set()) }, [key])

  // ─── Changes ────────────────────────────────────────────────────────────────

  const applyRead = useCallback((ids: Set<string> | 'view', f?: InboxFilter) => {
    const nowIso = new Date().toISOString()
    const hit = (r: AlertIndexRow) => (ids === 'view' ? matchesFilter(r, f!, true) : ids.has(r.id))
    setIndex(prev => prev.map(r => (r.read_at == null && hit(r) ? { ...r, read_at: nowIso } : r)))
    setPool(prev => {
      const next: Record<string, Alert[]> = {}
      for (const [k, arr] of Object.entries(prev)) next[k] = arr.map(a => (a.read_at == null && hit(a) ? { ...a, read_at: nowIso } : a))
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

  /** PATCH { ids }: opened rows, selections, and "mark all" under a client filter. */
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
      // The sidebar's unread count is server-rendered.
      router.refresh()
    } catch {/* not worth interrupting for: the dot comes back on the next visit */}
  }, [index, applyRead, router])

  async function markAllReadInView() {
    const f = { ...filter, unreadOnly: false }
    if (f.client) {
      await markRead(index.filter(r => r.read_at == null && matchesFilter(r, f)).map(r => r.id))
      return
    }
    // No client filter: the route does it in one statement (optionally scoped to the type).
    applyRead('view', f)
    try {
      const body: Record<string, unknown> = { mark_all_read: true }
      if (f.tab !== 'all') body.type = f.tab
      await fetch('/api/admin/alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      router.refresh()
    } catch {/* as above */}
  }

  /** DELETE /api/admin/alerts/[id] per alert (a soft dismiss), a few at a time. */
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
    setNotice(failed.length ? `${failed.length} alert${failed.length === 1 ? '' : 's'} couldn’t be dismissed. Try again.` : null)
    router.refresh()
  }, [removeIds, router])

  function requestDismiss(ids: string[], scopeLabel?: string) {
    if (ids.length <= 1) { void dismiss(ids); return }
    setConfirm({
      ids,
      title: `Dismiss ${ids.length} alerts?`,
      body: `${scopeLabel ?? 'These alerts'} leave the inbox for everyone. The checks raise them again if the problem is still there.`,
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
    if (opening) void markRead(ids)
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
  const viewName     = [tab !== 'all' ? tabLabel : null, client ? selectedClientName : null].filter(Boolean).join(', ')

  // ─── Render ─────────────────────────────────────────────────────────────────

  const summaryLine = now == null ? ' ' : (
    <span className="al-summary" aria-live="polite">
      {summary.unread === 0
        ? <span>All caught up.</span>
        : <span><strong>{summary.newToday}</strong> new today</span>}
      {summary.critical > 0 && <span className="al-summary-critical"><strong>{summary.critical}</strong> critical</span>}
      <span>{summary.unread} unread of {summary.open}</span>
    </span>
  )

  return (
    <div className="al-page">
      <PageHeader
        title="Alerts"
        description={summaryLine}
        actions={<>
          <button
            type="button"
            className="btn btn-secondary"
            aria-pressed={selectMode}
            onClick={() => { setSelectMode(v => !v); setSelected(new Set()) }}
          >
            <CheckSquare size={15} aria-hidden />{selectMode ? 'Done' : 'Select'}
          </button>
          <ActionMenu
            label="Inbox actions"
            items={[
              { key: 'read', label: viewName ? `Mark all in ${viewName} as read` : 'Mark all as read', icon: <Checks size={15} />, disabled: summary.unread === 0, onSelect: () => void markAllReadInView() },
              {
                key: 'dismiss-view', label: `Dismiss all in this view (${viewRows.length})`, icon: <Trash size={15} />,
                disabled: viewRows.length === 0, danger: true, separated: true,
                onSelect: () => requestDismiss(viewRows.map(r => r.id), `Every ${unreadOnly ? 'unread ' : ''}alert in ${viewName || 'the inbox'}, including ones not loaded yet,`),
              },
            ]}
          />
        </>}
      />

      <PillTabs
        label="Alert types"
        activeId={tab}
        onSelect={id => setTab(id as TabKey)}
        items={TABS.map(t => ({ id: t.key, label: t.label, count: tabCounts[t.key] ?? 0 }))}
      />

      <div className="al-filters">
        <label className="al-client-filter">
          <span className="sr-only">Client</span>
          <select className="input" value={client} onChange={e => setClient(e.target.value)}>
            <option value="">All clients</option>
            {selectedClientMissing && <option value={client}>{selectedClientName} (0)</option>}
            {clientOptions.map(c => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
          </select>
        </label>
        <Switch checked={unreadOnly} onChange={setUnreadOnly} label="Unread only" />
      </div>

      {selectMode && (
        <div className="al-bulk" role="region" aria-label="Selected alerts">
          <label className="al-bulk-all">
            <input
              type="checkbox"
              checked={allLoadedSel}
              ref={el => { if (el) el.indeterminate = selected.size > 0 && !allLoadedSel }}
              onChange={e => setSelected(e.target.checked ? new Set(loadedIds) : new Set())}
              aria-label="Select every loaded alert"
            />
            <span>{selected.size > 0 ? `${selected.size} selected` : 'Select all'}</span>
          </label>
          <span className="al-bulk-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={selected.size === 0} onClick={() => void markRead(Array.from(selected))}>
              <CheckCircle size={14} aria-hidden />Mark read
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm al-danger"
              disabled={selected.size === 0}
              onClick={() => requestDismiss(Array.from(selected), `The ${selected.size} selected alerts`)}
            >
              <Trash size={14} aria-hidden />Dismiss
            </button>
          </span>
        </div>
      )}

      {notice && (
        <div className="ui-notice ui-notice--danger" role="status">
          <WarningCircle size={16} weight="fill" aria-hidden />
          <span>{notice}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {now == null || (list.length === 0 && loading) ? (
        <div className="card al-list" aria-busy="true" aria-label="Loading alerts"><SkRows rows={6} /></div>
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={loadError ? <WarningCircle size={22} weight="duotone" /> : <BellSlash size={22} weight="duotone" />}
            tone={loadError ? 'red' : 'accent'}
            title={loadError ? 'Alerts didn’t load' : unreadOnly ? 'No unread alerts here' : `No alerts${viewName ? ` in ${viewName}` : ''}`}
            actions={loadError
              ? <button type="button" className="btn btn-secondary" onClick={() => loadPage(filter, 0)}>Try again</button>
              : unreadOnly && <button type="button" className="btn btn-secondary" onClick={() => setUnreadOnly(false)}>Show read alerts too</button>}
          >
            {loadError ? 'Check your connection, then try again.' : 'Low balances, performance swings, posts waiting on you and broken connections show up here.'}
          </EmptyState>
        </div>
      ) : (
        <div className="card al-list">
          {sections.map(sec => (
            <section key={sec.label} className="al-day" aria-label={sec.label}>
              <h2 className="al-day-head"><span>{sec.label}</span><span className="al-day-count">{sec.alertCount}</span></h2>
              <ul className="al-rows">
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
                      onOpenLink={() => void markRead(ids)}
                      onDismiss={d => requestDismiss(d, d.length === ids.length && ids.length > 1 ? `All ${ids.length} times this alert fired` : undefined)}
                    />
                  )
                })}
              </ul>
            </section>
          ))}

          <div className="al-more">
            <span>Showing {list.length} of {Math.max(viewRows.length, list.length)}</span>
            {hasMore && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => loadPage(filter, serverOffset)}>
                {loading ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, viewRows.length - serverOffset)} more`}
              </button>
            )}
            {loadError && list.length > 0 && <span className="al-more-error">The next page didn’t load.</span>}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        tone="danger"
        title={confirm?.title ?? ''}
        confirmLabel={`Dismiss ${confirm?.ids.length ?? 0} alerts`}
        busyLabel={progress ? `Dismissing ${progress.done} of ${progress.total}…` : 'Dismissing…'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          await dismiss(confirm.ids)
          setConfirm(null)
          setSelectMode(false)
        }}
      >
        {confirm?.body}
      </ConfirmDialog>
    </div>
  )
}
