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
  keywordOpportunity: string | null
  rankingStrategy:    string | null
  audienceIntent:     string | null
  whyNow:             string | null
  suggestedTitle:     string | null
  searchVolume:       number | null
  keywordDifficulty:  number | null
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
  postsPerRunByClient = {},
}: {
  items:                CalendarItem[]
  clients:              { id: string; name: string }[]
  postsPerRunByClient?: Record<string, number>
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
  const [rationaleFor, setRationaleFor] = useState<CalendarItem | null>(null)

  useEffect(() => { setItems(initialItems) }, [initialItems])

  // Poll for status updates while any topic is generating
  useEffect(() => {
    const hasGenerating = items.some(i => i.type === 'topic' && i.status === 'generating')
    if (!hasGenerating) return
    const interval = setInterval(() => router.refresh(), 10_000)
    return () => clearInterval(interval)
  }, [items, router])

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

  // Filter items for timeline — pending/scheduled topics live in the banner only
  const filtered = items.filter(item => {
    if (!item.targetPublishDate) return false
    // Never show unapproved topics in the timeline
    if (item.type === 'topic' && (item.status === 'pending' || item.status === 'scheduled')) return false
    const d = new Date(item.targetPublishDate + 'T00:00:00')
    if (d.getFullYear() !== year || d.getMonth() !== month) return false
    if (clientFilter !== 'all' && item.clientId !== clientFilter) return false
    if (statusFilter === 'generating' && item.status !== 'generating') return false
    if (statusFilter === 'approved'   && !['approved','generating','generated'].includes(item.status)) return false
    if (statusFilter === 'draft_saved' && item.status !== 'draft_saved') return false
    if (statusFilter === 'rejected'   && item.status !== 'rejected') return false
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

      // Check if the quota is now met for this client — auto-reject remaining pending topics
      setItems(prev => {
        const approvedCount = prev.filter(i =>
          i.clientId === item.clientId &&
          i.type === 'topic' &&
          ['approved', 'generating', 'generated', 'draft_saved'].includes(i.status)
        ).length  // includes the one just set to 'generating' above

        const quota = postsPerRunByClient[item.clientId] ?? 2
        if (approvedCount >= quota) {
          const toReject = prev.filter(i =>
            i.clientId === item.clientId &&
            i.type === 'topic' &&
            (i.status === 'pending' || i.status === 'scheduled') &&
            i.id !== item.id
          )
          if (toReject.length > 0) {
            Promise.all(toReject.map(t =>
              fetch(`/api/admin/content/topics/${t.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'rejected' }),
              })
            ))
            return prev.filter(i => !toReject.some(t => t.id === i.id))
          }
        }
        return prev
      })

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
  }, [generating, router, postsPerRunByClient])

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
          marginBottom: 24, borderRadius: 10, overflow: 'hidden',
          border: '1px solid rgba(245,158,11,0.35)',
          background: 'rgba(255,251,235,0.95)',
        }}>
          {/* Banner header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px',
            borderBottom: collapsed ? 'none' : '1px solid rgba(245,158,11,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', flexShrink: 0,
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#92400e' }}>
                Topics awaiting approval
              </span>
              <span style={{
                fontSize: '0.6875rem', fontWeight: 700, padding: '1px 7px',
                borderRadius: 999, background: '#f59e0b', color: '#fff',
              }}>
                {pendingApproval.length}
              </span>
            </div>
            <button
              onClick={() => setCollapsed(c => !c)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#b45309', padding: '2px 6px' }}
            >
              {collapsed ? 'Show ▾' : 'Collapse ▴'}
            </button>
          </div>

          {!collapsed && (
            <div style={{ padding: '12px 16px 16px' }}>
              {Array.from(pendingByClient.entries()).map(([clientId, { clientName, items: clientTopics }], groupIdx) => {
                const quota         = postsPerRunByClient[clientId] ?? 2
                const approvedCount = items.filter(i =>
                  i.clientId === clientId &&
                  i.type === 'topic' &&
                  ['approved', 'generating', 'generated', 'draft_saved'].includes(i.status)
                ).length
                const remaining = Math.max(0, quota - approvedCount)

                return (
                <div key={clientId} style={{
                  marginBottom: groupIdx < pendingByClient.size - 1 ? 20 : 0,
                }}>
                  {/* Client header row */}
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    marginBottom: 8, paddingBottom: 6,
                    borderBottom: '1px solid rgba(245,158,11,0.2)',
                  }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#b45309' }}>
                        {clientName}
                      </span>
                      {/* Approval progress bar */}
                      <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginTop: 5 }}>
                        {Array.from({ length: quota }).map((_, i) => (
                          <div key={i} style={{
                            width: 18, height: 5, borderRadius: 3,
                            background: i < approvedCount ? '#10b981' : 'rgba(245,158,11,0.3)',
                            transition: 'background 0.3s',
                          }} />
                        ))}
                        <span style={{ fontSize: '0.6875rem', color: '#b45309', marginLeft: 4 }}>
                          {approvedCount}/{quota}
                          {remaining > 0 ? ` · approve ${remaining} more` : ' · cycle complete ✓'}
                        </span>
                      </div>
                    </div>
                    <span style={{
                      fontSize: '0.6875rem', padding: '1px 6px', borderRadius: 999, flexShrink: 0,
                      background: 'rgba(245,158,11,0.15)', color: '#b45309', marginTop: 2,
                    }}>
                      {clientTopics.length} topic{clientTopics.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Topic rows */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {clientTopics.map(topic => {
                      const isGen = generating.has(topic.id) || topic.status === 'generating'
                      const err   = approveErr[topic.id]
                      const publishFmt = topic.targetPublishDate
                        ? new Date(topic.targetPublishDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : null

                      return (
                        <div key={topic.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 10px', borderRadius: 7,
                          background: 'rgba(255,255,255,0.8)',
                          border: '1px solid rgba(245,158,11,0.15)',
                        }}>
                          {/* Status dot */}
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                            background: isGen ? '#3b82f6' : '#f59e0b',
                            animation: isGen ? 'pulse 1.5s ease-in-out infinite' : 'none',
                          }} />

                          {/* Topic text */}
                          <span
                            onClick={() => setRationaleFor(topic)}
                            style={{
                              flex: 1, fontSize: '0.8125rem', fontStyle: 'italic',
                              color: 'var(--text-primary)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              cursor: 'pointer',
                            }}
                            title="Click to view rationale"
                          >
                            {topic.topicText ?? topic.targetKeyword ?? 'Topic'}
                          </span>

                          {/* Keyword pill */}
                          {topic.targetKeyword && (
                            <span style={{
                              fontSize: '0.6875rem', padding: '1px 7px', borderRadius: 999,
                              background: 'var(--bg-muted)', color: 'var(--text-muted)',
                              flexShrink: 0, maxWidth: 140,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {topic.targetKeyword}
                            </span>
                          )}

                          {/* Rationale info button */}
                          {(topic.rationale || topic.keywordOpportunity || topic.rankingStrategy) && (
                            <button
                              onClick={() => setRationaleFor(topic)}
                              title="View rationale"
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: '0.8125rem', color: 'var(--text-faint)',
                                padding: '0 2px', flexShrink: 0, lineHeight: 1,
                              }}
                            >
                              ⓘ
                            </button>
                          )}

                          {/* Publish date */}
                          {publishFmt && (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', flexShrink: 0 }}>
                              {publishFmt}
                            </span>
                          )}

                          {/* Actions */}
                          {isGen ? (
                            <span style={{ fontSize: '0.75rem', color: '#3b82f6', flexShrink: 0, fontWeight: 500 }}>
                              Generating…
                            </span>
                          ) : (
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                              <button
                                onClick={() => approveTopic(topic)}
                                className="btn btn-primary"
                                style={{ fontSize: '0.6875rem', padding: '3px 12px' }}
                              >
                                Approve
                              </button>
                              <button
                                onClick={async () => {
                                  await fetch(`/api/admin/content/topics/${topic.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ status: 'rejected' }),
                                  })
                                  setItems(prev => prev.filter(i => i.id !== topic.id))
                                }}
                                style={{
                                  fontSize: '0.6875rem', padding: '3px 7px', border: '1px solid rgba(245,158,11,0.3)',
                                  borderRadius: 5, background: 'transparent', color: '#b45309', cursor: 'pointer',
                                }}
                                title="Skip this topic"
                              >
                                ✕
                              </button>
                            </div>
                          )}

                          {err && (
                            <span style={{ fontSize: '0.6875rem', color: '#ef4444', flexShrink: 0 }}>{err}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
              })}
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
            { id: 'all',        label: 'All'         },
            { id: 'approved',   label: 'Approved'    },
            { id: 'generating', label: 'Generating'  },
            { id: 'draft_saved',label: 'On WordPress'},
            { id: 'rejected',   label: 'Rejected'    },
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

      {/* ── Rationale modal ───────────────────────────────────────────────────── */}
      {rationaleFor && (
        <div
          onClick={() => setRationaleFor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-surface)', borderRadius: 12, padding: 24,
              maxWidth: 520, width: '100%', maxHeight: '80vh', overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', fontWeight: 600 }}>
                  Topic Rationale — {rationaleFor.clientName}
                </p>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', fontStyle: 'italic' }}>
                  {rationaleFor.topicText}
                </h3>
              </div>
              <button
                onClick={() => setRationaleFor(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-faint)', lineHeight: 1, marginLeft: 12, flexShrink: 0 }}
              >
                ✕
              </button>
            </div>

            {(rationaleFor.searchVolume != null || rationaleFor.keywordDifficulty != null || rationaleFor.competitionLevel || rationaleFor.targetKeyword) && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {rationaleFor.targetKeyword && (
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: 'var(--bg-muted)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    {rationaleFor.targetKeyword}
                  </span>
                )}
                {rationaleFor.searchVolume != null && (
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: '#ede9fe', color: '#5b21b6', fontSize: '0.75rem' }}>
                    {rationaleFor.searchVolume.toLocaleString()} searches/mo
                  </span>
                )}
                {rationaleFor.keywordDifficulty != null && (
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontSize: '0.75rem' }}>
                    KD {rationaleFor.keywordDifficulty}
                  </span>
                )}
              </div>
            )}

            {[
              { key: 'keywordOpportunity' as const, label: 'Keyword Opportunity', color: '#2563eb', bg: '#eff6ff' },
              { key: 'rankingStrategy'    as const, label: 'Ranking Strategy',    color: '#7c3aed', bg: '#f5f3ff' },
              { key: 'audienceIntent'     as const, label: 'Audience Intent',     color: '#059669', bg: '#f0fdf4' },
              { key: 'whyNow'             as const, label: 'Why Now',             color: '#d97706', bg: '#fffbeb' },
              { key: 'competitionLevel'   as const, label: 'Competition',         color: '#dc2626', bg: '#fef2f2' },
            ].map(({ key, label, color, bg }) => {
              const val = rationaleFor[key]
              if (!val) return null
              return (
                <div key={key} style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: bg, borderLeft: `3px solid ${color}` }}>
                  <p style={{ margin: '0 0 4px', fontSize: '0.6875rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {label}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {val}
                  </p>
                </div>
              )
            })}

            {!rationaleFor.keywordOpportunity && !rationaleFor.rankingStrategy && rationaleFor.rationale && (
              <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-muted)' }}>
                <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {rationaleFor.rationale}
                </p>
              </div>
            )}
          </div>
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
