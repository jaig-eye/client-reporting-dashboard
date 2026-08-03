'use client'

import { useState } from 'react'
import MonthlyReviewPostCard, { type MonthlyReviewPost } from './MonthlyReviewPostCard'

interface Props {
  clientName:      string
  posts:           MonthlyReviewPost[]
  approvedIds:     Set<string>
  rejectedIds:     Set<string>
  discardedIds:    Set<string>
  regeneratingIds: Set<string>
  loadingId:       string | null
  onApprove:       (id: string) => void
  onReject:        (id: string, discard?: boolean) => void
  onOpenEditor:    (id: string) => void
  onRestore:       (id: string) => void
}

type ScanState = 'idle' | 'scanning' | { ok: number; total: number; broken: number }

export default function MonthlyReviewClientSection({
  clientName, posts, approvedIds, rejectedIds, discardedIds, regeneratingIds, loadingId, onApprove, onReject, onOpenEditor, onRestore,
}: Props) {
  const approvedCount = posts.filter(p => approvedIds.has(p.id)).length
  const isComplete    = posts.length > 0 && posts.every(p => approvedIds.has(p.id) || rejectedIds.has(p.id) || discardedIds.has(p.id))

  // null = auto-driven by isComplete; true/false = user explicitly set
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null)

  // Auto-collapse on completion but let users override by clicking the header
  const effectivelyCollapsed = userCollapsed !== null ? userCollapsed : (isComplete && approvedCount > 0)

  const [scanState, setScanState] = useState<ScanState>('idle')

  async function handleScanLinks(e: React.MouseEvent) {
    e.stopPropagation()
    setScanState('scanning')
    try {
      const results = await Promise.allSettled(
        posts.map(p => fetch(`/api/admin/content/posts/${p.id}/scan-links`, { method: 'POST' })
          .then(r => r.ok ? r.json() as Promise<{ links: { ok: boolean }[] }> : Promise.reject())
        )
      )
      let ok = 0, total = 0, broken = 0
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const links = r.value.links ?? []
          total  += links.length
          ok     += links.filter((l: { ok: boolean }) => l.ok).length
          broken += links.filter((l: { ok: boolean }) => !l.ok).length
        }
      }
      setScanState({ ok, total, broken })
    } catch {
      setScanState('idle')
    }
  }

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
        {/* Link health chip */}
        {scanState === 'idle' && (
          <span
            onClick={handleScanLinks}
            style={{ fontSize: 11, color: 'var(--text-faint)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            🔗 Scan links
          </span>
        )}
        {scanState === 'scanning' && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>⟳ Scanning…</span>
        )}
        {scanState !== 'idle' && scanState !== 'scanning' && (
          <span
            onClick={handleScanLinks}
            style={{ fontSize: 11, color: scanState.broken > 0 ? 'var(--red)' : 'var(--green)', background: 'var(--bg)', border: `1px solid ${scanState.broken > 0 ? 'var(--red)' : 'var(--green)'}`, borderRadius: 4, padding: '1px 6px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            🔗 {scanState.broken > 0 ? `${scanState.broken} broken` : 'Links OK'}
          </span>
        )}
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
              isDiscarded={discardedIds.has(post.id)}
              isRegenerating={regeneratingIds.has(post.id)}
              isLoading={loadingId === post.id}
              isCollapsed={false}
              onApprove={onApprove}
              onReject={onReject}
              onOpenEditor={onOpenEditor}
              onRestore={onRestore}
            />
          ))}
        </div>
      )}
    </div>
  )
}
