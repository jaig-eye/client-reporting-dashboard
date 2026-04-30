'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ContentPostEditor from './ContentPostEditor'

interface QueueItem {
  type:              'post' | 'topic'
  id:                string
  clientId:          string
  clientName:        string
  status:            string
  targetKeyword:     string | null
  title:             string | null
  topicText:         string | null
  wordCount:         number | null
  headingCount:      number | null
  internalLinks:     number | null
  generatedAt:       string
  generatedBy:       string
  publishedUrl:      string | null
  generateByDate:    string | null
  targetPublishDate: string | null
  rationale:         string | null
  wpPostId:          number | null
  wpSiteUrl:         string | null
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

const STATUS_TABS = ['all', 'scheduled', 'pending', 'approved', 'published', 'rejected'] as const
type StatusFilter = typeof STATUS_TABS[number]

const POST_STATUS_LABELS: Record<string, string> = {
  pending:     'Pending',
  approved:    'Approved',
  published:   'Published',
  draft_saved: 'Scheduled',
  rejected:    'Rejected',
}

const TOPIC_STATUS_LABELS: Record<string, string> = {
  approved:   'Scheduled',
  scheduled:  'Scheduled',
  generating: 'Generating…',
}

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  pending:    { bg: '#fef3c7', color: '#92400e' },
  approved:   { bg: '#dbeafe', color: '#1e40af' },
  published:  { bg: '#dcfce7', color: '#166534' },
  draft_saved:{ bg: '#ede9fe', color: '#5b21b6' },
  rejected:   { bg: '#fee2e2', color: '#991b1b' },
  generating: { bg: '#ede9fe', color: '#5b21b6' },
  scheduled:  { bg: '#ede9fe', color: '#5b21b6' },
}

function statusLabel(item: QueueItem): string {
  if (item.type === 'topic') return TOPIC_STATUS_LABELS[item.status] ?? item.status
  return POST_STATUS_LABELS[item.status] ?? item.status
}

function statusBadgeStyle(item: QueueItem) {
  const key = item.type === 'topic'
    ? (item.status === 'generating' ? 'generating' : 'scheduled')
    : item.status
  return STATUS_BADGE[key] ?? STATUS_BADGE.pending
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function timeSince(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (h < 1)  return 'Just now'
  if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 7)  return `${Math.floor(d)}d ago`
  return `${Math.floor(d / 7)}w ago`
}

function ItemCard({
  item,
  onOpenEditor,
  onReject,
  onForceGenerate,
  loading,
  cardError,
}: {
  item:             QueueItem
  onOpenEditor:     (id: string) => void
  onReject:         (item: QueueItem) => void
  onForceGenerate:  (id: string) => void
  loading:          string | null
  cardError:        string | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  const badge = statusBadgeStyle(item)
  const isLoading = loading === item.id
  const isTopic = item.type === 'topic'
  const isGenerating = item.status === 'generating' && !isLoading

  return (
    <div style={{
      border:       '1px solid var(--border, #e5e7eb)',
      borderRadius: 10,
      background:   'var(--bg-surface, #fff)',
      display:      'flex',
      flexDirection: 'column',
      overflow:     'hidden',
      transition:   'box-shadow 0.15s',
    }}>
      {/* Card body */}
      <div style={{ padding: '0.875rem 1rem', flex: 1 }}>
        {/* Top row: status badge + company */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 999,
            fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.02em',
            background: badge.bg, color: badge.color,
          }}>
            {statusLabel(item)}
          </span>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
            {item.clientName}
          </span>
        </div>

        {/* Title / topic text */}
        {isTopic ? (
          <p style={{
            fontSize: '0.875rem', fontStyle: 'italic', color: 'var(--text-primary)',
            margin: 0, marginBottom: '0.625rem',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {item.topicText}
          </p>
        ) : (
          <p style={{
            fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)',
            margin: 0, marginBottom: '0.625rem',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {item.title ?? <span style={{ color: 'var(--text-faint)', fontWeight: 400, fontStyle: 'italic' }}>Untitled</span>}
          </p>
        )}

        <div style={{ height: 1, background: 'var(--border, #e5e7eb)', marginBottom: '0.625rem' }} />

        {/* Meta row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {item.targetKeyword && (
            <span style={{ background: 'var(--bg-subtle, #f8f9fa)', padding: '1px 6px', borderRadius: 4 }}>
              {item.targetKeyword}
            </span>
          )}
          {!isTopic && item.wordCount != null && (
            <span>{item.wordCount.toLocaleString()} words</span>
          )}
          {!isTopic && item.headingCount != null && (
            <span>{item.headingCount} H2s</span>
          )}
        </div>

        {/* Scheduled dates */}
        {isTopic && (item.generateByDate || item.targetPublishDate) && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {item.generateByDate && (
              <span>Generates: <strong style={{ color: 'var(--text-primary)' }}>{fmtDate(item.generateByDate)}</strong></span>
            )}
            {item.targetPublishDate && (
              <span>Publishes: <strong style={{ color: 'var(--text-primary)' }}>{fmtDate(item.targetPublishDate)}</strong></span>
            )}
          </div>
        )}

        {/* Rationale expand (topics) */}
        {isTopic && item.rationale && (
          <div style={{ marginTop: '0.375rem' }}>
            <button
              onClick={() => setExpanded(e => !e)}
              style={{ fontSize: '0.7rem', color: 'var(--blue)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              {expanded ? '▲ hide rationale' : '▼ rationale'}
            </button>
            {expanded && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', lineHeight: 1.5 }}>
                {item.rationale}
              </p>
            )}
          </div>
        )}

        {/* Scheduled publish date (draft_saved posts) */}
        {!isTopic && item.status === 'draft_saved' && item.targetPublishDate && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
            Scheduled: <strong style={{ color: 'var(--text-primary)' }}>{fmtDate(item.targetPublishDate)}</strong>
          </p>
        )}

        {/* Generated time (posts) */}
        {!isTopic && (
          <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', margin: '0.375rem 0 0' }}>
            {timeSince(item.generatedAt)}
            {item.generatedBy === 'scheduled' && <span style={{ marginLeft: 4, opacity: 0.6 }}>auto</span>}
          </p>
        )}
      </div>

      {/* Action footer */}
      <div style={{
        padding: '0.5rem 1rem',
        borderTop: '1px solid var(--border, #e5e7eb)',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem',
        background: 'var(--bg-subtle, #f8f9fa)',
      }}>
        {/* Post actions */}
        {!isTopic && (
          <>
            {item.wpPostId && item.wpSiteUrl && (
              <a
                href={`${item.wpSiteUrl}/wp-admin/post.php?post=${item.wpPostId}&action=edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
              >
                Edit in WP ↗
              </a>
            )}
            <button
              type="button"
              onClick={() => onOpenEditor(item.id)}
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
            >
              SEO Report
            </button>
            {item.status === 'pending' && (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => onReject(item)}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', color: 'var(--red)' }}
              >
                Reject
              </button>
            )}
            {item.publishedUrl && (
              <a
                href={item.publishedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
              >
                View ↗
              </a>
            )}
          </>
        )}

        {/* Topic actions */}
        {isTopic && !isGenerating && (
          <>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => onForceGenerate(item.id)}
              className="btn btn-primary"
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.75rem' }}
            >
              {isLoading ? 'Generating…' : '▶ Generate Now'}
            </button>
            {!isLoading && (
              <button
                type="button"
                onClick={() => onReject(item)}
                style={{
                  fontSize: '0.75rem', padding: '0.2rem 0.5rem',
                  background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer',
                }}
              >
                ✕
              </button>
            )}
          </>
        )}

        {isTopic && isGenerating && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>
            Generating post…
          </span>
        )}
      </div>

      {/* Per-card inline messages */}
      {isTopic && isLoading && (
        <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)', textAlign: 'center', padding: '0.4rem 1rem 0', margin: 0 }}>
          This may take 1–2 minutes…
        </p>
      )}
      {cardError && (
        <p style={{ fontSize: '0.7rem', color: 'var(--red, #dc2626)', padding: '0.4rem 1rem', margin: 0 }}>
          {cardError}
        </p>
      )}
    </div>
  )
}

export default function ContentQueue({ posts: initialItems, sites }: Props) {
  const router = useRouter()
  const [items,         setItems]         = useState<QueueItem[]>(initialItems)
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>('pending')
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [loading,       setLoading]       = useState<string | null>(null)
  const [error,         setError]         = useState('')
  const [errorById,     setErrorById]     = useState<Record<string, string>>({})

  const isScheduled = (i: QueueItem) =>
    i.type === 'topic' || (i.type === 'post' && i.status === 'draft_saved')

  const counts: Record<StatusFilter, number> = {
    all:       items.length,
    scheduled: items.filter(isScheduled).length,
    pending:   items.filter(i => i.type === 'post' && i.status === 'pending').length,
    approved:  items.filter(i => i.type === 'post' && i.status === 'approved').length,
    published: items.filter(i => i.type === 'post' && i.status === 'published').length,
    rejected:  items.filter(i => i.type === 'post' && i.status === 'rejected').length,
  }

  const filtered = (() => {
    if (statusFilter === 'all')       return items
    if (statusFilter === 'scheduled') return items.filter(isScheduled)
    return items.filter(i => i.type === 'post' && i.status === statusFilter)
  })()

  async function rejectItem(item: QueueItem) {
    setLoading(item.id)
    setError('')
    try {
      if (item.type === 'topic') {
        const res = await fetch(`/api/admin/content/topics/${item.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ status: 'rejected' }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed')
        setItems(prev => prev.filter(i => i.id !== item.id))
      } else {
        const res = await fetch('/api/admin/content/status', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ post_id: item.id, status: 'rejected' }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed')
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'rejected' } : i))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(null)
    }
  }

  async function forceGenerate(topicId: string) {
    setLoading(topicId)
    setErrorById(prev => { const n = { ...prev }; delete n[topicId]; return n })
    try {
      const res = await fetch('/api/admin/content/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic_id: topicId }),
      })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error || 'Generation failed'
        setErrorById(prev => ({ ...prev, [topicId]: msg }))
        return
      }
      // Refresh server data: topic moves to 'generated', new post appears in Pending
      router.refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to trigger generation'
      setErrorById(prev => ({ ...prev, [topicId]: msg }))
    } finally {
      setLoading(null)
    }
  }

  const editingItem = editingPostId ? items.find(i => i.id === editingPostId) ?? null : null
  const siteForPost = editingItem ? sites.find(s => s.clientId === editingItem.clientId) ?? null : null

  const TAB_LABELS: Record<StatusFilter, string> = {
    all:       'All',
    scheduled: 'Scheduled',
    pending:   'Pending',
    approved:  'Approved',
    published: 'Published',
    rejected:  'Rejected',
  }

  return (
    <>
      {/* Filter tabs */}
      <div className="flex gap-1 mb-4" style={{ flexWrap: 'wrap' }}>
        {STATUS_TABS.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '0.3rem 0.75rem',
              fontSize: '0.8125rem',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontWeight: statusFilter === s ? 600 : 400,
              background: statusFilter === s ? 'var(--blue)' : 'var(--bg-subtle)',
              color: statusFilter === s ? '#fff' : 'var(--text-muted)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {TAB_LABELS[s]} ({counts[s]})
          </button>
        ))}
      </div>

      {error && <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>{error}</p>}

      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {statusFilter === 'pending'   ? 'No posts pending review.'
            : statusFilter === 'scheduled' ? 'No posts scheduled for generation.'
            : `No ${statusFilter} posts.`}
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '0.75rem',
        }}>
          {filtered.map(item => (
            <ItemCard
              key={item.id}
              item={item}
              onOpenEditor={id => setEditingPostId(id)}
              onReject={rejectItem}
              onForceGenerate={forceGenerate}
              loading={loading}
              cardError={errorById[item.id]}
            />
          ))}
        </div>
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
