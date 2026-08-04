'use client'

import { useState, useCallback, useEffect } from 'react'
import MonthlyReviewProgress   from './MonthlyReviewProgress'
import MonthlyReviewClientSection from './MonthlyReviewClientSection'
import MonthlyReviewComplete   from './MonthlyReviewComplete'
import ContentPostEditor       from './ContentPostEditor'
import { useMonthlyReviewSounds } from '@/lib/useMonthlyReviewSounds'
import type { MonthlyReviewPost } from './MonthlyReviewPostCard'

interface Site {
  connectionId:   string
  siteUrl:        string
  siteName:       string
  clientId:       string
  clientName:     string
  connectorType?: string
}

interface Props {
  posts:    MonthlyReviewPost[]
  allSites: Site[]
  month:    string
  prevUrl?: string | null
  nextUrl?: string | null
}

function getMonth(): string {
  return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function MonthlyReviewSession({ posts: initialPosts, allSites, month, prevUrl, nextUrl }: Props) {
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set())
  const [approvedIds,    setApprovedIds]    = useState<Set<string>>(() => {
    // Pre-populate from admin_approved_at so page survives a refresh
    const pre = new Set<string>()
    for (const p of initialPosts) {
      if (p.admin_approved_at) pre.add(p.id)
    }
    return pre
  })
  const [rejectedIds,    setRejectedIds]    = useState<Set<string>>(new Set())
  const [discardedIds,   setDiscardedIds]   = useState<Set<string>>(new Set())
  const [loadingId,      setLoadingId]      = useState<string | null>(null)
  const [editorPostId, setEditorPostId] = useState<string | null>(null)
  const [soundEnabled] = useState(() => typeof window !== 'undefined' && localStorage.getItem('payment-sound-armed') === 'true')
  const { playApprove, playClientDone, playMonthDone } = useMonthlyReviewSounds(soundEnabled)

  // Group posts by client
  const clientIds   = Array.from(new Set(initialPosts.map(p => p.client_id)))
  const postsByClient = new Map<string, MonthlyReviewPost[]>()
  for (const p of initialPosts) {
    const arr = postsByClient.get(p.client_id) ?? []
    arr.push(p)
    postsByClient.set(p.client_id, arr)
  }

  const totalPosts    = initialPosts.length
  const approvedCount = approvedIds.size
  // A session is complete when every post has been approved, rejected, or discarded.
  const actionedCount = approvedIds.size + rejectedIds.size + discardedIds.size
  const isComplete    = totalPosts > 0 && actionedCount >= totalPosts

  // Count clients done
  const clientsDone = clientIds.filter(cid => {
    const ps = postsByClient.get(cid) ?? []
    return ps.length > 0 && ps.every(p => approvedIds.has(p.id) || rejectedIds.has(p.id) || discardedIds.has(p.id))
  }).length

  const handleApprove = useCallback(async (postId: string) => {
    // Optimistic — show approved immediately, push to site in background
    const post = initialPosts.find(p => p.id === postId)
    const nextApproved = new Set(approvedIds)
    nextApproved.add(postId)
    if (post) {
      const clientPosts = postsByClient.get(post.client_id) ?? []
      const allDone    = clientPosts.every(p => nextApproved.has(p.id) || rejectedIds.has(p.id))
      const wasAllDone = clientPosts.every(p => approvedIds.has(p.id)  || rejectedIds.has(p.id))
      if (nextApproved.size + rejectedIds.size >= totalPosts) playMonthDone()
      else if (allDone && !wasAllDone) playClientDone()
      else playApprove()
    } else {
      playApprove()
    }
    setApprovedIds(prev => { const next = new Set(prev); next.add(postId); return next })
    setLoadingId(postId)
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'approve_and_push', source: 'monthly_review' }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch (e) {
      console.error('Approve failed:', e)
      // Revert optimistic update on failure
      setApprovedIds(prev => { const next = new Set(prev); next.delete(postId); return next })
      alert('Failed to approve post. Please try again.')
    } finally {
      setLoadingId(null)
    }
  }, [initialPosts, postsByClient, approvedIds, rejectedIds, totalPosts, playApprove, playClientDone, playMonthDone])

  const handleReject = useCallback(async (postId: string, discard?: boolean) => {
    setLoadingId(postId)
    try {
      const url = `/api/admin/content/posts/${postId}/dismiss${discard ? '?discard=true' : ''}`
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      if (discard) {
        setDiscardedIds(prev => { const next = new Set(prev); next.add(postId); return next })
      } else {
        setRejectedIds(prev => { const next = new Set(prev); next.add(postId); return next })
      }
    } catch (e) {
      console.error('Reject failed:', e)
      alert('Failed to reject post. Please try again.')
    } finally {
      setLoadingId(null)
    }
  }, [])

  const handleRestore = useCallback(async (postId: string) => {
    setLoadingId(postId)
    try {
      const res = await fetch(`/api/admin/content/posts/${postId}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      setDiscardedIds(prev => { const next = new Set(prev); next.delete(postId); return next })
    } catch (e) {
      console.error('Restore failed:', e)
      alert('Failed to restore post. Please try again.')
    } finally {
      setLoadingId(null)
    }
  }, [])

  const handleOpenEditor = useCallback((postId: string) => {
    setEditorPostId(postId)
  }, [])

  const handleRegenerateStart = useCallback(() => {
    if (editorPostId) {
      setRegeneratingIds(prev => { const next = new Set(prev); next.add(editorPostId); return next })
    }
  }, [editorPostId])

  const handleRegenerateDone = useCallback(() => {
    if (editorPostId) {
      setRegeneratingIds(prev => { const next = new Set(prev); next.delete(editorPostId); return next })
    }
    setEditorPostId(null)
  }, [editorPostId])

  const handleRegenerateError = useCallback(() => {
    if (editorPostId) {
      setRegeneratingIds(prev => { const next = new Set(prev); next.delete(editorPostId); return next })
    }
    // Keep the editor open so the user can see the error message
  }, [editorPostId])

  const displayMonth = month || getMonth()
  const editorPost = editorPostId ? initialPosts.find(p => p.id === editorPostId) : null

  return (
    <>
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <MonthlyReviewProgress
        approvedCount={approvedCount}
        totalPosts={totalPosts}
        clientsTotal={clientIds.length}
        clientsDone={clientsDone}
        onExit={() => window.location.href = '/admin/content'}
        month={displayMonth}
      />

      {isComplete ? (
        <MonthlyReviewComplete
          totalPosts={approvedCount}
          clientsTotal={clientIds.length}
          month={displayMonth}
          onExit={() => { window.location.href = '/admin/content' }}
        />
      ) : (
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px 60px' }}>
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 24 }}>
            {prevUrl ? (
              <a href={prevUrl} className="btn btn-secondary btn-sm" style={{ fontSize: '0.8125rem' }}>← Prev Month</a>
            ) : (
              <span style={{ display: 'inline-block', width: 100 }} />
            )}
            <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>{displayMonth}</span>
            {nextUrl ? (
              <a href={nextUrl} className="btn btn-secondary btn-sm" style={{ fontSize: '0.8125rem' }}>Next Month →</a>
            ) : (
              <span style={{ display: 'inline-block', width: 100 }} />
            )}
          </div>

          {totalPosts === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
              <p style={{ fontSize: 16 }}>No posts need review for {displayMonth}.</p>
              <p style={{ fontSize: 14, marginTop: 8 }}>
                Posts will appear here once topics auto-approve (~35 days ahead).
              </p>
              <a href="/admin/content" className="btn btn-secondary" style={{ display: 'inline-flex', marginTop: 20 }}>
                Back to Content
              </a>
            </div>
          ) : (
            clientIds.map(clientId => {
              const posts = postsByClient.get(clientId) ?? []
              return (
                <MonthlyReviewClientSection
                  key={clientId}
                  clientName={posts[0]?.clientName ?? clientId}
                  posts={posts}
                  approvedIds={approvedIds}
                  rejectedIds={rejectedIds}
                  discardedIds={discardedIds}
                  regeneratingIds={regeneratingIds}
                  loadingId={loadingId}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onOpenEditor={handleOpenEditor}
                  onRestore={handleRestore}
                />
              )
            })
          )}
        </div>
      )}
    </div>
    {editorPostId && editorPost && (
      <ContentPostEditor
        postId={editorPostId}
        defaultConnectionId={editorPost.connection_id ?? null}
        sites={allSites}
        onClose={() => setEditorPostId(null)}
        onUpdate={() => setEditorPostId(null)}
        onRegenerateStart={handleRegenerateStart}
        onRegenerateDone={handleRegenerateDone}
        onRegenerateError={handleRegenerateError}
        autoScanLinks
      />
    )}
    </>
  )
}
