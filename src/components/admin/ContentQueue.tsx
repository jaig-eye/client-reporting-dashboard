'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ContentPostEditor from './ContentPostEditor'

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
}

type TabId = 'all' | 'scheduled' | 'uploaded'

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  pending:    { bg: '#fef3c7', color: '#92400e', label: 'Pending'     },
  approved:   { bg: '#ede9fe', color: '#5b21b6', label: 'Scheduled'   },
  scheduled:  { bg: '#ede9fe', color: '#5b21b6', label: 'Scheduled'   },
  generating: { bg: '#dbeafe', color: '#1e40af', label: 'Generating…' },
  generated:  { bg: '#dbeafe', color: '#1e40af', label: 'Generated'   },
  published:  { bg: '#dcfce7', color: '#166534', label: 'Published'   },
  draft_saved:{ bg: '#ede9fe', color: '#5b21b6', label: 'In WP'       },
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

function RationaleModal({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fields: { label: string; value: string | number | null | undefined }[] = [
    { label: 'Topic',              value: item.topicText },
    { label: 'Client',             value: item.clientName },
    { label: 'Target Keyword',     value: item.targetKeyword },
    { label: 'Suggested Title',    value: item.suggestedTitle },
    { label: 'Publish Date',       value: item.targetPublishDate ? fmtDate(item.targetPublishDate) : null },
    { label: 'Search Volume',      value: item.searchVolume },
    { label: 'Keyword Difficulty', value: item.keywordDifficulty },
    { label: 'Competition',        value: item.competitionLevel },
  ]

  const ratFields: { label: string; value: string | null | undefined }[] = [
    { label: 'Keyword Opportunity', value: item.keywordOpportunity },
    { label: 'Ranking Strategy',    value: item.rankingStrategy },
    { label: 'Audience Intent',     value: item.audienceIntent },
    { label: 'Why Now',             value: item.whyNow },
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface, #fff)', borderRadius: 12,
          padding: '1.5rem', maxWidth: 560, width: '100%', maxHeight: '85vh',
          overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Topic Details
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--text-faint)', lineHeight: 1 }}>×</button>
        </div>

        {/* Key metrics grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
          {fields.filter(f => f.value != null && f.value !== '').map(f => (
            <div key={f.label} style={{ background: 'var(--bg-subtle, #f8f9fa)', borderRadius: 6, padding: '0.5rem 0.625rem' }}>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>{String(f.value)}</div>
            </div>
          ))}
        </div>

        {/* Rationale fields */}
        {ratFields.filter(f => f.value).map(f => (
          <div key={f.label} style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{f.label}</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{f.value}</div>
          </div>
        ))}

        {item.generationError && (
          <div style={{ background: '#fee2e2', borderRadius: 6, padding: '0.5rem 0.75rem', marginTop: '0.75rem' }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#991b1b', marginBottom: 2 }}>GENERATION ERROR</div>
            <div style={{ fontSize: '0.8125rem', color: '#7f1d1d' }}>{item.generationError}</div>
          </div>
        )}
      </div>
    </div>
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
  padding: '0.4rem 0.625rem',
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: 'var(--text-faint)',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border, #e5e7eb)',
  background: 'var(--bg-subtle, #f8f9fa)',
}

const tdStyle: React.CSSProperties = {
  padding: '0.375rem 0.625rem',
  fontSize: '0.8125rem',
  color: 'var(--text-primary)',
  verticalAlign: 'middle',
}

export default function ContentQueue({ posts: initialItems, sites }: Props) {
  const router = useRouter()
  const [items,          setItems]          = useState<QueueItem[]>(initialItems)
  const [tab,            setTab]            = useState<TabId>('scheduled')
  const [clientFilter,   setClientFilter]   = useState<string>('all')
  const [selected,       setSelected]       = useState<Set<string>>(new Set())
  const [rationaleItem,  setRationaleItem]  = useState<QueueItem | null>(null)
  const [editingPostId,  setEditingPostId]  = useState<string | null>(null)
  const [loading,        setLoading]        = useState<string | null>(null)
  const [bulkLoading,    setBulkLoading]    = useState(false)
  const [error,          setError]          = useState('')

  const clientOptions = Array.from(
    new Map(items.map(i => [i.clientId, i.clientName])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]))

  const isScheduledTab = (i: QueueItem) =>
    i.type === 'topic' && ['scheduled', 'approved', 'generating'].includes(i.status)

  const isUploadedTab = (i: QueueItem) =>
    i.type === 'post' && i.wpPostId != null

  const applyClientFilter = (arr: QueueItem[]) =>
    clientFilter === 'all' ? arr : arr.filter(i => i.clientId === clientFilter)

  const tabItems: Record<TabId, QueueItem[]> = {
    all:       applyClientFilter(items),
    scheduled: applyClientFilter(items.filter(isScheduledTab)),
    uploaded:  applyClientFilter(items.filter(isUploadedTab)),
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

  const openRationale = useCallback((item: QueueItem) => {
    if (item.type === 'topic') setRationaleItem(item)
  }, [])

  const editingItem  = editingPostId ? items.find(i => i.id === editingPostId) ?? null : null
  const siteForPost  = editingItem   ? sites.find(s => s.clientId === editingItem.clientId) ?? null : null

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'all',       label: 'All',       count: tabItems.all.length       },
    { id: 'scheduled', label: 'Scheduled', count: tabItems.scheduled.length },
    { id: 'uploaded',  label: 'Uploaded',  count: tabItems.uploaded.length  },
  ]

  const selectedCount = Array.from(selected).filter(id => filtered.some(i => i.id === id)).length

  return (
    <>
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

      {filtered.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {tab === 'scheduled' ? 'No topics scheduled for generation.'
            : tab === 'uploaded'  ? 'No posts uploaded to WordPress yet.'
            : 'No items.'}
          </p>
        </div>
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
              <col style={{ width: 280 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 80 }} />
              {tab !== 'uploaded' && <col style={{ width: 80 }} />}
              {tab !== 'scheduled' && <col style={{ width: 52 }} />}
              <col style={{ width: tab === 'uploaded' ? 210 : 52 }} />
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
                {tab !== 'uploaded'  && <th style={thStyle}>Competition</th>}
                {tab !== 'scheduled' && <th style={{ ...thStyle, textAlign: 'right' }}>Words</th>}
                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const isLast    = idx === filtered.length - 1
                const isLoading = loading === item.id
                const compKey   = (item.competitionLevel ?? '').toLowerCase()
                const comp      = COMPETITION_BADGE[compKey]
                const wpEditUrl = item.wpSiteUrl && item.wpPostId
                  ? `${item.wpSiteUrl}/wp-admin/post.php?post=${item.wpPostId}&action=edit`
                  : null

                const rowStyle: React.CSSProperties = {
                  borderBottom: isLast ? 'none' : '1px solid var(--border, #e5e7eb)',
                  cursor: item.type === 'topic' ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                }

                return (
                  <tr
                    key={item.id}
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

                    {/* Competition (scheduled tab only) */}
                    {tab !== 'uploaded' && (
                      <td style={tdStyle}>
                        {comp && item.competitionLevel ? (
                          <span style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '1px 6px', borderRadius: 999, background: comp.bg, color: comp.color, whiteSpace: 'nowrap' }}>
                            {item.competitionLevel}
                          </span>
                        ) : null}
                      </td>
                    )}

                    {/* Words (uploaded tab only) */}
                    {tab !== 'scheduled' && (
                      <td style={{ ...tdStyle, textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                        {item.type === 'post' && item.wordCount != null ? `${item.wordCount.toLocaleString()}w` : ''}
                      </td>
                    )}

                    {/* Actions */}
                    <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                        {/* Topic rows */}
                        {item.type === 'topic' && item.status !== 'generating' && (
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => deleteSingle(item)}
                            style={{
                              fontSize: '0.7rem', padding: '0.15rem 0.4rem',
                              background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer',
                            }}
                            title="Delete"
                          >
                            {isLoading ? '…' : '✕'}
                          </button>
                        )}

                        {/* Post rows */}
                        {item.type === 'post' && (
                          <>
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
                              style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', whiteSpace: 'nowrap' }}
                            >
                              SEO Report
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
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => deleteSingle(item)}
                              style={{
                                fontSize: '0.7rem', padding: '0.15rem 0.4rem',
                                background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer',
                              }}
                              title="Delete"
                            >
                              {isLoading ? '…' : '✕'}
                            </button>
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
            setItems(prev => prev.map(i => i.id === updatedPost.id ? { ...i, ...updatedPost } : i))
          }}
        />
      )}
    </>
  )
}
