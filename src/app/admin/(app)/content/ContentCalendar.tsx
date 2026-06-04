'use client'

import { useState, useEffect } from 'react'
import { useRouter }           from 'next/navigation'
import RationaleModal          from '@/components/admin/RationaleModal'

export type CalendarItem = {
  id:               string
  type:             'topic' | 'post'
  contentType?:     string
  clientId:         string
  clientName:       string
  status:           string
  targetPublishDate: string | null
  topicText:        string | null
  title:            string | null
  targetKeyword:    string | null
  wpPostId:         number | null
  wpSiteUrl:        string | null
  publishedUrl:     string | null
  rationale:        string | null
  competitionLevel: string | null
  generationError:  string | null
  keywordOpportunity: string | null
  rankingStrategy:    string | null
  audienceIntent:     string | null
  whyNow:             string | null
  suggestedTitle:     string | null
  searchVolume:       number | null
  keywordDifficulty:  number | null
  clusterGroup:       string | null
}

const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_ABBREV = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

const MONTH_PILL_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6', '#f97316', '#ef4444',
]

const BADGE_PALETTE = [
  { bg: 'rgba(59,130,246,0.12)',  text: '#3b82f6' },
  { bg: 'rgba(16,185,129,0.12)', text: '#10b981' },
  { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' },
  { bg: 'rgba(139,92,246,0.12)', text: '#8b5cf6' },
  { bg: 'rgba(20,184,166,0.12)', text: '#14b8a6' },
  { bg: 'rgba(249,115,22,0.12)', text: '#f97316' },
  { bg: 'rgba(239,68,68,0.12)',  text: '#ef4444' },
]

const STATUS_CONFIG: Record<string, { label: string; dot: string; color: string; bg: string; border: string }> = {
  pending:     { label: 'Pending',    dot: '#f59e0b', color: '#b45309', bg: '#fef3c7', border: '#f59e0b' },
  scheduled:   { label: 'Approved',  dot: '#3b82f6', color: '#1d4ed8', bg: '#dbeafe', border: '#3b82f6' },
  approved:    { label: 'Approved',  dot: '#3b82f6', color: '#1d4ed8', bg: '#dbeafe', border: '#3b82f6' },
  generating:  { label: 'Generating',dot: '#f97316', color: '#c2410c', bg: '#ffedd5', border: '#f97316' },
  generated:   { label: 'For Review',dot: '#059669', color: '#065f46', bg: '#d1fae5', border: '#059669' },
  for_review:  { label: 'For Review',dot: '#059669', color: '#065f46', bg: '#d1fae5', border: '#059669' },
  draft_saved: { label: 'Published', dot: '#059669', color: '#065f46', bg: '#d1fae5', border: '#059669' },
  published:   { label: 'Published', dot: '#059669', color: '#065f46', bg: '#d1fae5', border: '#059669' },
  rejected:    { label: 'Rejected',  dot: '#ef4444', color: '#991b1b', bg: '#fee2e2', border: '#ef4444' },
}

function getStatusCfg(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, dot: '#9ca3af', color: '#374151' }
}

function clusterColor(label: string) {
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) & 0xff
  return BADGE_PALETTE[h % BADGE_PALETTE.length]
}

function getBadge(item: CalendarItem): { label: string; bg: string; text: string; dot: string } {
  if (item.clusterGroup) {
    const c = clusterColor(item.clusterGroup)
    return { label: item.clusterGroup, bg: c.bg, text: c.text, dot: c.text }
  }
  const cfg = getStatusCfg(item.status)
  return { label: cfg.label, bg: cfg.bg, text: cfg.color, dot: cfg.dot }
}

function getStatusBorder(status: string): string {
  return STATUS_CONFIG[status]?.border ?? '#e5e7eb'
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isPast(dateStr: string): boolean {
  return new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString())
}

function previewText(item: CalendarItem): string {
  const raw = item.type === 'topic'
    ? (item.rationale ?? item.keywordOpportunity ?? '')
    : (item.rationale ?? '')
  return raw.length > 120 ? raw.slice(0, 118) + '…' : raw
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

  const [windowStart,   setWindowStart]   = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [clientFilter,  setClientFilter]  = useState<string>('all')
  const [statusFilter,  setStatusFilter]  = useState<string>('all')
  const [items,         setItems]         = useState(initialItems)
  const [rationaleFor,  setRationaleFor]  = useState<CalendarItem | null>(null)
  const [activeCalView, setActiveCalView] = useState<'blog' | 'service'>('blog')

  useEffect(() => { setItems(initialItems) }, [initialItems])

  useEffect(() => {
    const hasGenerating = items.some(i => i.type === 'topic' && i.status === 'generating')
    if (!hasGenerating) return
    const interval = setInterval(() => router.refresh(), 10_000)
    return () => clearInterval(interval)
  }, [items, router])

  const prevWindow = () => {
    setWindowStart(w => w.month === 0
      ? { year: w.year - 1, month: 11 }
      : { year: w.year, month: w.month - 1 })
  }
  const nextWindow = () => {
    setWindowStart(w => w.month === 11
      ? { year: w.year + 1, month: 0 }
      : { year: w.year, month: w.month + 1 })
  }
  const resetToday = () => setWindowStart({ year: today.getFullYear(), month: today.getMonth() })

  // Build 4-month window keys
  const windowMonths: { year: number; month: number; key: string }[] = []
  for (let i = 0; i < 4; i++) {
    let m = windowStart.month + i
    let y = windowStart.year
    if (m > 11) { m -= 12; y += 1 }
    windowMonths.push({ year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` })
  }
  const windowKeys = new Set(windowMonths.map(w => w.key))

  // Filter items
  const filtered = items.filter(item => {
    if (!item.targetPublishDate) return false
    const d   = new Date(item.targetPublishDate + 'T00:00:00')
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
    if (!windowKeys.has(key)) return false
    if (clientFilter !== 'all' && item.clientId !== clientFilter) return false
    if (statusFilter === 'approved'    && !['approved','generating','generated'].includes(item.status)) return false
    if (statusFilter === 'for_review'  && item.status !== 'for_review') return false
    if (statusFilter === 'draft_saved' && !['draft_saved','published'].includes(item.status)) return false
    if (statusFilter === 'rejected'    && item.status !== 'rejected') return false
    if (statusFilter === 'all'         && item.status === 'rejected') return false
    return true
  })

  // Unscheduled items (no date)
  const unscheduled = items.filter(item => {
    if (item.targetPublishDate) return false
    if (clientFilter !== 'all' && item.clientId !== clientFilter) return false
    if (statusFilter === 'all' && item.status === 'rejected') return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'approved'   && !['approved','generating','generated'].includes(item.status)) return false
      if (statusFilter === 'for_review' && item.status !== 'for_review') return false
      if (statusFilter === 'draft_saved'&& !['draft_saved','published'].includes(item.status)) return false
      if (statusFilter === 'rejected'   && item.status !== 'rejected') return false
    }
    return true
  })

  // Stats
  const activeMonths  = new Set(filtered.map(i => {
    const d = new Date(i.targetPublishDate! + 'T00:00:00')
    return `${d.getFullYear()}-${d.getMonth()}`
  })).size
  const uniqueClients = new Set(filtered.map(i => i.clientId)).size
  const themeSet      = new Set(filtered.map(i => i.clusterGroup ?? getStatusCfg(i.status).label))
  const uniqueThemes  = themeSet.size

  // Split by contentType
  const blogFiltered = filtered.filter(i => !i.contentType || i.contentType === 'blog')
  const saFiltered   = filtered.filter(i => i.contentType === 'service_area')

  // Group by month — sorted by date within each month
  function groupByMonth(items: CalendarItem[]) {
    const map = new Map<string, CalendarItem[]>()
    for (const item of items) {
      const d   = new Date(item.targetPublishDate! + 'T00:00:00')
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      const arr = map.get(key) ?? []
      arr.push(item)
      map.set(key, arr)
    }
    // Sort within each month by targetPublishDate ascending
    for (const [key, arr] of Array.from(map)) {
      arr.sort((a: CalendarItem, b: CalendarItem) => (a.targetPublishDate ?? '').localeCompare(b.targetPublishDate ?? ''))
      map.set(key, arr)
    }
    return map
  }

  const byMonth   = groupByMonth(blogFiltered)
  const saByMonth = groupByMonth(saFiltered)

  const filterTabStyle = (active: boolean): React.CSSProperties => ({
    fontSize: '0.75rem', fontWeight: active ? 600 : 400, padding: '0.25rem 0.75rem',
    borderRadius: 20, border: 'none', cursor: 'pointer',
    background: active ? 'var(--blue)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    transition: 'background 0.15s, color 0.15s',
  })

  return (
    <div>
      {/* ── Stats bar ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { value: blogFiltered.length + saFiltered.length + unscheduled.length, label: 'total items' },
          { value: activeMonths,  label: 'months' },
          { value: uniqueClients, label: 'clients' },
          { value: uniqueThemes,  label: 'themes' },
        ].map(stat => (
          <div key={stat.label} style={{
            display: 'flex', alignItems: 'baseline', gap: 6,
            padding: '8px 16px', borderRadius: 8,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--blue)', lineHeight: 1 }}>
              {stat.value}
            </span>
            <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {stat.label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Controls ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        {/* Month window nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={prevWindow} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8125rem' }}>‹</button>
          <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {MONTH_NAMES[windowStart.month]} {windowStart.year}
            {' – '}
            {MONTH_NAMES[windowMonths[3].month]} {windowMonths[3].year}
          </span>
          <button onClick={nextWindow} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8125rem' }}>›</button>
          <button onClick={resetToday} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '4px 8px', marginLeft: 4 }}>Today</button>
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
            { id: 'all',        label: 'All'        },
            { id: 'approved',   label: 'Approved'   },
            { id: 'for_review', label: 'For Review' },
            { id: 'draft_saved',label: 'On Site'    },
            { id: 'rejected',   label: 'Rejected'   },
          ].map(t => (
            <button key={t.id} style={filterTabStyle(statusFilter === t.id)} onClick={() => setStatusFilter(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── View switcher pill (only when SA content exists) ────────────────── */}
      {(saFiltered.length > 0 || unscheduled.filter(i => i.contentType === 'service_area').length > 0) && (
        <div style={{ display: 'flex', gap: 4, padding: '3px', background: 'var(--bg-subtle)', borderRadius: 8, alignSelf: 'flex-start', border: '1px solid var(--border)', marginBottom: 20 }}>
          {(['blog', 'service'] as const).map(view => {
            const count = view === 'blog'
              ? blogFiltered.length + unscheduled.filter(i => !i.contentType || i.contentType === 'blog').length
              : saFiltered.length + unscheduled.filter(i => i.contentType === 'service_area').length
            return (
              <button
                key={view}
                onClick={() => setActiveCalView(view)}
                style={{
                  padding: '0.3125rem 0.875rem', fontSize: '0.8125rem',
                  fontWeight: activeCalView === view ? 600 : 400,
                  borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: activeCalView === view ? 'var(--bg-surface, #fff)' : 'transparent',
                  color: activeCalView === view ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: activeCalView === view ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {view === 'blog' ? 'Blog Posts' : 'Service Area'} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* ── Month sections ───────────────────────────────────────────────────── */}
      {filtered.length === 0 && unscheduled.length === 0 ? (
        <div className="card p-8" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            No items in this window{statusFilter !== 'all' ? ` with filter "${statusFilter}"` : ''}.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* ── Blog Posts (active when blog pill selected) ── */}
          {activeCalView === 'blog' && blogFiltered.length > 0 && (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {windowMonths.map(({ year, month, key }) => {
                  const monthItems = byMonth.get(key) ?? []
                  if (monthItems.length === 0) return null
                  const pillColor = MONTH_PILL_COLORS[month % MONTH_PILL_COLORS.length]
                  return (
                    <div key={key}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: pillColor + '20', color: pillColor, letterSpacing: '0.08em', flexShrink: 0 }}>
                          {MONTH_ABBREV[month]}
                        </span>
                        <span style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>{MONTH_NAMES[month]} {year}</span>
                        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', flexShrink: 0 }}>{monthItems.length} {monthItems.length === 1 ? 'post' : 'posts'}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                        {monthItems.map(item => <ContentCard key={item.id} item={item} onViewRationale={setRationaleFor} />)}
                      </div>
                    </div>
                  )
                })}
                {/* Unscheduled blog items */}
                {activeCalView === 'blog' && unscheduled.filter(i => !i.contentType || i.contentType === 'blog').length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: 'rgba(156,163,175,0.15)', color: '#9ca3af', letterSpacing: '0.08em', flexShrink: 0 }}>—</span>
                      <span style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-muted)' }}>Unscheduled</span>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                      {unscheduled.filter(i => !i.contentType || i.contentType === 'blog').map(item => <ContentCard key={item.id} item={item} onViewRationale={setRationaleFor} />)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Service Area Pages (active when service pill selected) ── */}
          {activeCalView === 'service' && saFiltered.length > 0 && (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {windowMonths.map(({ year, month, key }) => {
                  const monthItems = saByMonth.get(key) ?? []
                  if (monthItems.length === 0) return null
                  const pillColor = MONTH_PILL_COLORS[month % MONTH_PILL_COLORS.length]
                  return (
                    <div key={key}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: pillColor + '20', color: pillColor, letterSpacing: '0.08em', flexShrink: 0 }}>
                          {MONTH_ABBREV[month]}
                        </span>
                        <span style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>{MONTH_NAMES[month]} {year}</span>
                        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', flexShrink: 0 }}>{monthItems.length} page{monthItems.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                        {monthItems.map(item => <ContentCard key={item.id} item={item} onViewRationale={setRationaleFor} />)}
                      </div>
                    </div>
                  )
                })}
                {/* Unscheduled SA items */}
                {activeCalView === 'service' && unscheduled.filter(i => i.contentType === 'service_area').length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: 'rgba(156,163,175,0.15)', color: '#9ca3af', letterSpacing: '0.08em', flexShrink: 0 }}>—</span>
                      <span style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-muted)' }}>Unscheduled Pages</span>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                      {unscheduled.filter(i => i.contentType === 'service_area').map(item => <ContentCard key={item.id} item={item} onViewRationale={setRationaleFor} />)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Rationale modal ───────────────────────────────────────────────────── */}
      <RationaleModal item={rationaleFor} onClose={() => setRationaleFor(null)} />
    </div>
  )
}

function ContentCard({
  item,
  onViewRationale,
}: {
  item:            CalendarItem
  onViewRationale: (item: CalendarItem) => void
}) {
  const badge   = getBadge(item)
  const past    = item.targetPublishDate ? isPast(item.targetPublishDate) : false
  const title   = item.type === 'post'
    ? (item.title ?? item.targetKeyword ?? 'Untitled Post')
    : (item.topicText ?? item.targetKeyword ?? 'Untitled Topic')
  const preview = previewText(item)
  const hasRationale = !!(item.rationale || item.keywordOpportunity)

  return (
    <div
      onClick={() => hasRationale && onViewRationale(item)}
      style={{
        borderRadius: 10,
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${getStatusBorder(item.status)}`,
        background: 'var(--bg-surface)',
        padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 6,
        cursor: hasRationale ? 'pointer' : 'default',
        opacity: past ? 0.65 : 1,
        transition: 'box-shadow 0.15s, opacity 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
      onMouseEnter={e => { if (hasRationale) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)' }}
    >
      {/* Top row: date + badge + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {item.targetPublishDate && (
          <span style={{
            fontSize: '0.6875rem', fontWeight: 600, padding: '2px 7px', borderRadius: 4,
            background: 'var(--bg-muted)', color: 'var(--text-muted)',
            flexShrink: 0,
          }}>
            {shortDate(item.targetPublishDate)}
          </span>
        )}

        <span style={{
          fontSize: '0.6875rem', fontWeight: 600, padding: '2px 7px', borderRadius: 4,
          background: badge.bg, color: badge.text,
          display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%', background: badge.dot, flexShrink: 0,
            animation: item.status === 'generating' ? 'pulse 1.5s ease-in-out infinite' : 'none',
          }} />
          {badge.label}
        </span>

        {item.contentType === 'service_area' && (
          <span style={{
            fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: 'rgba(99,102,241,0.12)', color: '#6366f1',
            letterSpacing: '0.04em', flexShrink: 0, textTransform: 'uppercase',
          }}>
            Page
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {hasRationale && (
            <span style={{ fontSize: '0.75rem', color: 'var(--blue)', lineHeight: 1 }} title="View rationale">→</span>
          )}
          {item.type === 'post' && item.publishedUrl && (
            <a
              href={item.publishedUrl}
              target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: '0.75rem', color: 'var(--blue)', textDecoration: 'none', lineHeight: 1 }}
              title="View published post"
            >
              ↗
            </a>
          )}
        </div>
      </div>

      {/* Client name */}
      <a
        href={`/admin/clients/${item.clientId}?tab=content`}
        onClick={e => e.stopPropagation()}
        style={{ fontSize: '0.72rem', color: 'var(--blue)', textDecoration: 'none', fontWeight: 500, lineHeight: 1 }}
      >
        {item.clientName}
      </a>

      {/* Title */}
      <p style={{
        margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)',
        lineHeight: 1.35,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {title}
      </p>

      {/* Preview text */}
      {preview && (
        <p style={{
          margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {preview}
        </p>
      )}
    </div>
  )
}
