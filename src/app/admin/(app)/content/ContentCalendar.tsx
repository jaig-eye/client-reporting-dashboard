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
const DAY_NAMES   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

// Status → display config
const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  pending:     { label: 'Awaiting',   bg: 'rgba(245,158,11,0.12)', color: '#b45309', dot: '#f59e0b' },
  scheduled:   { label: 'Scheduled',  bg: 'rgba(99,102,241,0.10)', color: '#4338ca', dot: '#6366f1' },
  generating:  { label: 'Generating', bg: 'rgba(59,130,246,0.12)', color: '#1d4ed8', dot: '#3b82f6' },
  generated:   { label: 'Generated',  bg: 'rgba(16,185,129,0.10)', color: '#065f46', dot: '#10b981' },
  draft_saved: { label: 'On WP',      bg: 'rgba(16,185,129,0.10)', color: '#065f46', dot: '#10b981' },
  published:   { label: 'Published',  bg: 'rgba(16,185,129,0.15)', color: '#065f46', dot: '#059669' },
  rejected:    { label: 'Rejected',   bg: 'rgba(239,68,68,0.08)',  color: '#991b1b', dot: '#ef4444' },
}

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, bg: 'rgba(107,114,128,0.1)', color: '#374151', dot: '#9ca3af' }
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

// Returns 0=Mon … 6=Sun for ISO week
function getFirstDayOfMonth(year: number, month: number) {
  const d = new Date(year, month, 1).getDay()
  return (d + 6) % 7
}

export default function ContentCalendar({
  items: initialItems,
  clients,
}: {
  items:   CalendarItem[]
  clients: { id: string; name: string }[]
}) {
  const router     = useRouter()
  const today      = new Date()
  const [year,  setYear]         = useState(today.getFullYear())
  const [month, setMonth]        = useState(today.getMonth())
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [items,        setItems]        = useState(initialItems)
  const [generating,   setGenerating]   = useState<Set<string>>(new Set())
  const [approveErr,   setApproveErr]   = useState<Record<string, string>>({})

  useEffect(() => { setItems(initialItems) }, [initialItems])

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  // Filter items for this month
  const filtered = items.filter(item => {
    if (!item.targetPublishDate) return false
    const d = new Date(item.targetPublishDate + 'T00:00:00')
    if (d.getFullYear() !== year || d.getMonth() !== month) return false
    if (clientFilter !== 'all' && item.clientId !== clientFilter) return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'awaiting' && item.status !== 'pending') return false
      if (statusFilter !== 'awaiting' && item.status !== statusFilter) return false
    }
    return true
  })

  // Group by day of month
  const byDay = new Map<number, CalendarItem[]>()
  for (const item of filtered) {
    const d = new Date(item.targetPublishDate! + 'T00:00:00')
    const day = d.getDate()
    const arr = byDay.get(day) ?? []
    arr.push(item)
    byDay.set(day, arr)
  }

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay    = getFirstDayOfMonth(year, month)

  // Build grid cells (leading empty + days)
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null)

  const approveTopic = useCallback(async (item: CalendarItem) => {
    if (generating.has(item.id)) return
    setGenerating(prev => new Set(prev).add(item.id))
    setApproveErr(prev => { const n = { ...prev }; delete n[item.id]; return n })

    // Optimistically update to generating
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'generating' } : i))

    try {
      // 1. Mark topic as generating
      const patchRes = await fetch(`/api/admin/content/topics/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })
      if (!patchRes.ok) throw new Error((await patchRes.json()).error || 'Failed')

      // 2. Fire generate immediately (keepalive so it survives navigation)
      fetch('/api/admin/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: item.id }),
        keepalive: true,
      }).then(() => {
        router.refresh()
      }).catch(() => {
        router.refresh()
      })
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
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={prevMonth} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8125rem' }}>‹</button>
          <span style={{ fontSize: '0.9375rem', fontWeight: 600, minWidth: 140, textAlign: 'center', color: 'var(--text-primary)' }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button onClick={nextMonth} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8125rem' }}>›</button>
          <button onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }}
            className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '4px 8px', marginLeft: 4 }}>
            Today
          </button>
        </div>

        {/* Client filter */}
        <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
          style={{ fontSize: '0.8125rem', padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
          <option value="all">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Status tabs */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-muted)', borderRadius: 24, padding: 3 }}>
          {[
            { id: 'all',       label: 'All' },
            { id: 'awaiting',  label: 'Awaiting Approval' },
            { id: 'generating',label: 'Generating' },
            { id: 'draft_saved', label: 'On WordPress' },
            { id: 'rejected',  label: 'Rejected' },
          ].map(t => (
            <button key={t.id} style={tabStyle(statusFilter === t.id)} onClick={() => setStatusFilter(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        {/* Items count */}
        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Calendar grid */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
          {DAY_NAMES.map(d => (
            <div key={d} style={{
              padding: '8px 10px', fontSize: '0.6875rem', fontWeight: 600,
              color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em',
              textAlign: 'center',
            }}>{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((day, idx) => {
            const isToday = day !== null && day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
            const dayItems = day !== null ? (byDay.get(day) ?? []) : []
            const isLastRow = idx >= cells.length - 7
            const isLastCol = (idx + 1) % 7 === 0

            return (
              <div key={idx} style={{
                minHeight: 110, padding: '6px 8px',
                borderRight: isLastCol ? 'none' : '1px solid var(--border)',
                borderBottom: isLastRow ? 'none' : '1px solid var(--border)',
                background: day === null ? 'var(--bg-muted, #f8fafc)' : 'var(--bg-surface)',
                opacity: day === null ? 0.5 : 1,
              }}>
                {day !== null && (
                  <>
                    {/* Day number */}
                    <div style={{ marginBottom: 4 }}>
                      <span style={{
                        fontSize: '0.75rem', fontWeight: isToday ? 700 : 400,
                        color: isToday ? '#fff' : 'var(--text-faint)',
                        background: isToday ? 'var(--blue)' : 'transparent',
                        borderRadius: isToday ? '50%' : 0,
                        width: isToday ? 22 : 'auto', height: isToday ? 22 : 'auto',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {day}
                      </span>
                    </div>

                    {/* Item pills */}
                    {dayItems.slice(0, 4).map(item => (
                      <CalendarPill
                        key={item.id}
                        item={item}
                        isGenerating={generating.has(item.id)}
                        error={approveErr[item.id]}
                        onApprove={approveTopic}
                      />
                    ))}
                    {dayItems.length > 4 && (
                      <div style={{ fontSize: '0.625rem', color: 'var(--text-faint)', marginTop: 2 }}>
                        +{dayItems.length - 4} more
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CalendarPill({
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
  const cfg    = getStatusConfig(isGenerating ? 'generating' : item.status)
  const isPost = item.type === 'post'
  const label  = isPost ? (item.title ?? item.targetKeyword ?? 'Post') : (item.topicText ?? item.targetKeyword ?? 'Topic')

  return (
    <div
      title={error ? `Error: ${error}` : label}
      style={{
        marginBottom: 3, padding: '3px 6px', borderRadius: 4,
        background: cfg.bg, cursor: 'default',
        fontSize: '0.625rem', lineHeight: 1.35,
        border: `1px solid ${cfg.dot}30`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {/* Status dot */}
        <span style={{
          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
          background: isGenerating ? '#3b82f6' : cfg.dot,
          animation: isGenerating ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }} />

        {/* Label */}
        <span style={{
          color: cfg.color, fontWeight: 500, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 90,
        }}>
          {item.clientName.split(' ')[0]} — {label}
        </span>

        {/* WP link for uploaded posts */}
        {isPost && item.wpPostId && item.wpSiteUrl && (
          <a
            href={`${item.wpSiteUrl}/wp-admin/post.php?post=${item.wpPostId}&action=edit`}
            target="_blank"
            rel="noopener noreferrer"
            title="Edit in WordPress"
            onClick={e => e.stopPropagation()}
            style={{ color: '#6366f1', fontSize: '0.6rem', flexShrink: 0, textDecoration: 'none' }}
          >
            WP↗
          </a>
        )}

        {/* Approve button for pending topics */}
        {!isPost && item.status === 'pending' && !isGenerating && (
          <button
            onClick={e => { e.stopPropagation(); onApprove(item) }}
            style={{
              fontSize: '0.5625rem', padding: '1px 5px', borderRadius: 3,
              background: '#6366f1', color: '#fff', border: 'none',
              cursor: 'pointer', flexShrink: 0, fontWeight: 600,
            }}
          >
            ✓
          </button>
        )}

        {/* Generating spinner */}
        {isGenerating && (
          <span style={{ fontSize: '0.5625rem', color: '#3b82f6' }}>…</span>
        )}
      </div>

      {error && (
        <div style={{ color: '#ef4444', fontSize: '0.5625rem', marginTop: 1 }}>
          {error}
        </div>
      )}
    </div>
  )
}
