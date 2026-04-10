'use client'

import { useState } from 'react'
import ContentPostEditor from './ContentPostEditor'

interface Post {
  id:            string
  clientId:      string
  clientName:    string
  status:        string
  targetKeyword: string | null
  title:         string | null
  wordCount:     number | null
  headingCount:  number | null
  internalLinks: number | null
  generatedAt:   string
  generatedBy:   string
  publishedUrl:  string | null
}

interface Site {
  connectionId: string
  siteUrl:      string
  siteName:     string
  clientId:     string
  clientName:   string
}

interface Props {
  posts: Post[]
  sites: Site[]
}

const STATUS_TABS = ['all', 'pending', 'approved', 'published', 'rejected'] as const
type StatusFilter = typeof STATUS_TABS[number]

const STATUS_LABELS: Record<string, string> = {
  pending:    'Pending',
  approved:   'Approved',
  published:  'Published',
  draft_saved: 'Draft',
  rejected:   'Rejected',
}

const STATUS_CLASSES: Record<string, string> = {
  pending:    'badge-amber',
  approved:   'badge-blue',
  published:  'badge-green',
  draft_saved: 'badge-gray',
  rejected:   'badge-red',
}

function timeSince(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (h < 1)   return 'Just now'
  if (h < 24)  return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 7)   return `${Math.floor(d)}d ago`
  return `${Math.floor(d / 7)}w ago`
}

export default function ContentQueue({ posts: initialPosts, sites }: Props) {
  const [posts,         setPosts]         = useState<Post[]>(initialPosts)
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>('pending')
  const [editingPostId, setEditingPostId] = useState<string | null>(null)
  const [loading,       setLoading]       = useState<string | null>(null)
  const [error,         setError]         = useState('')

  const filtered = statusFilter === 'all'
    ? posts
    : posts.filter(p => p.status === statusFilter)

  const counts: Record<StatusFilter, number> = {
    all:       posts.length,
    pending:   posts.filter(p => p.status === 'pending').length,
    approved:  posts.filter(p => p.status === 'approved').length,
    published: posts.filter(p => p.status === 'published').length,
    rejected:  posts.filter(p => p.status === 'rejected').length,
  }

  async function updateStatus(postId: string, status: string) {
    setLoading(postId)
    setError('')
    try {
      const res = await fetch('/api/admin/content/status', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ post_id: postId, status }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, status } : p))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setLoading(null)
    }
  }

  const editingPost = editingPostId ? posts.find(p => p.id === editingPostId) ?? null : null
  const siteForPost = editingPost
    ? sites.find(s => s.clientId === editingPost.clientId) ?? null
    : null

  return (
    <>
      {/* Status filter tabs */}
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
            {s === 'all' ? 'All' : STATUS_LABELS[s] ?? s} ({counts[s]})
          </button>
        ))}
      </div>

      {error && <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>{error}</p>}

      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {statusFilter === 'pending' ? 'No posts pending review.' : `No ${statusFilter} posts.`}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Keyword / Topic</th>
                <th>Title</th>
                <th style={{ textAlign: 'right' }}>Words</th>
                <th style={{ textAlign: 'right' }}>H2s</th>
                <th>Status</th>
                <th>Generated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(post => (
                <tr key={post.id}>
                  <td>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {post.clientName}
                    </span>
                  </td>
                  <td>
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {post.targetKeyword ?? '—'}
                    </span>
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    <span className="text-sm" style={{ color: 'var(--text-primary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {post.title ?? <span style={{ color: 'var(--text-faint)' }}>Untitled</span>}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.875rem' }}>
                    {post.wordCount?.toLocaleString() ?? '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.875rem' }}>
                    {post.headingCount ?? '—'}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_CLASSES[post.status] ?? 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
                      {STATUS_LABELS[post.status] ?? post.status}
                    </span>
                  </td>
                  <td>
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      {timeSince(post.generatedAt)}
                      {post.generatedBy === 'scheduled' && (
                        <span style={{ marginLeft: 4, color: 'var(--text-faint)', opacity: 0.6 }}>auto</span>
                      )}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingPostId(post.id)}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                      >
                        View / Edit
                      </button>
                      {post.status === 'pending' && (
                        <button
                          type="button"
                          disabled={loading === post.id}
                          onClick={() => updateStatus(post.id, 'rejected')}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', color: 'var(--red)' }}
                        >
                          Reject
                        </button>
                      )}
                      {post.publishedUrl && (
                        <a
                          href={post.publishedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                        >
                          View ↗
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Post editor drawer */}
      {editingPostId && (
        <ContentPostEditor
          postId={editingPostId}
          defaultConnectionId={siteForPost?.connectionId ?? null}
          sites={sites}
          onClose={() => setEditingPostId(null)}
          onUpdate={updatedPost => {
            setPosts(prev => prev.map(p => p.id === updatedPost.id ? { ...p, ...updatedPost } : p))
          }}
        />
      )}
    </>
  )
}
