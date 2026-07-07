'use client'

import { useState, useCallback } from 'react'
import type { PostReviewItem }   from './PostReviewModal'
import PostReviewModal            from './PostReviewModal'
import ContentPostEditor          from './ContentPostEditor'

interface Site {
  connectionId:   string
  siteUrl:        string
  siteName:       string
  clientId:       string
  clientName:     string
  connectorType?: string
}

interface Props {
  initialPosts: PostReviewItem[]
  allSites:     Site[]
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    for_review: { label: 'For Review',  color: '#92400e', bg: '#fef3c7' },
    pending:    { label: 'Pending',     color: '#92400e', bg: '#fef3c7' },
    approved:   { label: 'Approved',    color: '#1d4ed8', bg: '#dbeafe' },
    rejected:   { label: 'Rejected',    color: '#991b1b', bg: '#fee2e2' },
    draft_saved: { label: 'On WordPress', color: '#6d28d9', bg: '#ede9fe' },
    published:  { label: 'Published',   color: '#14532d', bg: '#dcfce7' },
  }
  const c = cfg[status] ?? { label: status, color: 'var(--text-faint)', bg: 'var(--bg-subtle)' }
  return (
    <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: c.color, background: c.bg, whiteSpace: 'nowrap' }}>
      {c.label}
    </span>
  )
}

export default function PostReviewList({ initialPosts, allSites }: Props) {
  const [posts,       setPosts]       = useState<PostReviewItem[]>(initialPosts)
  const [modalIndex,  setModalIndex]  = useState<number | null>(null)
  const [loadingId,   setLoadingId]   = useState<string | null>(null)
  const [editorPostId, setEditorPostId] = useState<string | null>(null)
  const [editorClientId, setEditorClientId] = useState<string | null>(null)

  // Filter to posts not yet pushed (list view scope)
  const activePosts = posts.filter(p =>
    p.status === 'for_review' || p.status === 'pending' || p.status === 'approved'
  )

  // Group by publish date
  type Group = { date: string; posts: (PostReviewItem & { listIndex: number })[] }
  const groups: Group[] = []
  const seenDates = new Map<string, Group>()
  activePosts.forEach((post, i) => {
    const date = post.target_publish_date ?? 'No Date'
    if (!seenDates.has(date)) {
      const g: Group = { date, posts: [] }
      seenDates.set(date, g)
      groups.push(g)
    }
    seenDates.get(date)!.posts.push({ ...post, listIndex: i })
  })

  // The modal navigates over ALL active posts (not just within a date group)
  const handleApprove = useCallback(async (postId: string) => {
    setLoadingId(postId)
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'approve_only' }),
      })
      if (!res.ok) throw new Error()
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: 'approved', admin_approved_at: new Date().toISOString() } : p))
    } catch {
      // No-op — keep previous state so user can retry
    } finally {
      setLoadingId(null)
    }
  }, [])

  const handleReject = useCallback(async (postId: string, discard?: boolean) => {
    setLoadingId(postId)
    try {
      const url = `/api/admin/content/posts/${postId}/dismiss${discard ? '?discard=true' : ''}`
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) throw new Error()
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: 'rejected' } : p))
    } catch {
      // No-op
    } finally {
      setLoadingId(null)
    }
  }, [])

  const handleOpenEditor = useCallback((postId: string) => {
    const post = posts.find(p => p.id === postId)
    if (post) { setEditorPostId(postId); setEditorClientId(post.clientId) }
  }, [posts])

  const editorSites = editorClientId ? allSites.filter(s => s.clientId === editorClientId) : []

  if (activePosts.length === 0) {
    return (
      <div style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--text-faint)' }}>
        <p style={{ fontSize: '0.9375rem', fontWeight: 500 }}>All posts approved</p>
        <p style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>No posts pending review for the upcoming week.</p>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {groups.map(group => {
          const approvedCount = group.posts.filter(p => p.status === 'approved' || p.admin_approved_at).length
          const totalCount    = group.posts.length

          return (
            <div key={group.date}>
              {/* Date group header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.625rem' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Publishing {group.date !== 'No Date' ? fmtDate(group.date) : 'No Date Set'}
                </span>
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                  background: approvedCount === totalCount ? '#dcfce7' : '#fef3c7',
                  color:      approvedCount === totalCount ? '#14532d'  : '#92400e',
                }}>
                  {approvedCount}/{totalCount} approved
                </span>
              </div>

              {/* Post rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {group.posts.map(post => {
                  const isLoading  = loadingId === post.id
                  const isApproved = post.status === 'approved' || !!post.admin_approved_at
                  const isRejected = post.status === 'rejected'

                  return (
                    <div
                      key={post.id}
                      onClick={() => setModalIndex(post.listIndex)}
                      style={{
                        display:      'grid',
                        gridTemplateColumns: '1fr auto auto auto',
                        alignItems:   'center',
                        gap:          '0.75rem',
                        padding:      '0.625rem 0.875rem',
                        background:   isRejected ? 'var(--bg-subtle)' : 'var(--bg-surface)',
                        border:       '1px solid var(--border)',
                        borderRadius: 8,
                        cursor:       'pointer',
                        opacity:      isRejected ? 0.5 : 1,
                        transition:   'box-shadow 0.1s',
                      }}
                      onMouseEnter={e => { if (!isRejected) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}
                    >
                      {/* Title + client */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {post.title ?? '(Untitled)'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 1 }}>
                          {post.clientName}
                          {post.target_keyword ? ` · ${post.target_keyword}` : ''}
                        </div>
                      </div>

                      {/* Status badge */}
                      <StatusBadge status={post.status} />

                      {/* Approve button */}
                      <button
                        onClick={e => { e.stopPropagation(); handleApprove(post.id) }}
                        disabled={isLoading || isApproved || isRejected}
                        style={{
                          background:   isApproved ? 'var(--green, #16a34a)' : 'var(--blue, #2563eb)',
                          color:        '#fff',
                          border:       'none',
                          cursor:       isApproved || isRejected ? 'default' : 'pointer',
                          padding:      '4px 12px',
                          borderRadius: 6,
                          fontSize:     '0.75rem',
                          fontWeight:   600,
                          opacity:      isRejected ? 0.4 : 1,
                          whiteSpace:   'nowrap',
                        }}
                      >
                        {isLoading ? '…' : isApproved ? '✓ Approved' : 'Approve'}
                      </button>

                      {/* Reject button */}
                      <button
                        onClick={e => { e.stopPropagation(); handleReject(post.id) }}
                        disabled={isLoading || isApproved || isRejected}
                        style={{
                          background:   'transparent',
                          color:        isRejected ? 'var(--red, #dc2626)' : 'var(--text-faint)',
                          border:       '1px solid var(--border)',
                          cursor:       isApproved || isRejected ? 'default' : 'pointer',
                          padding:      '4px 10px',
                          borderRadius: 6,
                          fontSize:     '0.75rem',
                          opacity:      isApproved ? 0.4 : 1,
                          whiteSpace:   'nowrap',
                        }}
                      >
                        {isRejected ? 'Rejected' : 'Reject'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Review modal */}
      {modalIndex !== null && (
        <PostReviewModal
          posts={activePosts}
          index={modalIndex}
          onClose={() => setModalIndex(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          onNavigate={setModalIndex}
          onOpenEditor={handleOpenEditor}
        />
      )}

      {/* Full editor (opened from modal or row) */}
      {editorPostId && (
        <ContentPostEditor
          postId={editorPostId}
          defaultConnectionId={editorSites[0]?.connectionId ?? null}
          sites={editorSites}
          onClose={() => { setEditorPostId(null); setEditorClientId(null) }}
          onUpdate={updated => {
            setPosts(prev => prev.map(p => p.id === updated.id
              ? { ...p, status: updated.status, title: updated.title }
              : p
            ))
          }}
        />
      )}
    </>
  )
}
