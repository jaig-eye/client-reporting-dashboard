'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

export type CalendarItem = {
  id:               string
  type:             'topic' | 'post'
  clientId:         string
  clientName:       string
  status:           string
  targetPublishDate: string | null
  topicText:        string | null
  title:            string | null
  targetKeyword:    string | null
  wpPostId:         number | null
  wpSiteUrl:        string | null
  rationale:        string | null
  competitionLevel: string | null
  generationError:  string | null
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

const STATUS_CONFIG: Record<string, { label: string; dot: string; color: string }> = {
  pending:     { label: 'Awaiting Approval', dot: '#f59e0b', color: '#b45309' },
  scheduled:   { label: 'Scheduled',         dot: '#6366f1', color: '#4338ca' },
  generating:  { label: 'Generating',        dot: '#3b82f6', color: '#1d4ed8' },
  generated:   { label: 'Generated',         dot: '#10b981', color: '#065f46' },
  draft_saved: { label: 'On WordPress',      dot: '#10b981', color: '#065f46' },
  published:   { label: 'Published',         dot: '#059669', color: '#065f46' },
  rejected:    { label: 'Rejected',          dot: '#ef4444', color: '#991b1b' },
}

function getStatusCfg(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, dot: '#9ca3af', color: '#374151' }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

function isPast(dateStr: string): boolean {
  return new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString())
}

export default function ContentCalendar({
  items: initialItems,
  clients,
}: {
  items:   CalendarItem[]
  clients: { id: string; name: string }[]
}) {
  const router   = useRouter()
  const today    = new Date()
  const [year,         setYear]         = useState(today.getFullYear())
  const [month,        setMonth]        = useState(today.getMonth())
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [items,        setItems]        = useState(initialItems)
  const [generating,   setGenerating]   = useState<Set<string>>(new Set())
  const [approveErr,   setApproveErr]   = useState<Record<string, string>>({})
  const [collapsed,    setCollapsed]    = useState(false)

  useEffect(() => { setItems(initialItems) }, [initialItems])

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  // Pending approval items (all months, for banner)
  const pendingApproval = items.filter(i => i.type === 'topic' && (i.status === 'pending' || i.status === 'scheduled'))

  // Group pending by client
  const pendingByClient = new Map<string, { clientName: string; items: CalendarItem[] }>()
  for (const item of pendingApproval) {
    const existing = pendingByClient.get(item.clientId)
    if (existing) { existing.items.push(item) }
    else pendingByClient.set(item.clientId, { clientName: item.clientName, items: [item] })
  }

  // Filter items for timeline (current month)
  const filtered = items.filter(item => {
    if (!item.targetPublishDate) return false
    const d = new Date(item.targetPublishDate + 'T00:00:00')
    if (d.getFullYear() !== year || d.getMonth() !== month) return false
    if (clientFilter !== 'all' && item.clientId !== clientFilter) return false
    if (statusFilter === 'awaiting' && !(item.type === 'topic' && (item.status === 'pending' || item.status === 'scheduled'))) return false
    if (statusFilter === 'generating' && item.status !== 'generating') return false
    if (statusFilter === 'draft_saved' && item.status !== 'draft_saved') return false
    if (statusFilter === 'rejected' && item.status !== 'rejected') return false
    return true
  })

  // Group by date string
  const byDate = new Map<string, CalendarItem[]>()
  for (const item of filtered) {
    const date = item.targetPublishDate!
    const arr = byDate.get(date) ?? []
    arr.push(item)
    byDate.set(date, arr)
  }
  const sortedDates = Array.from(byDate.keys()).sort()

  const approveTopic = useCallback(async (item: CalendarItem) => {
    if (generating.has(item.id)) return
    setGenerating(prev => new Set(prev).add(item.id))
    setApproveErr(prev => { const n = { ...prev }; delete n[item.id]; return n })
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'generating' } : i))

    try {
      const patchRes = await fetch(`/api/admin/content/topics/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })
      if (!patchRes.ok) throw new Error(((await patchRes.json()) as { error?: string }).error || 'Failed')
      fetch('/api/admin/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: item.id }),
        keepalive: true,
      }).then(() => router.refresh()).catch(() => router.refresh())
    } catch (err) {
      setApproveErr(prev => ({ ...prev, [item.id]: err instanceof Error ? err.message : 'Failed' }))
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'pending' } : i))
    } finally {
      setGenerating(prev => { const n = new Set(prev); n.delete(item.id); return n })
    }
  }, [generating, router])

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontSize: '0.75rem', fontWeight: active ? 600 : 400, padding: '0.25rem 0.75rem',
    borderRadius: 20, border: 'none', cursor: 'pointer',
    background: active ? 'var(--blue)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    transition: 'background 0.15s, color 0.15s',
  })

  return (
    <div>
      {/* ── Pending Approvals Banner ──────────────────────────────────────────── */}
      {pendingApproval.length > 0 && (
        <div style={{
          marginBottom: 20, borderRadius: 10, overflow: 'hidden',
          border: '1px solid rgba(245,158,11,0.3)',
          background: 'rgba(254,252,232,0.8)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderBottom: collapsed ? 'none' : '1px solid rgba(245,158,11,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', background: '#f59e0b',
                animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0,
              }} />
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#92400e' }}>
                {pendingApproval.length} topic{pendingApproval.length !== 1 ? 's' : ''} awaiting approval
                {' '}across {pendingByClient.size} client{pendingByClient.size !== 1 ? 's' : ''}
              </span>
            </div>
            <button
              onClick={() => setCollapsed(c => !c)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#b45309', padding: '2px 6px' }}
            >
              {collapsed ? 'Show ▾' : 'Hide ▴'}
            </button>
          </div>

          {!collapsed && (
            <div style={{ padding: '8px 16px 12px' }}>
              {Array.from(pendingByClient.entries()).map(([clientId, { clientName, items: clientItems }]) => (
                <div key={clientId} style={{ marginBottom: 8 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#b45309' }}>{clientName}</span>
                    <span style={{ fontSize: '0.75rem', color: '#d97706' }}>
                      {clientItems.length} topic{clientItems.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => { setClientFilter(clientId); setStatusFilter('awaiting') }}
                      style={{
                        fontSize: '0.6875rem', padding: '2px 8px', borderRadius: 999,
                        background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      Review →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Controls ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={prevMonth} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8125rem' }}>‹</button>
          <span style={{ fontSize: '0.9375rem', fontWeight: 600, minWidth: 140, textAlign: 'center', color: 'var(--text-primary)' }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button onClick={nextMonth} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8125rem' }}>›</button>
          <button
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }}
            className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '4px 8px', marginLeft: 4 }}
          >
            Today
          </button>
        </div>

        {/* Client filter */}
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          style={{ fontSize: '0.8125rem', padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        >
          <option value="all">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Status filter */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-muted)', borderRadius: 24, padding: 3 }}>
          {[
            { id: 'all',        label: 'All'              },
            { id: 'awaiting',   label: 'Awaiting Approval'},
            { id: 'generating', label: 'Generating'       },
            { id: 'draft_saved',label: 'On WordPress'     },
            { id: 'rejected',   label: 'Rejected'         },
          ].map(t => (
            <button key={t.id} style={tabStyle(statusFilter === t.id)} onClick={() => setStatusFilter(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Timeline list ────────────────────────────────────────────────────── */}
      {sortedDates.length === 0 ? (
        <div className="card p-8" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            No items for {MONTH_NAMES[month]} {year}
            {statusFilter !== 'all' ? ` with filter "${statusFilter}"` : ''}.
          </p>
        </div>
      ) : (
        <div>
          {sortedDates.map(dateStr => {
            const dateItems = byDate.get(dateStr)!
            const past = isPast(dateStr)

            return (
              <div key={dateStr} style={{ marginBottom: 20 }}>
                {/* Date header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
                }}>
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 700, color: past ? 'var(--text-faint)' : 'var(--text-primary)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
                  }}>
                    {formatDate(dateStr)}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>

                {/* Items for this date */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 0 }}>
                  {dateItems.map(item => (
                    <TimelineRow
                      key={item.id}
                      item={item}
                      isGenerating={generating.has(item.id)}
                      error={approveErr[item.id]}
                      onApprove={approveTopic}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TimelineRow({
  item,
  isGenerating,
  error,
  onApprove,
}: {
  item:         CalendarItem
  isGenerating: boolean
  error?:       string
  onApprove:    (item: CalendarItem) => void
}) {
  const effectiveStatus = isGenerating ? 'generating' : item.status
  const cfg   = getStatusCfg(effectiveStatus)
  const isPost  = item.type === 'post'
  const label   = isPost ? (item.title ?? item.targetKeyword ?? 'Untitled Post') : (item.topicText ?? item.targetKeyword ?? 'Topic')
  const isPendingTopic = !isPost && (item.status === 'pending' || item.status === 'scheduled') && !isGenerating

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderRadius: 8,
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    }}>
      {/* Status dot */}
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: cfg.dot,
        animation: effectiveStatus === 'generating' ? 'pulse 1.5s ease-in-out infinite' : 'none',
      }} />

      {/* Client name */}
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0, minWidth: 80 }}>
        {item.clientName}
      </span>

      <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem', flexShrink: 0 }}>—</span>

      {/* Label */}
      <span style={{
        flex: 1, fontSize: '0.875rem',
        fontStyle: isPost ? 'normal' : 'italic',
        fontWeight: isPost ? 500 : 400,
        color: 'var(--text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>

      {/* Status badge */}
      <span style={{
        fontSize: '0.6875rem', fontWeight: 500, color: cfg.color,
        flexShrink: 0, whiteSpace: 'nowrap',
      }}>
        {isGenerating ? 'Generating…' : cfg.label}
      </span>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {isPendingTopic && (
          <button
            onClick={() => onApprove(item)}
            className="btn btn-primary"
            style={{ fontSize: '0.6875rem', padding: '3px 12px' }}
          >
            Approve
          </button>
        )}
        {isPost && item.wpPostId && item.wpSiteUrl && (
          <a
            href={`${item.wpSiteUrl}/wp-admin/post.php?post=${item.wpPostId}&action=edit`}
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '0.6875rem', color: 'var(--blue)', textDecoration: 'none', fontWeight: 500 }}
          >
            Edit in WP ↗
          </a>
        )}
        {isPost && item.wpSiteUrl && !item.wpPostId && (
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)' }}>No WP draft</span>
        )}
      </div>

      {error && (
        <span style={{ fontSize: '0.6875rem', color: '#ef4444', flexShrink: 0 }}>{error}</span>
      )}
    </div>
  )
}
