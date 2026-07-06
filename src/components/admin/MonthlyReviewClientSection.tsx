'use client'

import { useState } from 'react'
import MonthlyReviewPostCard, { type MonthlyReviewPost } from './MonthlyReviewPostCard'

interface Props {
  clientName:  string
  posts:       MonthlyReviewPost[]
  approvedIds: Set<string>
  rejectedIds: Set<string>
  loadingId:   string | null
  onApprove:   (id: string) => void
  onReject:    (id: string) => void
  onOpenEditor:(id: string) => void
}

export default function MonthlyReviewClientSection({
  clientName, posts, approvedIds, rejectedIds, loadingId, onApprove, onReject, onOpenEditor,
}: Props) {
  const approvedCount = posts.filter(p => approvedIds.has(p.id)).length
  const isComplete    = approvedCount === posts.length

  // null = auto-driven by isComplete; true/false = user explicitly set
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null)

  // Auto-collapse on completion but let users override by clicking the header
  const effectivelyCollapsed = userCollapsed !== null ? userCollapsed : (isComplete && approvedCount > 0)

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Client header (accordion toggle) */}
      <button
        onClick={() => setUserCollapsed(!effectivelyCollapsed)}
        style={{
          width:        '100%',
          display:      'flex',
          alignItems:   'center',
          gap:          8,
          padding:      '10px 14px',
          background:   isComplete ? '#f0fdf4' : 'var(--bg-subtle)',
          border:       `1px solid ${isComplete ? '#bbf7d0' : 'var(--border)'}`,
          borderRadius: 8,
          cursor:       'pointer',
          textAlign:    'left',
          marginBottom: effectivelyCollapsed ? 0 : 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: isComplete ? '#15803d' : 'var(--text-primary)', flex: 1 }}>
          {isComplete ? '✓ ' : ''}{clientName}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {approvedCount}/{posts.length} approved
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 4 }}>
          {effectivelyCollapsed ? '▶' : '▼'}
        </span>
      </button>

      {/* Posts list */}
      {!effectivelyCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {posts.map(post => (
            <MonthlyReviewPostCard
              key={post.id}
              post={post}
              isApproved={approvedIds.has(post.id)}
              isRejected={rejectedIds.has(post.id)}
              isLoading={loadingId === post.id}
              isCollapsed={false}
              onApprove={onApprove}
              onReject={onReject}
              onOpenEditor={onOpenEditor}
            />
          ))}
        </div>
      )}
    </div>
  )
}
