'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import ContentPostEditor from './ContentPostEditor'
import RationaleModal    from './RationaleModal'
import ContentStatusBar, { computeStatusCounts } from './ContentStatusBar'
import { ArrowClockwise, ArrowCircleRight, X } from '@phosphor-icons/react'

interface QueueItem {
  type:                'post' | 'topic'
  id:                  string
  clientId:            string
  clientName:          string
  status:              string
  targetKeyword:       string | null
  title:               string | null
  topicText:           string | null
  wordCount:           number | null
  headingCount:        number | null
  internalLinks:       number | null
  generatedAt:         string
  generatedBy:         string
  publishedUrl:        string | null
  generateByDate:      string | null
  targetPublishDate:   string | null
  rationale:           string | null
  wpPostId:            number | null
  wpSiteUrl:           string | null
  // rationale fields (topics only)
  keywordOpportunity?: string | null
  rankingStrategy?:    string | null
  audienceIntent?:     string | null
  whyNow?:             string | null
  competitionLevel?:   string | null
  generationError?:    string | null
  suggestedTitle?:     string | null
  searchVolume?:       number | null
  keywordDifficulty?:  number | null
}

interface Site {
  connectionId: string
  siteUrl:      string
  siteName:     string
  clientId:     string
  clientName:   string
}

interface Props {
  posts: QueueItem[]
  sites: Site[]
  highlightId?: string
}

type TabId = 'all' | 'scheduled' | 'pending' | 'uploaded' | 'rejected'

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  pending:    { bg: '#fef3c7', color: '#92400e', label: 'Not in WP'   },
  approved:   { bg: '#ede9fe', color: '#5b21b6', label: 'Scheduled'   },
  scheduled:  { bg: '#ede9fe', color: '#5b21b6', label: 'Scheduled'   },
  generating: { bg: '#dbeafe', color: '#1e40af', label: 'Generating…' },
  generated:  { bg: '#dbeafe', color: '#1e40af', label: 'Generated'   },
  published:  { bg: '#dcfce7', color: '#166534', label: 'Published'   },
  draft_saved:{ bg: '#ede9fe', color: '#5b21b6', label: 'On WordPress' },
  rejected:   { bg: '#fee2e2', color: '#991b1b', label: 'Rejected'    },
}

const COMPETITION_BADGE: Record<string, { bg: string; color: string }> = {
  low:    { bg: '#dcfce7', color: '#166534' },
  medium: { bg: '#fef3c7', color: '#92400e' },
  high:   { bg: '#fee2e2', color: '#991b1b' },
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function StatusBadge({ item }: { item: QueueItem }) {
  const key = item.type === 'topic'
    ? (item.status === 'generating' ? 'generating' : 'scheduled')
    : item.status
  const s = STATUS_BADGE[key] ?? STATUS_BADGE.pending
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 999,
      fontSize: '0.6875rem', fontWeight: 700, background: s.bg, color: s.color,
      whiteSpace: 'nowrap', width: 82, textAlign: 'center', flexShrink: 0,
    }}>
      {s.label}
    </span>
  )
}

function PurgeConfirmModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const [text, setText] = useState('')
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface, #fff)', borderRadius: 12, padding: '1.5rem',
          maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: 'var(--red, #dc2626)' }}>Purge All Content</h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
          This will permanently delete <strong>all topics and posts</strong>. This cannot be undone.
          Type <strong>PURGE</strong> to confirm.
        </p>
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type PURGE"
          autoFocus
          style={{ width: '100%', padding: '0.5rem 0.625rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem', marginBottom: '1rem', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={text !== 'PURGE'}
            className="btn btn-danger"
            style={{ fontSize: '0.8125rem', opacity: text !== 'PURGE' ? 0.5 : 1 }}
          >
            Purge All
          </button>
        </div>
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: 'var(--text-faint)',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  borderBottom: '1px solid var(--border, #e5e7eb)',
  background: 'var(--bg-subtle, #f8f9fa)',
}

const tdStyle: React.CSSProperties = {
  padding: '0.375rem 0.75rem',
  fontSize: '0.8125rem',
  color: 'var(--text-primary)',
  verticalAlign: 'middle',
  overflow: 'hidden',
}

export default function ContentQueue({ posts: initialItems, sites, highlightId }: Props) {
  const router = useRouter()
  const [items,          setItems]          = useState<QueueItem[]>(initialItems)
  const [tab,            setTab]            = useState<TabId>('scheduled')

  // Sync when server refreshes data (router.refresh() re-passes initialItems)
  useEffect(() => { setItems(initialItems) }, [initialItems])

  // Scroll to and flash the highlighted row when arriving via deep link
  const highlightRef = useRef(highlightId)
  useEffect(() => {
    if (!highlightRef.current) return
    const el = document.querySelector<HTMLElement>(`[data-item-id="${highlightRef.current}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.style.animation = 'cqFlash 2s ease 0.3s'
    }
  }, [tab])
  const [clientFilter,   setClientFilter]   = useState<string>('all')
  const [selected,       setSelected]       = useState<Set<string>>(new Set())
  const [rationaleItem,  setRationaleItem]  = useState<QueueItem | null>(null)
  const [editingPostId,  setEditingPostId]  = useState<string | null>(null)
  const [loading,        setLoading]        = useState<string | null>(null)
  const [generating,     setGenerating]     = useState<string | null>(null)
  const [approving,      setApproving]      = useState<string | null>(null)
  const [approveProgress, setApproveProgress] = useState(0)
  const [restoring,      setRestoring]      = useState<string | null>(null)
  const [bulkLoading,    setBulkLoading]    = useState(false)
  const [error,          setError]          = useState('')

  const clientOptions = Array.from(
    new Map(items.map(i => [i.clientId, i.clientName])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]))

  const statusCounts = useMemo(() => computeStatusCounts(
    items.filter(i => i.type === 'topic'),
    items.filter(i => i.type === 'post')
  ), [items])

  const isScheduledTab = (i: QueueItem) =>
    i.type === 'topic' && ['scheduled', 'generating'].includes(i.status)

  const isPendingTab = (i: QueueItem) =>
    i.type === 'post' && i.wpPostId == null && i.status !== 'rejected'

  const isUploadedTab = (i: QueueItem) =>
    i.type === 'post' && i.wpPostId != null

  const applyClientFilter = (arr: QueueItem[]) =>
    clientFilter === 'all' ? arr : arr.filter(i => i.clientId === clientFilter)

  const tabItems: Record<TabId, QueueItem[]> = {
    all:       applyClientFilter(items.filter(i => i.status !== 'rejected')),
    scheduled: applyClientFilter(items.filter(isScheduledTab)),
    pending:   applyClientFilter(items.filter(isPendingTab)),
    uploaded:  applyClientFilter(items.filter(isUploadedTab)),
    rejected:  applyClientFilter(items.filter(i => i.status === 'rejected')),
  }

  const filtered = tabItems[tab]

  const allIds   = filtered.map(i => i.id)
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someSelected = allIds.some(id => selected.has(id))

  function toggleAll() {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); allIds.forEach(id => n.delete(id)); return n })
    } else {
      setSelected(prev => new Set(Array.from(prev).concat(allIds)))
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  async function deleteSelected() {
    const ids = Array.from(selected).filter(id => filtered.some(i => i.id === id))
    if (ids.length === 0) return
    const topicIds = ids.filter(id => filtered.find(i => i.id === id)?.type === 'topic')
    const postIds  = ids.filter(id => filtered.find(i => i.id === id)?.type === 'post')
    setBulkLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/content/topics/bulk-delete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: topicIds, post_ids: postIds }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed')
      setItems(prev => prev.filter(i => !ids.includes(i.id)))
      setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setBulkLoading(false)
    }
  }

  async function deleteSingle(item: QueueItem) {
    setLoading(item.id)
    setError('')
    try {
      const body = item.type === 'topic'
        ? { ids: [item.id] }
        : { post_ids: [item.id] }
      const res = await fetch('/api/admin/content/topics/bulk-delete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed')
      setItems(prev => prev.filter(i => i.id !== item.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setLoading(null)
    }
  }

  async function forceGenerate(item: QueueItem) {
    setGenerating(item.id)
    setError('')
    try {
      const res = await fetch('/api/admin/content/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic_id: item.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(null)
    }
  }

  async function rejectPost(item: QueueItem) {
    setLoading(item.id)
    setError('')
    try {
      const res = await fetch(`/api/admin/content/posts/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Reject failed')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setLoading(null)
    }
  }

  async function restoreItem(item: QueueItem) {
    setRestoring(item.id)
    setError('')
    try {
      const url = item.type === 'topic'
        ? `/api/admin/content/topics/${item.id}`
        : `/api/admin/content/posts/${item.id}`
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Restore failed')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  async function approvePost(item: QueueItem) {
    setApproving(item.id)
    setApproveProgress(5)
    setError('')

    // Simulate progress while WP upload runs (tag creation + post creation can take 10-30s)
    const tick = setInterval(() => {
      setApproveProgress(p => p < 80 ? p + 8 : p)
    }, 1500)

    try {
      const res = await fetch(`/api/admin/content/posts/${item.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      clearInterval(tick)
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed')
      const data = await res.json() as { wp_post_id: number; wp_edit_url: string }

      setApproveProgress(100)
      // Optimistically update item so it moves to the Uploaded tab immediately
      setItems(prev => prev.map(i =>
        i.id === item.id ? { ...i, wpPostId: data.wp_post_id, status: 'draft_saved' } : i
      ))
      setTimeout(() => {
        setApproving(null)
        setApproveProgress(0)
        setTab('uploaded')
      }, 400)
    } catch (err) {
      clearInterval(tick)
      setApproveProgress(0)
      setApproving(null)
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  const openRationale = useCallback((item: QueueItem) => {
    setRationaleItem(item)
  }, [])

  const editingItem  = editingPostId ? items.find(i => i.id === editingPostId) ?? null : null
  const siteForPost  = editingItem   ? sites.find(s => s.clientId === editingItem.clientId) ?? null : null

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'all',       label: 'All',       count: tabItems.all.length       },
    { id: 'scheduled', label: 'Scheduled', count: tabItems.scheduled.length },
    { id: 'pending',   label: 'Not in WP', count: tabItems.pending.length   },
    { id: 'uploaded',  label: 'On WordPress', count: tabItems.uploaded.length },
    { id: 'rejected',  label: 'Rejected',  count: tabItems.rejected.length  },
  ]

  const selectedCount = Array.from(selected).filter(id => filtered.some(i => i.id === id)).length

  return (
    <>
      {highlightId && (
        <style>{`@keyframes cqFlash { 0%,100%{background:transparent} 25%,75%{background:#fef9c3} }`}</style>
      )}
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {/* Left: tab pills + client filter */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTab(t.id); setSelected(new Set()) }}
                style={{
                  padding: '0.25rem 0.625rem',
                  fontSize: '0.8rem',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: tab === t.id ? 600 : 400,
                  background: tab === t.id ? 'var(--blue)' : 'var(--bg-subtle)',
                  color: tab === t.id ? '#fff' : 'var(--text-muted)',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {t.label} ({t.count})
              </button>
            ))}
          </div>
          {clientOptions.length > 1 && (
            <select
              value={clientFilter}
              onChange={e => { setClientFilter(e.target.value); setSelected(new Set()) }}
              style={{
                fontSize: '0.8rem', padding: '0.25rem 0.5rem',
                border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
                background: 'var(--bg-surface, #fff)', color: 'var(--text-primary)', cursor: 'pointer',
              }}
            >
              <option value="all">All Clients</option>
              {clientOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {selectedCount > 0 && (
            <button
              type="button"
              disabled={bulkLoading}
              onClick={deleteSelected}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', color: 'var(--red)', padding: '0.25rem 0.625rem' }}
            >
              {bulkLoading ? 'Deleting…' : `Delete Selected (${selectedCount})`}
            </button>
          )}
        </div>
      </div>

      {error && <p style={{ fontSize: '0.8125rem', color: 'var(--red)', marginBottom: '0.5rem' }}>{error}</p>}

      {/* Status bar */}
      <div className="card p-3" style={{ marginBottom: '0.75rem' }}>
        <ContentStatusBar counts={statusCounts} />
      </div>

      {filtered.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {tab === 'scheduled' ? 'No topics scheduled for generation.'
            : tab === 'pending'   ? 'All generated posts have been uploaded to WordPress.'
            : tab === 'uploaded'  ? 'No posts uploaded to WordPress yet.'
            : tab === 'rejected'  ? 'No rejected items.'
            : 'No items.'}
          </p>
        </div>
      ) : tab === 'scheduled' ? (
        // ── Grouped cards for Scheduled tab ──────────────────────────────────────
        (() => {
          const groups = new Map<string, { clientName: string; items: QueueItem[] }>()
          for (const item of filtered) {
            const g = groups.get(item.clientId)
            if (g) g.items.push(item)
            else groups.set(item.clientId, { clientName: item.clientName, items: [item] })
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {Array.from(groups.entries()).map(([clientId, { clientName, items: groupItems }]) => (
                <div key={clientId} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 16px',
                    background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
                  }}>
                    <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{clientName}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                      {groupItems.length} topic{groupItems.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {groupItems.map(item => {
                      const isGen  = item.status === 'generating'
                      const compKey = (item.competitionLevel ?? '').split(/[\s/—–\-]/)[0].toLowerCase()
                      const comp    = COMPETITION_BADGE[compKey]
                      const isGenLoading = generating === item.id
                      const isDelLoading = loading    === item.id
                      return (
                        <div key={item.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                          borderRadius: 7, background: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle, var(--border))',
                          cursor: 'pointer',
                        }} onClick={() => openRationale(item)}>
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                            background: isGen ? '#3b82f6' : '#6366f1',
                          }} />
                          <span style={{
                            flex: 1, fontSize: '0.8125rem', fontStyle: 'italic',
                            color: 'var(--text-primary)', overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }} title={item.topicText ?? undefined}>
                            {item.topicText ?? item.title ?? item.id}
                          </span>
                          {item.targetKeyword && (
                            <span style={{
                              fontSize: '0.6875rem', padding: '1px 6px', borderRadius: 999,
                              background: 'var(--bg-muted)', color: 'var(--text-muted)',
                              flexShrink: 0, maxWidth: 120, overflow: 'hidden',
                              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {item.targetKeyword}
                            </span>
                          )}
                          {comp && (
                            <span style={{
                              fontSize: '0.625rem', fontWeight: 600, padding: '1px 5px',
                              borderRadius: 999, background: comp.bg, color: comp.color, flexShrink: 0,
                            }}>
                              {compKey.charAt(0).toUpperCase() + compKey.slice(1)}
                            </span>
                          )}
                          {item.targetPublishDate && (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                              {fmtDate(item.targetPublishDate)}
                            </span>
                          )}
                          {isGen ? (
                            <span style={{ fontSize: '0.7rem', color: '#3b82f6', flexShrink: 0 }}>Generating…</span>
                          ) : (
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                disabled={isGenLoading || isDelLoading}
                                onClick={() => forceGenerate(item)}
                                style={{
                                  fontSize: '0.7rem', padding: '2px 8px', borderRadius: 5,
                                  background: 'none', border: '1px solid var(--border)',
                                  color: 'var(--text-muted)', cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', gap: 3,
                                }}
                                title="Generate now"
                              >
                                {isGenLoading ? '⏳' : <><ArrowClockwise size={12} />Generate</>}
                              </button>
                              <button
                                type="button"
                                disabled={isDelLoading || isGenLoading}
                                onClick={() => deleteSingle(item)}
                                style={{ fontSize: '0.7rem', padding: '2px 5px', background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                              >
                                {isDelLoading ? '…' : <X size={12} />}
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        })()
      ) : (
        <div style={{
          border:       '1px solid var(--border, #e5e7eb)',
          borderRadius: 8,
          overflow:     'hidden',
          background:   'var(--bg-surface, #fff)',
        }}>
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 100 }} />
              <col />
              <col style={{ width: 130 }} />
              <col style={{ width: 108 }} />
              {(tab === 'pending' || tab === 'uploaded') && <col style={{ width: 56 }} />}
              <col style={{ width: tab === 'uploaded' ? 216 : tab === 'pending' ? 200 : tab === 'rejected' ? 110 : 200 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={thStyle}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                    onChange={toggleAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Client</th>
                <th style={thStyle}>Title / Topic</th>
                <th style={thStyle}>Keyword</th>
                <th style={thStyle}>Publish Date</th>
                {(tab === 'pending' || tab === 'uploaded') && <th style={{ ...thStyle, textAlign: 'right' }}>Words</th>}
                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const isLast       = idx === filtered.length - 1
                const isLoading    = loading === item.id
                const isGenerating = generating === item.id
                // AI may return "Low — reasoning…", extract just the first word
                const compKey = (item.competitionLevel ?? '').split(/[\s/—–\-]/)[0].toLowerCase()
                const comp    = COMPETITION_BADGE[compKey]
                const wpEditUrl = item.wpSiteUrl && item.wpPostId
                  ? `${item.wpSiteUrl}/wp-admin/post.php?post=${item.wpPostId}&action=edit`
                  : null

                const rowStyle: React.CSSProperties = {
                  borderBottom: isLast ? 'none' : '1px solid var(--border, #e5e7eb)',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }

                return (
                  <tr
                    key={item.id}
                    data-item-id={item.id}
                    style={rowStyle}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--bg-subtle, #f8f9fa)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
                    onClick={() => openRationale(item)}
                  >
                    {/* Checkbox */}
                    <td style={tdStyle} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>

                    {/* Status */}
                    <td style={tdStyle}>
                      <StatusBadge item={item} />
                    </td>

                    {/* Client */}
                    <td style={{ ...tdStyle, fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {item.clientName}
                    </td>

                    {/* Title / Topic */}
                    <td style={{ ...tdStyle, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {item.status === 'generating' && (
                        <span style={{ marginRight: 4, fontSize: '0.75rem' }}>⏳</span>
                      )}
                      <span style={{ fontStyle: item.type === 'topic' ? 'italic' : 'normal', fontWeight: item.type === 'post' ? 600 : 400 }}>
                        {(item.type === 'topic' ? item.topicText : item.title) ?? <span style={{ color: 'var(--text-faint)' }}>Untitled</span>}
                      </span>
                    </td>

                    {/* Keyword */}
                    <td style={{ ...tdStyle, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {item.targetKeyword ? (
                        <span
                          title={item.targetKeyword}
                          style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', background: 'var(--bg-subtle)', padding: '1px 5px', borderRadius: 4, display: 'inline-block', maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
                        >
                          {item.targetKeyword}
                        </span>
                      ) : null}
                    </td>

                    {/* Publish Date */}
                    <td style={{ ...tdStyle, fontSize: '0.75rem', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                      {item.targetPublishDate ? fmtDate(item.targetPublishDate) : '—'}
                    </td>


                    {/* Words — Pending/Uploaded tabs only */}
                    {(tab === 'pending' || tab === 'uploaded') && (
                      <td style={{ ...tdStyle, textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                        {item.type === 'post' && item.wordCount != null ? `${item.wordCount.toLocaleString()}w` : ''}
                      </td>
                    )}

                    {/* Actions */}
                    <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                        {/* Rejected items: Restore + Delete */}
                        {item.status === 'rejected' && (
                          <>
                            <button
                              type="button"
                              disabled={restoring === item.id}
                              onClick={() => restoreItem(item)}
                              className="btn btn-secondary"
                              style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', whiteSpace: 'nowrap' }}
                            >
                              {restoring === item.id ? '…' : 'Restore'}
                            </button>
                            <button
                              type="button"
                              disabled={isLoading || restoring === item.id}
                              onClick={() => deleteSingle(item)}
                              style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                              title="Delete permanently"
                            >
                              {isLoading ? '…' : <X size={14} />}
                            </button>
                          </>
                        )}

                        {/* Topic rows (non-rejected) */}
                        {item.type === 'topic' && item.status !== 'generating' && item.status !== 'rejected' && (
                          <>
                            <button
                              type="button"
                              disabled={isGenerating || isLoading}
                              onClick={() => forceGenerate(item)}
                              style={{
                                fontSize: '0.7rem', padding: '0.15rem 0.4rem',
                                background: 'none', border: 'none',
                                color: isGenerating ? 'var(--blue)' : 'var(--text-muted)',
                                cursor: isGenerating ? 'default' : 'pointer',
                                display: 'flex', alignItems: 'center',
                              }}
                              title="Force generate post now"
                            >
                              {isGenerating ? '⏳' : <ArrowClockwise size={14} />}
                            </button>
                            <button
                              type="button"
                              disabled={isLoading || isGenerating}
                              onClick={() => deleteSingle(item)}
                              style={{
                                fontSize: '0.7rem', padding: '0.15rem 0.4rem',
                                background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center',
                              }}
                              title="Delete"
                            >
                              {isLoading ? '…' : <X size={14} />}
                            </button>
                          </>
                        )}
                        {item.type === 'topic' && item.status === 'generating' && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)', padding: '0.15rem 0.4rem' }}>⏳</span>
                        )}

                        {/* Post rows */}
                        {item.type === 'post' && (
                          <>
                            {/* Posts not yet on WP: manual upload fallback */}
                            {item.wpPostId == null && item.status !== 'rejected' && (
                              approving === item.id ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 100 }}>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}>
                                    {approveProgress < 100 ? 'Uploading to WP…' : 'Done ✓'}
                                  </div>
                                  <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                                    <div style={{
                                      height: '100%', borderRadius: 2,
                                      background: approveProgress === 100 ? 'var(--green)' : 'var(--blue)',
                                      width: `${approveProgress}%`,
                                      transition: 'width 0.4s ease, background 0.2s',
                                    }} />
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!!approving}
                                  onClick={() => approvePost(item)}
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', whiteSpace: 'nowrap' }}
                                >
                                  Upload to WP
                                </button>
                              )
                            )}
                            {wpEditUrl && (
                              <a
                                href={wpEditUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-primary"
                                style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', whiteSpace: 'nowrap' }}
                              >
                                Edit in WP ↗
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditingPostId(item.id)}
                              className="btn btn-secondary"
                              style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            >
                              <ArrowCircleRight size={13} />Review
                            </button>
                            {item.publishedUrl && (
                              <a
                                href={item.publishedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-secondary"
                                style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', whiteSpace: 'nowrap' }}
                              >
                                View ↗
                              </a>
                            )}
                            {item.wpPostId == null && item.status !== 'rejected' && (
                              <button
                                type="button"
                                disabled={isLoading}
                                onClick={() => rejectPost(item)}
                                style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                title="Reject"
                              >
                                {isLoading ? '…' : <X size={14} />}
                              </button>
                            )}
                            {item.wpPostId != null && (
                              <button
                                type="button"
                                disabled={isLoading}
                                onClick={() => deleteSingle(item)}
                                style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                title="Delete"
                              >
                                {isLoading ? '…' : <X size={14} />}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Rationale modal */}
      {rationaleItem && (
        <RationaleModal item={rationaleItem} onClose={() => setRationaleItem(null)} />
      )}

      {/* Post editor drawer */}
      {editingPostId && editingItem?.type === 'post' && (
        <ContentPostEditor
          postId={editingPostId}
          defaultConnectionId={siteForPost?.connectionId ?? null}
          sites={sites}
          onClose={() => setEditingPostId(null)}
          onUpdate={updatedPost => {
            setItems(prev => prev.map(i =>
              i.id === updatedPost.id
                ? { ...i, ...updatedPost,
                    wpPostId:  updatedPost.wpPostId  !== undefined ? updatedPost.wpPostId  : i.wpPostId,
                    wpSiteUrl: updatedPost.wpSiteUrl !== undefined ? updatedPost.wpSiteUrl : i.wpSiteUrl,
                  }
                : i
            ))
          }}
        />
      )}
    </>
  )
}
